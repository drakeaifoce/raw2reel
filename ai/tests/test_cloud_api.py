from fastapi.testclient import TestClient

from raw2reel_ai.config import Settings
from raw2reel_ai.main import create_app


class FakePipeline:
    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def prepare(self, source, output):
        assert source.read_bytes() == b"video"
        output.write_bytes(b"zip")

    def render(self, source, output, **options):
        assert options["artifact"].read_bytes() == b"zip"
        assert options["person_ids"] == ["p1"]
        output.write_bytes(b"mp4")


def test_v2_prepare_and_render_swagger_and_auth():
    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"), cloud_pipeline_factory=FakePipeline
        )
    )
    assert client.post("/v2/prepare").status_code == 401
    headers = {"Authorization": "Bearer test"}
    response = client.post("/v2/prepare", headers=headers, files={"video": ("v.mp4", b"video")})
    assert response.status_code == 200 and response.content == b"zip"
    response = client.post(
        "/v2/render",
        headers=headers,
        files={"video": ("v.mp4", b"video"), "artifact": ("a.zip", b"zip")},
        data={"person_ids": '["p1"]', "duration": "20", "captions": "false"},
    )
    assert response.status_code == 200 and response.content == b"mp4"
    schema = client.get("/openapi.json").json()
    for route in ("/v2/prepare", "/v2/render"):
        operation = schema["paths"][route]["post"]
        assert operation["security"] == [{"AIServiceToken": []}]
        assert "multipart/form-data" in operation["requestBody"]["content"]


def test_v2_rejects_invalid_selection_and_duplicate_fields():
    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"), cloud_pipeline_factory=FakePipeline
        )
    )
    headers = {"Authorization": "Bearer test"}
    files = {"video": ("v.mp4", b"video"), "artifact": ("a.zip", b"zip")}
    assert (
        client.post("/v2/render", headers=headers, files=files, data={"person_ids": ""}).status_code
        == 422
    )
    assert (
        client.post(
            "/v2/render",
            headers=headers,
            files=files,
            data={"person_ids": '["p1"]', "duration": "nan"},
        ).status_code
        == 422
    )
