"""Version 2 multipart endpoints. Backend remains responsible for jobs and ownership."""

import json
import tempfile
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
        if not lock.acquire(blocking=False):
            raise HTTPException(
                429, "AI service is processing another request.", headers={"Retry-After": "10"}
            )
        work = None
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
            if work is not None:
                work.cleanup()
            lock.release()

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
