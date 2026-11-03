"""Correlated structlog events on stderr without payloads or private exception values."""

import functools
import logging
import re
import sys
import time
import traceback
import uuid
from pathlib import Path

import structlog
from structlog.contextvars import bind_contextvars, bound_contextvars, get_contextvars

_CONFIG = None
SENSITIVE = {
    "authorization",
    "headers",
    "api_key",
    "model_api_key",
    "ai_service_token",
    "token",
    "password",
    "secret",
    "prompt",
    "transcript",
    "thumbnails",
    "thumbnail",
    "body",
    "content",
    "analysis",
    "input",
    "files",
    "filename",
    "source_path",
    "output_path",
}
log = structlog.get_logger(__name__)


def exception_fields(error: BaseException) -> dict:
    code = getattr(error, "code", None)
    if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,64}", code):
        code = (
            "invalid_input"
            if isinstance(error, (ValueError, OSError, KeyError))
            else "internal_error"
        )
    return {
        "error_type": type(error).__name__,
        "error_code": code,
        "traceback": [
            {"file": Path(f.filename).name, "line": f.lineno, "function": f.name}
            for f in traceback.extract_tb(error.__traceback__)[-24:]
        ],
    }


def _safe_exception(logger, method, event):
    info = event.pop("exc_info", None)
    if info:
        if info is True:
            info = sys.exc_info()
        error = info if isinstance(info, BaseException) else info[1]
        if error is not None:
            event.update(exception_fields(error))
    return event


def _redact(logger, method, event):
    def clean(value):
        if isinstance(value, dict):
            return {
                k: "[redacted]" if str(k).lower() in SENSITIVE else clean(v)
                for k, v in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [clean(v) for v in value]
        return value

    return clean(event)


def _service(logger, method, event):
    event.setdefault("service", "ai")
    return event


def configure_logging(level: str = "INFO", log_format: str = "json"):
    global _CONFIG
    signature = level, log_format, id(sys.stderr)
    if signature == _CONFIG:
        return
    shared = [
        structlog.contextvars.merge_contextvars,
        _service,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,
    )
    renderer = (
        structlog.processors.JSONRenderer(ensure_ascii=False)
        if log_format == "json"
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                _safe_exception,
                _redact,
                renderer,
            ],
        )
    )
    for name in ("raw2reel_ai", "uvicorn", "uvicorn.error"):
        target = logging.getLogger(name)
        target.handlers = [handler]
        target.setLevel(level)
        target.propagate = False
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    _CONFIG = signature


def logged_operation(operation: str):
    def decorate(function):
        @functools.wraps(function)
        def wrapped(self, *args, **kwargs):
            configure_logging(self.settings.log_level, self.settings.log_format)
            identity = get_contextvars().get("request_id") or uuid.uuid4().hex
            callback = kwargs.get("on_progress")
            started = time.monotonic()
            current, stage_started = None, started
            with bound_contextvars(
                request_id=identity,
                operation=operation,
                stage="initializing",
                version=self.settings.git_sha,
            ):

                def progress(value):
                    nonlocal current, stage_started
                    stage = value.split(" ", 1)[0]
                    now = time.monotonic()
                    # Per-frame filtering is logged separately, within discovering_faces.
                    if stage != "filtering_faces":
                        if stage != current:
                            if current is not None:
                                log.info(
                                    "stage_completed",
                                    duration_ms=round((now - stage_started) * 1000, 2),
                                )
                            current, stage_started = stage, now
                            bind_contextvars(stage=stage)
                            if stage != "done":
                                log.info("stage_started")
                        match = re.fullmatch(r"grouping_faces (\d+)/(\d+)", value)
                        if match:
                            log.info("stage_progress", processed=int(match[1]), total=int(match[2]))
                    if callback:
                        callback(value)

                kwargs["on_progress"] = progress
                log.info("pipeline_started")
                try:
                    result = function(self, *args, **kwargs)
                except Exception as error:
                    log.error(
                        "pipeline_failed",
                        duration_ms=round((time.monotonic() - started) * 1000, 2),
                        **exception_fields(error),
                    )
                    raise
                summary = {}
                if isinstance(result, dict):
                    catalog = result.get("catalog", {})
                    if operation == "prepare" and isinstance(catalog, dict):
                        summary = {
                            "people_count": len(catalog.get("people", [])),
                            "observations_count": len(catalog.get("observations", [])),
                        }
                    elif operation == "render":
                        summary = {
                            k: result[k]
                            for k in ("duration", "reviewed_seconds", "tracked_seconds")
                            if k in result
                        }
                log.info(
                    "pipeline_completed",
                    duration_ms=round((time.monotonic() - started) * 1000, 2),
                    **summary,
                )
                return result

        return wrapped

    return decorate
