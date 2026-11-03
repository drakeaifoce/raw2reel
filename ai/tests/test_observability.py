import json
import logging

import httpx
import pytest
import structlog
from fastapi.testclient import TestClient

from raw2reel_ai.config import Settings
from raw2reel_ai.main import create_app
from raw2reel_ai.meta import MetaClient
from raw2reel_ai.observability import configure_logging, logged_operation


def records(capsys):
    return [
        json.loads(line) for line in capsys.readouterr().err.splitlines() if line.startswith("{")
    ]


def test_logs_are_stderr_json_and_redact_nested_secrets(capsys):
    configure_logging()
    structlog.get_logger("raw2reel_ai.test").info(
        "example", authorization="PRIVATE_KEY", nested={"prompt": "PRIVATE_MEDIA", "count": 2}
    )
    output = capsys.readouterr()
    assert output.out == "" and "PRIVATE_" not in output.err
    event = json.loads(output.err)
    assert event["event"] == "example" and event["nested"]["count"] == 2
    assert event["service"] == "ai" and event["timestamp"]


class FakePipeline:
    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def prepare(self, source, output):
        structlog.get_logger("raw2reel_ai.test").info("worker_event")
        return {"catalog": {}, "thumbnails": {}, "calls": []}


def test_request_id_is_propagated_into_worker_and_returned(capsys):
    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"), cloud_pipeline_factory=FakePipeline
        )
    )
    for identity in ("request-a", "request-b"):
        response = client.post(
            "/v2/prepare?token=PRIVATE_QUERY",
            headers={"Authorization": "Bearer test", "X-Request-ID": identity},
            files={"video": ("PRIVATE_NAME.mp4", b"PRIVATE_CONTENT")},
        )
        assert response.status_code == 200 and response.headers["x-request-id"] == identity
    output = records(capsys)
    assert [e["request_id"] for e in output if e["event"] == "worker_event"] == [
        "request-a",
        "request-b",
    ]
    assert "PRIVATE_" not in json.dumps(output)


def test_unexpected_http_failure_is_safe_and_correlated(capsys):
    class Broken(FakePipeline):
        def prepare(self, *_):
            raise TypeError("PRIVATE_EXCEPTION")

    client = TestClient(
        create_app(Settings(_env_file=None, ai_service_token="test"), cloud_pipeline_factory=Broken)
    )
    response = client.post(
        "/v2/prepare",
        headers={"Authorization": "Bearer test", "X-Request-ID": "failure"},
        files={"video": ("v.mp4", b"video")},
    )
    assert response.status_code == 500 and response.headers["x-request-id"] == "failure"
    output = records(capsys)
    error = next(e for e in output if e["event"] == "request_failed")
    assert error["request_id"] == "failure" and error["error_type"] == "TypeError"
    assert error["traceback"][-1]["function"] == "prepare"
    assert "PRIVATE_EXCEPTION" not in json.dumps(output)


def test_meta_retries_have_attempt_status_and_no_raw_response(capsys, monkeypatch):
    attempts = []

    def handle(request):
        attempts.append(request)
        return (
            httpx.Response(500, json={"error": "PRIVATE_RESPONSE"})
            if len(attempts) == 1
            else httpx.Response(200, json={"data": []})
        )

    monkeypatch.setattr("raw2reel_ai.meta.time.sleep", lambda _: None)
    client = MetaClient(
        Settings(_env_file=None, model_api_key="PRIVATE_KEY", model_max_retries=1),
        transport=httpx.MockTransport(handle),
    )
    try:
        assert client._request("GET", "models") == {"data": []}
    finally:
        client.close()
    output = records(capsys)
    retry = next(e for e in output if e["event"] == "meta_request_retry")
    assert retry["attempt"] == 1 and retry["status_code"] == 500
    assert "PRIVATE_" not in json.dumps(output)


def test_pipeline_failure_preserves_stage_and_safe_stack(capsys):
    class Job:
        settings = Settings(_env_file=None)

        @logged_operation("prepare")
        def prepare(self, *, on_progress=None):
            on_progress("discovering_faces")
            on_progress("grouping_faces 4/8")
            raise TypeError("PRIVATE_BODY")

    with pytest.raises(TypeError):
        Job().prepare()
    output = records(capsys)
    error = next(e for e in output if e["event"] == "pipeline_failed")
    assert error["stage"] == "grouping_faces" and error["traceback"][-1]["function"] == "prepare"
    assert len({e["request_id"] for e in output}) == 1
    assert "PRIVATE_BODY" not in json.dumps(output)


def test_log_levels_console_and_foreign_exceptions(capsys):
    configure_logging("WARNING")
    log = structlog.get_logger("raw2reel_ai.test")
    log.info("hidden")
    log.warning("visible")
    assert [e["event"] for e in records(capsys)] == ["visible"]
    configure_logging("INFO", "console")
    log.info("console_event", api_key="PRIVATE_KEY")
    assert "PRIVATE_KEY" not in capsys.readouterr().err
    configure_logging()
    try:
        raise ValueError("PRIVATE_MESSAGE")
    except ValueError:
        logging.getLogger("uvicorn.error").exception("ASGI failure")
    output = records(capsys)
    assert output[0]["error_type"] == "ValueError" and "PRIVATE_MESSAGE" not in json.dumps(output)


def test_media_failure_logs_exit_code_without_command_or_stderr(capsys):
    import sys

    from raw2reel_ai.media import MediaError, MediaTools

    tools = MediaTools(Settings(_env_file=None))
    with pytest.raises(MediaError):
        tools.run(
            [sys.executable, "-c", "import sys;sys.stderr.write('PRIVATE_MEDIA');sys.exit(7)"]
        )
    output = records(capsys)
    error = next(e for e in output if e["event"] == "media_command_failed")
    assert error["exit_code"] == 7 and error["reason"] == "nonzero_exit"
    assert "PRIVATE_MEDIA" not in json.dumps(output)
