"""ASGI access logs and request IDs, including worker-thread correlation."""

import re
import time
import uuid

import structlog
from starlette.responses import JSONResponse

from .observability import configure_logging, exception_fields

log = structlog.get_logger(__name__)
KNOWN_PATHS = {
    "/health",
    "/ready",
    "/version",
    "/v2/prepare",
    "/v2/render",
    "/docs",
    "/redoc",
    "/openapi.json",
}


class RequestLoggingMiddleware:
    def __init__(self, app, *, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        configure_logging(self.settings.log_level, self.settings.log_format)
        supplied = (
            dict(scope.get("headers", []))
            .get(b"x-request-id", b"")
            .decode("ascii", errors="replace")
        )
        identity = (
            supplied
            if re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}", supplied)
            else uuid.uuid4().hex
        )
        path = scope["path"] if scope["path"] in KNOWN_PATHS else "(other)"
        operation = {"/v2/prepare": "prepare", "/v2/render": "render"}.get(path, "service")
        started, status, sent, failed = time.monotonic(), 500, False, False
        with structlog.contextvars.bound_contextvars(
            request_id=identity,
            operation=operation,
            path=path,
            method=scope["method"],
            version=self.settings.git_sha,
        ):
            quiet = path in {"/health", "/ready", "/version"}
            (log.debug if quiet else log.info)("request_started")

            async def capture_send(message):
                nonlocal status, sent
                if message["type"] == "http.response.start":
                    status, sent = message["status"], True
                    message = {
                        **message,
                        "headers": [
                            (k, v)
                            for k, v in message.get("headers", [])
                            if k.lower() != b"x-request-id"
                        ]
                        + [(b"x-request-id", identity.encode())],
                    }
                await send(message)

            try:
                await self.app(scope, receive, capture_send)
            except Exception as error:
                failed = True
                log.error("request_failed", response_started=sent, **exception_fields(error))
                if sent:
                    raise
                await JSONResponse(
                    {
                        "error": {
                            "code": "internal_error",
                            "message": "AI service failed; use request_id to find the logs.",
                        },
                        "request_id": identity,
                    },
                    status_code=500,
                )(scope, receive, capture_send)
            finally:
                emit = (
                    log.error
                    if failed or status >= 500
                    else log.warning
                    if status >= 400
                    else log.debug
                    if quiet
                    else log.info
                )
                emit(
                    "request_completed",
                    status_code=status,
                    failed=failed,
                    duration_ms=round((time.monotonic() - started) * 1000, 2),
                )
