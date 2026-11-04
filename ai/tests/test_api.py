from fastapi.testclient import TestClient

from raw2reel_ai.config import get_settings
from raw2reel_ai.main import app

client = TestClient(app)


def test_health_отвечает_всегда() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version_отдаёт_версию_образа() -> None:
    response = client.get("/version")
    assert response.status_code == 200
    assert response.json() == {"service": "ai", "version": get_settings().git_sha}


def test_без_git_sha_версия_это_dev() -> None:
    # В образе значение приходит из --build-arg GIT_SHA; локально его нет
    assert get_settings().git_sha == "dev"


def test_ready_reports_media_dependencies(monkeypatch):
    monkeypatch.setattr("raw2reel_ai.health.which", lambda path: path)
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["ready"] is True
    assert set(response.json()["dependencies"]) == {"ffmpeg", "ffprobe"}


def test_legacy_render_route_is_removed():
    assert client.post("/v1/render").status_code == 404
    paths = client.get("/openapi.json").json()["paths"]
    assert set(paths) == {
        "/health",
        "/ready",
        "/version",
        "/v2/prepare",
        "/v2/render",
        "/v2/jobs/{job_id}",
    }
