import base64
import io
import json

from fastapi.testclient import TestClient
from PIL import Image

from raw2reel_ai.analysis import read_analysis
from raw2reel_ai.config import Settings
from raw2reel_ai.main import create_app
from raw2reel_ai.media import MediaError


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


def test_async_render_is_idempotent_and_survives_a_dropped_connection():
    """Повтор с тем же ключом не запускает вторую работу.

    Это и делает обрыв связи безопасным: раньше результат жил только внутри
    одного HTTP-соединения, и перезапуск клиента стоил уже посчитанного
    рендера.
    """
    renders = []

    class CountingPipeline(FakePipeline):
        def render(self, source, output, **options):
            renders.append(options["person_ids"])
            super().render(source, output, **options)

    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"),
            cloud_pipeline_factory=CountingPipeline,
        )
    )
    headers = {"Authorization": "Bearer test", "Idempotency-Key": "job-42"}
    payload = {
        "files": {"video": ("v.mp4", b"video")},
        "data": {
            "analysis": json.dumps(prepared_payload()),
            "person_ids": '["p1"]',
            "duration": "20",
            "captions": "false",
        },
    }

    accepted = client.post("/v2/render", headers=headers, **payload)
    assert accepted.status_code == 202
    assert accepted.json()["job_id"] == "job-42"

    # Повтор: клиент не знает, дошёл ли первый запрос. Вторая работа не
    # запускается, ответ тот же.
    again = client.post("/v2/render", headers=headers, **payload)
    assert again.status_code == 202 and again.json()["job_id"] == "job-42"

    result = client.get("/v2/jobs/job-42", headers={"Authorization": "Bearer test"})
    assert result.status_code == 200 and result.content == b"mp4"
    assert len(renders) == 1

    # Результат забирают один раз: дальше сервис про задачу забывает, и
    # клиент honestly начнёт заново.
    assert (
        client.get("/v2/jobs/job-42", headers={"Authorization": "Bearer test"}).status_code == 404
    )


def test_async_render_reports_failure_instead_of_hanging():
    class FailingPipeline(FakePipeline):
        def render(self, source, output, **options):
            raise MediaError("broken source")

    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"),
            cloud_pipeline_factory=FailingPipeline,
        )
    )
    headers = {"Authorization": "Bearer test", "Idempotency-Key": "job-bad"}
    accepted = client.post(
        "/v2/render",
        headers=headers,
        files={"video": ("v.mp4", b"video")},
        data={
            "analysis": json.dumps(prepared_payload()),
            "person_ids": '["p1"]',
            "duration": "20",
        },
    )
    assert accepted.status_code == 202

    state = client.get("/v2/jobs/job-bad", headers={"Authorization": "Bearer test"}).json()
    assert state["status"] == "failed" and state["error"]["code"] == "media_error"


def test_sync_render_still_returns_the_file():
    """Старый путь без ключа не тронут: на нём держится текущий бэкенд."""
    client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"), cloud_pipeline_factory=FakePipeline
        )
    )
    response = client.post(
        "/v2/render",
        headers={"Authorization": "Bearer test"},
        files={"video": ("v.mp4", b"video")},
        data={
            "analysis": json.dumps(prepared_payload()),
            "person_ids": '["p1"]',
            "duration": "20",
        },
    )
    assert response.status_code == 200 and response.content == b"mp4"
