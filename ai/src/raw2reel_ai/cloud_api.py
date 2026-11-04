"""Version 2 multipart endpoints. Backend remains responsible for jobs and ownership."""

import asyncio
import json
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import structlog
from fastapi import Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .analysis import MAX_ANALYSIS_BYTES, PreparedAnalysis
from .media import MediaError
from .meta import MetaError

log = structlog.get_logger(__name__)

# Асинхронный режим: держим результат после того, как соединение закрылось.
# Иначе рендер живёт только внутри одного HTTP-запроса, и любой обрыв —
# перезапуск клиента, выкладка, сеть — стоит уже посчитанной работы.
# Состояние в памяти процесса намеренно: переживать перезапуск сервиса не
# пытаемся, клиент получит 404 и честно запустит заново.
JOB_TTL_SECONDS = 2 * 60 * 60


@dataclass
class AsyncJob:
    """Фоновый рендер, заказанный с ключом идемпотентности."""

    status: str = "running"
    output: Path | None = None
    error: dict | None = None
    work: tempfile.TemporaryDirectory | None = None
    created: float = field(default_factory=time.monotonic)
    # Ссылку на фоновую задачу держим здесь: без неё сборщик мусора вправе
    # убрать ещё не доработавшую корутину.
    task: asyncio.Task | None = None

    def cleanup(self):
        if self.work is not None:
            self.work.cleanup()
            self.work = None


_jobs: dict[str, AsyncJob] = {}


def _forget_stale_jobs():
    """Освобождает место под завершёнными задачами, которые никто не забрал."""
    now = time.monotonic()
    for key in [k for k, j in _jobs.items() if now - j.created > JOB_TTL_SECONDS]:
        _jobs.pop(key).cleanup()


def _schema(render):
    properties = {"video": {"type": "string", "format": "binary"}}
    if render:
        properties.update(
            {
                "analysis": {
                    "type": "string",
                    "description": "JSON response from /v2/prepare, serialized unchanged",
                },
                "music": {"type": "string", "format": "binary"},
                "person_ids": {
                    "type": "string",
                    "description": 'Selected IDs as JSON, e.g. ["p1"]',
                },
                "duration": {"type": "number", "exclusiveMinimum": 0, "maximum": 30, "default": 27},
                "captions": {"type": "boolean", "default": True},
            }
        )
    return {
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["video", "analysis", "person_ids"] if render else ["video"],
                        "properties": properties,
                    }
                }
            },
        }
    }


