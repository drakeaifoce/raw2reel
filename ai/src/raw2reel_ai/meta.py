"""Meta Model API client. Uploads are streamed, keys and raw errors never escape."""

import json
import time
from pathlib import Path

import httpx

from .config import Settings


class MetaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MetaClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
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
        for attempt in range(self.settings.model_max_retries + 1):
            # Multipart file objects must be rewound before a retry.
            for item in (kwargs.get("files") or {}).values():
                stream = item[1] if isinstance(item, tuple) else item
                if hasattr(stream, "seek"):
                    stream.seek(0)
            try:
                response = self.client.request(method, path, **kwargs)
            except httpx.RequestError:
                if attempt < self.settings.model_max_retries:
                    time.sleep(0.5 * 2**attempt)
                    continue
                raise MetaError("model_unavailable", "Could not reach Meta Model API.") from None
            if response.status_code in (401, 403):
                raise MetaError("model_auth", "Meta API rejected MODEL_API_KEY or model access.")
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < self.settings.model_max_retries:
                    time.sleep(0.5 * 2**attempt)
                    continue
                raise MetaError("model_busy", "Meta Model API is busy; try again later.")
            if response.is_error:
                raise MetaError("model_request", "Meta Model API rejected the media or request.")
            try:
                data = response.json()
            except ValueError:
                raise MetaError("model_response", "Meta returned an invalid response.") from None
            if not isinstance(data, dict):
                raise MetaError("model_response", "Meta returned an invalid response object.")
            return data
        raise MetaError("model_unavailable", "Meta Model API is unavailable.")

    def transcribe(self, audio: Path) -> list[dict]:
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
                                "mode": "DIARIZATION",
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
        return turns
