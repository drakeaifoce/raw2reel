import base64
import io
import json

from fastapi.testclient import TestClient
from PIL import Image

from raw2reel_ai.analysis import read_analysis
from raw2reel_ai.config import Settings
from raw2reel_ai.main import create_app


def prepared_payload():
    buffer = io.BytesIO()
    Image.effect_noise((192, 192), 100).convert("RGB").save(buffer, format="JPEG", quality=90)
    return {
        "catalog": {
            "version": 2,
            "source_sha256": "0" * 64,
            "source_duration": 1,
            "scenes": [{"start": 0, "end": 1}],
            "observations": [{"id": "o0", "scene": 0, "time": 0.5, "bbox": [0.1, 0.1, 0.5, 0.5]}],
            "people": [{"id": "p1", "label": "Character 1", "observation_ids": ["o0"]}],
            "turns": [],
            "warnings": [],
            "provenance": {"schema": "2"},
        },
        "thumbnails": {
            "o0": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()
        },
        "calls": [],
    }


class FakePipeline:
    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def prepare(self, source, output):
        assert source.read_bytes() == b"video"
        return prepared_payload()

    def render(self, source, output, **options):
        catalog, images = read_analysis(options["analysis"])
        assert catalog.people[0].id == "p1"
        assert images["o0"]
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
    assert response.status_code == 200 and response.json()["catalog"]["people"][0]["id"] == "p1"
    response = client.post(
        "/v2/render",
        headers=headers,
        files={"video": ("v.mp4", b"video")},
        data={
            "analysis": json.dumps(response.json()),
            "person_ids": '["p1"]',
            "duration": "20",
            "captions": "false",
        },
    )
    assert response.status_code == 200 and response.content == b"mp4"
    schema = client.get("/openapi.json").json()
    properties = schema["paths"]["/v2/render"]["post"]["requestBody"]["content"][
        "multipart/form-data"
    ]["schema"]["properties"]
    assert properties["analysis"]["type"] == "string"
    assert set(properties) == {"video", "music", "analysis", "person_ids", "duration", "captions"}
    assert len(json.dumps(prepared_payload())) > 4096
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
    files = {"video": ("v.mp4", b"video")}
    assert (
        client.post(
            "/v2/render",
            headers=headers,
            files=files,
            data={"analysis": json.dumps(prepared_payload()), "person_ids": ""},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v2/render",
            headers=headers,
            files=files,
            data={
                "analysis": json.dumps(prepared_payload()),
                "person_ids": '["p1"]',
                "duration": "nan",
            },
        ).status_code
        == 422
    )
