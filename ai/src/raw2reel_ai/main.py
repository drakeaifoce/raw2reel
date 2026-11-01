"""HTTP adapter for the same pipeline used by the standalone CLI."""

import hmac
import json
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .config import Settings, get_settings
from .health import readiness
from .media import MediaError
from .meta import MetaError
from .models import RenderRequest
from .pipeline import ReelPipeline


def create_app(
    service_settings: Settings | None = None, *, pipeline_factory=ReelPipeline
):
    settings = service_settings or get_settings()
    app = FastAPI(title="raw2reel-ai", version="0.0.0")
    render_lock = threading.Lock()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/version")
    def version():
        return {"service": "ai", "version": settings.git_sha}

    @app.get("/ready")
    def ready(response: Response):
        result = readiness()
        if not result["ready"]:
            response.status_code = 503
        return result

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse(
            {"error": {"code": f"http_{error.status_code}", "message": error.detail}},
            status_code=error.status_code,
            headers=error.headers,
        )

    @app.post(
        "/v1/render",
        response_class=FileResponse,
        responses={200: {"content": {"video/mp4": {}}}},
    )
    async def render(request: Request):
        """Multipart: video, optional music, duration (0..30), captions, subject_ids JSON."""
        token = settings.ai_service_token
        if not token or not token.get_secret_value():
            raise HTTPException(503, "Set AI_SERVICE_TOKEN on the AI service.")
        expected = f"Bearer {token.get_secret_value()}".encode()
        if not hmac.compare_digest(
            request.headers.get("authorization", "").encode(), expected
        ):
            raise HTTPException(401, "Invalid AI service token.")
        if not render_lock.acquire(blocking=False):
            raise HTTPException(
                429,
                "AI service is processing another reel.",
                headers={"Retry-After": "10"},
            )
        work = None
        try:
            # Bound the entire multipart stream, including requests without Content-Length.
            limit = settings.max_upload_bytes + settings.max_music_bytes + 1024 * 1024
            received = 0
            original_receive = request.receive

            async def limited_receive():
                nonlocal received
                message = await original_receive()
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(413, "Upload exceeds the request size limit.")
                return message

            request = Request(request.scope, limited_receive)
            async with request.form(
                max_files=2, max_fields=4, max_part_size=16384
            ) as form:
                try:
                    options = RenderRequest(
                        duration=form.get("duration", 27),
                        subject_ids=json.loads(str(form.get("subject_ids", "[]"))),
                        use_music=isinstance(form.get("music"), UploadFile),
                    )
                    captions = str(form.get("captions", "true")).lower()
                    if captions not in {"true", "false"}:
                        raise ValueError
                except (ValidationError, ValueError, TypeError):
                    raise HTTPException(
                        422, "Invalid duration, captions or subject_ids."
                    ) from None
                work = tempfile.TemporaryDirectory(prefix="raw2reel-http-")
                directory = Path(work.name)

                async def save(name, maximum, required=False):
                    upload = form.get(name)
                    if upload is None and not required:
                        return None
                    if not isinstance(upload, UploadFile):
                        raise HTTPException(422, f"Provide {name} as a file.")
                    # Never trust client filenames or accept server filesystem paths.
                    destination = directory / name
                    size = 0
                    with destination.open("wb") as stream:
                        while chunk := await upload.read(1024 * 1024):
                            size += len(chunk)
                            if size > maximum:
                                raise HTTPException(
                                    413, f"{name} exceeds the file size limit."
                                )
                            stream.write(chunk)
                    if not size:
                        raise HTTPException(422, f"{name} is empty.")
                    return destination

                video = await save("video", settings.max_upload_bytes, required=True)
                music = await save("music", settings.max_music_bytes)
                output = directory / "reel.mp4"

                def generate():
                    with pipeline_factory(settings) as pipeline:
                        pipeline.render(
                            video,
                            output,
                            music=music,
                            duration=options.duration,
                            subject_ids=options.subject_ids,
                            captions=captions == "true",
                        )

                await run_in_threadpool(generate)
            response = FileResponse(
                output,
                media_type="video/mp4",
                filename="reel.mp4",
                background=BackgroundTask(work.cleanup),
            )
            work = None  # Response owns cleanup after the file has been transmitted.
            return response
        except MediaError as error:
            return JSONResponse(
                {"error": {"code": "media_error", "message": str(error)}},
                status_code=422,
            )
        except MetaError as error:
            return JSONResponse(
                {"error": {"code": error.code, "message": str(error)}},
                status_code=503 if error.code == "model_unconfigured" else 502,
            )
        except (ValueError, OSError):
            raise HTTPException(422, "Invalid media or render options.") from None
        finally:
            if work is not None:
                work.cleanup()
            render_lock.release()

    return app


app = create_app()