def install_cloud_routes(app, settings, authenticate, lock, pipeline_factory):
    async def handle(request: Request, render: bool):
        # Ключ идемпотентности включает асинхронный режим: ответ приходит
        # сразу, работа идёт в фоне, результат забирают по /v2/jobs/{id}.
        # Повтор с тем же ключом не запускает вторую работу — именно это
        # делает обрыв связи безопасным.
        key = request.headers.get("Idempotency-Key") if render else None
        if key:
            _forget_stale_jobs()
            known = _jobs.get(key)
            if known is not None:
                return JSONResponse({"job_id": key, "status": known.status}, status_code=202)
        if not lock.acquire(blocking=False):
            raise HTTPException(
                429, "AI service is processing another request.", headers={"Retry-After": "10"}
            )
        work = None
        handed_off = False
        try:
            received = 0
            maximum = (
                settings.max_upload_bytes
                + settings.max_music_bytes
                + MAX_ANALYSIS_BYTES
                + 1024 * 1024
            )
            receive = request.receive

            async def bounded():
                nonlocal received
                message = await receive()
                received += len(message.get("body", b""))
                if received > maximum:
                    raise HTTPException(413, "Upload exceeds size limit.")
                return message

            request = Request(request.scope, bounded)
            work = tempfile.TemporaryDirectory(prefix="raw2reel-v2-")
            directory = Path(work.name)
            async with request.form(
                max_files=2, max_fields=4, max_part_size=MAX_ANALYSIS_BYTES
            ) as form:
                allowed = (
                    {"video", "analysis", "music", "duration", "person_ids", "captions"}
                    if render
                    else {"video"}
                )
                if any(k not in allowed for k in form) or len(form.multi_items()) != len(form):
                    raise HTTPException(422, "Unknown or duplicate form fields.")

                async def save(name, limit, required=True):
                    upload = form.get(name)
                    if not required and (upload is None or upload == ""):
                        return None
                    if not isinstance(upload, UploadFile):
                        raise HTTPException(422, f"Provide {name} as a file.")
                    path = directory / name
                    size = 0
                    with path.open("wb") as stream:
                        while data := await upload.read(1024 * 1024):
                            size += len(data)
                            if size > limit:
                                raise HTTPException(413, f"{name} exceeds file size limit.")
                            stream.write(data)
                    if not size:
                        raise HTTPException(422, f"{name} is empty.")
                    log.info("upload_saved", field=name, bytes_count=size)
                    return path

                source = await save("video", settings.max_upload_bytes)
                analysis = music = None
                if render:
                    music = await save("music", settings.max_music_bytes, required=False)
                    try:
                        raw_analysis = form.get("analysis")
                        if not isinstance(raw_analysis, str):
                            raise ValueError
                        analysis = json.loads(raw_analysis)
                        if not isinstance(analysis, dict):
                            raise ValueError
                        ids = json.loads(str(form.get("person_ids", "[]")))
                        duration = float(str(form.get("duration", "27")))
                        captions = str(form.get("captions", "true")).lower()
                        if (
                            not isinstance(ids, list)
                            or not ids
                            or len(ids) > 16
                            or not all(isinstance(p, str) for p in ids)
                            or not 0 < duration <= 30
                            or captions not in {"true", "false"}
                        ):
                            raise ValueError
                    except (ValueError, TypeError):
                        raise HTTPException(
                            422, "Invalid analysis JSON, person_ids, duration or captions."
                        ) from None
                output = directory / ("reel.mp4" if render else "prepared.json")

                def generate():
                    with pipeline_factory(settings) as pipeline:
                        if render:
                            pipeline.render(
                                source,
                                output,
                                analysis=analysis,
                                person_ids=ids,
                                music=music,
                                duration=duration,
                                captions=captions == "true",
                            )
                        else:
                            return pipeline.prepare(source, output)
                    return None

                if key:
                    job = AsyncJob(work=work)
                    _jobs[key] = job
                    # Замок отдаётся фоновой задаче: сервис по-прежнему
                    # рендерит по одному, просто теперь не держит соединение.
                    job.task = asyncio.create_task(run_in_background(key, job, generate, output))
                    work = None
                    handed_off = True
                    return JSONResponse({"job_id": key, "status": "running"}, status_code=202)
                result = await run_in_threadpool(generate)
            if not render:
                return JSONResponse(result)
            response = FileResponse(
                output,
                filename=output.name,
                media_type="video/mp4",
                background=BackgroundTask(work.cleanup),
            )
            work = None
            return response
        except MediaError as error:
            log.warning(
                "request_rejected", error_code="media_error", error_type=type(error).__name__
            )
            return JSONResponse(
                {"error": {"code": "media_error", "message": str(error)}}, status_code=422
            )
        except MetaError as error:
            log.error(
                "request_model_failed", error_code=error.code, error_type=type(error).__name__
            )
            return JSONResponse(
                {"error": {"code": error.code, "message": str(error)}},
                status_code=(
                    503
                    if error.code == "model_unconfigured"
                    else 422
                    if error.code == "face_catalog_limit"
                    else 502
                ),
            )
        except (ValueError, OSError, KeyError) as error:
            log.warning(
                "request_rejected", error_code="invalid_input", error_type=type(error).__name__
            )
            raise HTTPException(422, "Invalid source, analysis JSON or render options.") from None
        finally:
            if not handed_off:
                if work is not None:
                    work.cleanup()
                lock.release()

    async def run_in_background(key: str, job: AsyncJob, generate, output: Path):
        """Доводит рендер до конца, когда соединение уже закрыто.

        Замок принадлежит этой задаче: сервис по-прежнему рендерит по одному.
        Ошибки пишем в задачу, а не наружу — спрашивать о них будут опросом.
        """
        try:
            await run_in_threadpool(generate)
            job.output = output
            job.status = "done"
        except MediaError as error:
            job.error = {"code": "media_error", "message": str(error)}
            job.status = "failed"
            log.warning("async_job_rejected", error_code="media_error")
        except MetaError as error:
            job.error = {"code": error.code, "message": str(error)}
            job.status = "failed"
            log.error("async_job_model_failed", error_code=error.code)
        except (ValueError, OSError, KeyError) as error:
            job.error = {"code": "invalid_input", "message": "Invalid source or render options."}
            job.status = "failed"
            log.warning("async_job_rejected", error_type=type(error).__name__)
        except Exception as error:
            # Фоновая задача не имеет кому пробросить исключение: если его не
            # поймать, клиент будет вечно видеть running.
            job.error = {"code": "internal", "message": "Rendering failed."}
            job.status = "failed"
            log.error("async_job_crashed", error_type=type(error).__name__)
        finally:
            if job.status == "running":
                job.status = "failed"
            if job.status == "failed":
                job.cleanup()
            lock.release()
            log.info("async_job_finished", job_status=job.status)

    @app.get("/v2/jobs/{job_id}", dependencies=[Depends(authenticate)])
    async def job_state(job_id: str):
        """Состояние фонового рендера; готовый отдаёт сам файл."""
        job = _jobs.get(job_id)
        if job is None:
            # Сервис мог перезапуститься: клиенту честнее запустить заново,
            # чем ждать того, чего уже нет.
            raise HTTPException(404, "No such job.")
        if job.status == "running":
            return JSONResponse({"job_id": job_id, "status": "running"}, status_code=200)
        if job.status == "failed":
            return JSONResponse(
                {"job_id": job_id, "status": "failed", "error": job.error}, status_code=200
            )
        output = job.output
        if output is None or not output.exists():
            raise HTTPException(410, "Result is gone.")

        def done():
            _jobs.pop(job_id, None)
            job.cleanup()

        # Результат отдаётся один раз: дальше он не нужен, а место на диске
        # нужно. Повторный запрос получит 404 и приведёт к перезапуску.
        return FileResponse(
            output, filename=output.name, media_type="video/mp4", background=BackgroundTask(done)
        )

    @app.post(
        "/v2/prepare",
        dependencies=[Depends(authenticate)],
        openapi_extra=_schema(False),
        response_model=PreparedAnalysis,
    )
    async def prepare(request: Request):
        """Return JSON catalog, transcript and JPEG thumbnails as data URLs."""
        return await handle(request, False)

    @app.post(
        "/v2/render",
        dependencies=[Depends(authenticate)],
        openapi_extra=_schema(True),
        response_class=FileResponse,
        responses={200: {"content": {"video/mp4": {}}}},
    )
    async def render(request: Request):
        """Track chosen characters, review budgeted footage and render a two-phase edit."""
        return await handle(request, True)
