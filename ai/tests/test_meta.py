import json

import httpx
import pytest
from pydantic import SecretStr

from raw2reel_ai.config import Settings
from raw2reel_ai.meta import MetaClient, MetaError


def test_meta_upload_reference_schema_and_remote_file_cleanup(tmp_path):
    calls = []
    plan = {
        "summary": "A clip",
        "hook": "Opening",
        "subjects": [],
        "segments": [{"start": 0, "end": 2, "reason": "opening", "subject_ids": []}],
    }

    def handle(request):
        assert request.headers["authorization"] == "Bearer test-key"
        calls.append(request)
        if request.url.path == "/v1/files":
            assert b"user_data" in request.content and b"video/mp4" in request.content
            return httpx.Response(200, json={"id": "file-123", "status": "uploaded"})
        if request.url.path == "/v1/responses":
            payload = json.loads(request.content)
            assert payload["input"][0]["content"][1]["file_id"] == "file-123"
            assert payload["text"]["format"]["type"] == "json_schema"
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "content": [
                                {"type": "output_text", "text": json.dumps(plan)}
                            ],
                        }
                    ],
                },
            )
        assert request.method == "DELETE" and request.url.path == "/v1/files/file-123"
        return httpx.Response(200, json={"deleted": True})

    video = tmp_path / "input.mp4"
    video.write_bytes(b"fixture")
    client = MetaClient(
        Settings(model_api_key=SecretStr("test-key")),
        transport=httpx.MockTransport(handle),
    )
    assert client.analyze(video, 2).hook == "Opening"
    assert len(calls) == 3


def test_transcribe_uses_documented_multipart_and_turns(tmp_path):
    def handle(request):
        assert request.url.path == "/v1/asr/transcribe"
        assert (
            b'name="request"' in request.content and b'name="audio"' in request.content
        )
        assert b"DIARIZATION" in request.content and b"WAV" in request.content
        return httpx.Response(
            200,
            json={
                "sessionId": "s",
                "transcript": "Hello",
                "audioDurationMs": 1000,
                "turns": [
                    {
                        "turnId": 0,
                        "startMs": 0,
                        "endMs": 1000,
                        "transcript": "Hello",
                        "speaker": "A",
                    }
                ],
            },
        )

    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"fixture")
    client = MetaClient(
        Settings(model_api_key=SecretStr("test-key")),
        transport=httpx.MockTransport(handle),
    )
    assert client.transcribe(audio)[0]["transcript"] == "Hello"


def test_auth_error_is_not_retried_or_leaked(tmp_path):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            401, json={"error": {"message": "private upstream test-key"}}
        )

    client = MetaClient(
        Settings(model_api_key=SecretStr("test-key")),
        transport=httpx.MockTransport(handle),
    )
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"a")
    with pytest.raises(MetaError) as error:
        client.transcribe(audio)
    assert "test-key" not in str(error.value)
    assert error.value.code == "model_auth"
    assert len(calls) == 1
