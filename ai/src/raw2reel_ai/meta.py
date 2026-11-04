"""Meta Model API client. Uploads are streamed, keys and raw errors never escape."""

import json
import time
from pathlib import Path

import httpx
import structlog

from .config import Settings
from .observability import configure_logging

log = structlog.get_logger(__name__)


class MetaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MetaClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        configure_logging(settings.log_level, settings.log_format)
        self.settings = settings
        key = settings.model_api_key.get_secret_value() if settings.model_api_key else ""
        self.client = httpx.Client(
            base_url=settings.model_api_base_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(settings.model_timeout_seconds, connect=15),
            transport=transport,
            follow_redirects=False,
        )

    def close(self):
        self.client.close()

    def _request(self, method: str, path: str, **kwargs) -> dict:
        if not self.settings.model_api_key or not self.settings.model_api_key.get_secret_value():
            raise MetaError("model_unconfigured", "Set MODEL_API_KEY on the AI service.")
        endpoint = (
            path
            if path in {"responses", "asr/transcribe", "files", "models"}
            else (
                "files/{id}"
                if path.startswith("files/")
                else "models/{id}"
                if path.startswith("models/")
                else "other"
            )
        )
        for attempt in range(self.settings.model_max_retries + 1):
            started = time.monotonic()
            fields = dict(
                method=method,
                endpoint=endpoint,
                attempt=attempt + 1,
                max_attempts=self.settings.model_max_retries + 1,
            )
            log.info("meta_request_started", **fields)
            # Multipart file objects must be rewound before a retry.
            for item in (kwargs.get("files") or {}).values():
                stream = item[1] if isinstance(item, tuple) else item
                if hasattr(stream, "seek"):
                    stream.seek(0)
            try:
                response = self.client.request(method, path, **kwargs)
            except httpx.RequestError as error:
                if attempt < self.settings.model_max_retries:
                    log.warning(
                        "meta_request_retry",
                        **fields,
                        reason="network_error",
                        error_type=type(error).__name__,
                        delay_seconds=0.5 * 2**attempt,
                        duration_ms=round((time.monotonic() - started) * 1000, 2),
                    )
                    time.sleep(0.5 * 2**attempt)
                    continue
                log.error(
                    "meta_request_failed",
                    **fields,
                    error_code="model_unavailable",
                    error_type=type(error).__name__,
                    duration_ms=round((time.monotonic() - started) * 1000, 2),
                )
                raise MetaError("model_unavailable", "Could not reach Meta Model API.") from None
            fields.update(
                status_code=response.status_code,
                duration_ms=round((time.monotonic() - started) * 1000, 2),
            )
            if response.status_code in (401, 403):
                log.error("meta_request_failed", **fields, error_code="model_auth")
                raise MetaError("model_auth", "Meta API rejected MODEL_API_KEY or model access.")
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < self.settings.model_max_retries:
                    log.warning(
                        "meta_request_retry",
                        **fields,
                        reason="rate_limited" if response.status_code == 429 else "server_error",
                        delay_seconds=0.5 * 2**attempt,
                    )
                    time.sleep(0.5 * 2**attempt)
                    continue
                log.error("meta_request_failed", **fields, error_code="model_busy")
                raise MetaError("model_busy", "Meta Model API is busy; try again later.")
            if response.is_error:
                log.error("meta_request_failed", **fields, error_code="model_request")
                raise MetaError("model_request", "Meta Model API rejected the media or request.")
            try:
                data = response.json()
            except ValueError:
                log.error("meta_request_failed", **fields, error_code="model_response")
                raise MetaError("model_response", "Meta returned an invalid response.") from None
            if not isinstance(data, dict):
                log.error("meta_request_failed", **fields, error_code="model_response")
                raise MetaError("model_response", "Meta returned an invalid response object.")
            log.info("meta_request_completed", **fields)
            return data
        raise MetaError("model_unavailable", "Meta Model API is unavailable.")

    def transcribe(self, audio: Path, *, mode: str = "DIARIZATION") -> list[dict]:
        if mode not in {"DIARIZATION", "ENDPOINTING"}:
            raise ValueError("Unsupported transcription mode")
        started = time.monotonic()
        log.info("transcription_started", model=self.settings.muse_voice_model, mode=mode)
        with audio.open("rb") as stream:
            response = self._request(
                "POST",
                "asr/transcribe",
                headers={"Accept": "application/json"},
                files={
                    "request": (
                        None,
                        json.dumps(
                            {
                                "model": self.settings.muse_voice_model,
                                "audioEncoding": "WAV",
                                "mode": mode,
                            }
                        ),
                        "application/json",
                    ),
                    "audio": ("speech.wav", stream, "audio/wav"),
                },
            )
        turns = response.get("turns")
        if not isinstance(turns, list):
            raise MetaError("model_response", "Meta did not return timed speech turns.")
        for turn in turns:
            if (
                not isinstance(turn, dict)
                or not isinstance(turn.get("startMs"), int)
                or not isinstance(turn.get("endMs"), int)
                or turn["startMs"] < 0
                or turn["endMs"] < turn["startMs"]
                or not isinstance(turn.get("transcript"), str)
            ):
                raise MetaError("model_response", "Meta returned invalid speech timestamps.")
        log.info(
            "transcription_completed",
            model=self.settings.muse_voice_model,
            turns_count=len(turns),
            duration_ms=round((time.monotonic() - started) * 1000, 2),
        )
        return turns
