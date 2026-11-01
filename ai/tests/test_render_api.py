from typing import ClassVar

from fastapi.testclient import TestClient

from raw2reel_ai.config import Settings
from raw2reel_ai.main import create_app
from raw2reel_ai.media import MediaError


class FakePipeline:
    calls: ClassVar[list] = []

    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def render(self, source, output, **options):
        assert source.read_bytes() == b"video"
        if options["music"]:
            assert options["music"].read_bytes() == b"music"
        self.calls.append((output, options))
        output.write_bytes(b"rendered-mp4")
        return {"duration": options["duration"]}


def client(**settings):
    return TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test", **settings),
            pipeline_factory=FakePipeline,
        )
    )


def test_render_calls_pipeline_and_cleans_files():
    response = client().post(
        "/v1/render",
        headers={"Authorization": "Bearer test"},
        files={"video": ("../../clip.mp4", b"video"), "music": ("track.mp3", b"music")},
        data={"duration": "20", "captions": "false"},
    )
    assert response.status_code == 200
    assert response.content == b"rendered-mp4"
    assert response.headers["content-type"] == "video/mp4"
    output, options = FakePipeline.calls[-1]
    assert options["duration"] == 20
    assert options["captions"] is False
    assert not output.parent.exists()


def test_auth_before_parsing_upload():
    assert client().post("/v1/render", content=b"invalid").status_code == 401
    unconfigured = TestClient(create_app(Settings(_env_file=None)))
    assert unconfigured.post("/v1/render").status_code == 503
    assert unconfigured.get("/health").status_code == 200


def test_invalid_options_and_file_limits():
    headers = {"Authorization": "Bearer test"}
    assert (
        client()
        .post(
            "/v1/render",
            headers=headers,
            files={"video": ("v.mp4", b"video")},
            data={"duration": "31"},
        )
        .status_code
        == 422
    )
    assert (
        client(max_upload_bytes=2)
        .post("/v1/render", headers=headers, files={"video": ("v.mp4", b"video")})
        .status_code
        == 413
    )


def test_media_errors_are_safe():
    class BrokenPipeline(FakePipeline):
        def render(self, *args, **kwargs):
            raise MediaError("Could not decode or render this media file.")

    app = create_app(
        Settings(_env_file=None, ai_service_token="test"),
        pipeline_factory=BrokenPipeline,
    )
    response = TestClient(app).post(
        "/v1/render",
        headers={"Authorization": "Bearer test"},
        files={"video": ("v.mp4", b"video")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "media_error"


def test_busy_service_rejects_second_render():
    import threading
    from concurrent.futures import ThreadPoolExecutor

    entered, finish = threading.Event(), threading.Event()

    class WaitingPipeline(FakePipeline):
        def render(self, *args, **kwargs):
            entered.set()
            assert finish.wait(5)
            return super().render(*args, **kwargs)

    test_client = TestClient(
        create_app(
            Settings(_env_file=None, ai_service_token="test"),
            pipeline_factory=WaitingPipeline,
        )
    )

    def send():
        return test_client.post(
            "/v1/render",
            headers={"Authorization": "Bearer test"},
            files={"video": ("v.mp4", b"video")},
        )

    with ThreadPoolExecutor() as pool:
        pending = pool.submit(send)
        try:
            assert entered.wait(5)
            assert send().status_code == 429
        finally:
            finish.set()
        assert pending.result().status_code == 200


def test_request_body_limit_without_content_length():
    response = client(max_upload_bytes=1, max_music_bytes=1).post(
        "/v1/render",
        headers={
            "Authorization": "Bearer test",
            "Content-Type": "multipart/form-data; boundary=x",
        },
        content=iter([b"--x\r\n" + b"a" * (1024 * 1024 + 10)]),
    )
    assert response.status_code == 413


def test_swagger_documents_service_bearer_token():
    schema = client().get("/openapi.json").json()
    security = schema["paths"]["/v1/render"]["post"]["security"]
    assert security == [{"AIServiceToken": []}]
    assert schema["components"]["securitySchemes"]["AIServiceToken"]["scheme"] == "bearer"
    assert "security" not in schema["paths"]["/health"]["get"]


def test_swagger_documents_upload_fields():
    operation = client().get("/openapi.json").json()["paths"]["/v1/render"]["post"]
    schema = operation["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert schema["required"] == ["video"]
    assert schema["properties"]["video"]["format"] == "binary"
    assert schema["properties"]["music"]["format"] == "binary"
    assert schema["properties"]["duration"]["default"] == 27
    assert schema["properties"]["captions"]["default"] is True
