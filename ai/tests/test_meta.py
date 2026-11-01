import httpx
import pytest
from pydantic import SecretStr

from raw2reel_ai.config import Settings
from raw2reel_ai.meta import MetaClient, MetaError


def test_transcribe_uses_documented_multipart_and_turns(tmp_path):
    def handle(request):
        assert request.url.path == "/v1/asr/transcribe"
        assert b'name="request"' in request.content and b'name="audio"' in request.content
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
        return httpx.Response(401, json={"error": {"message": "private upstream test-key"}})

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


def test_cloud_upload_is_cleaned_up_when_sam_response_fails(tmp_path):
    from raw2reel_ai.cloud_meta import CloudModels

    calls = []

    def handle(request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/v1/files":
            return httpx.Response(200, json={"id": "file-123"})
        if request.method == "DELETE":
            return httpx.Response(200, json={"deleted": True})
        return httpx.Response(
            200,
            json={"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
        )

    video = tmp_path / "video.mp4"
    video.write_bytes(b"fixture")
    client = MetaClient(
        Settings(_env_file=None, model_api_key="test"), transport=httpx.MockTransport(handle)
    )
    try:
        with pytest.raises(MetaError) as error:
            CloudModels(client).sam(video, "face")
        assert error.value.code == "model_token_limit"
        assert calls[-1] == ("DELETE", "/v1/files/file-123")
    finally:
        client.close()
