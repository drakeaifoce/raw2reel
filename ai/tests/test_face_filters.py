import pytest

from raw2reel_ai.config import Settings
from raw2reel_ai.face_filters import FaceFilters


def test_min_size_uses_actual_frame_dimensions_and_keeps_threshold():
    filters = FaceFilters(Settings(_env_file=None, cloud_face_dedup_enabled=False))
    boxes = [[0, 0, 0.05, 0.1], [0, 0, 0.049, 0.1], [0, 0, 0.1, 0.08], [0.3, 0.1, 0.35, 0.2]]
    result = filters.apply(boxes, (640, 360))
    assert result.boxes == [boxes[0], boxes[3]]  # 32x36 passes; 31.36x36 and 64x28.8 fail.
    assert result.removed_small == 2
    assert filters.apply([boxes[0]], (320, 180)).boxes == []


def test_duplicate_suppression_preserves_distinct_people_and_frame_order():
    filters = FaceFilters(Settings(_env_file=None, cloud_face_min_size_enabled=False))
    a, b, duplicate = [0.1, 0.1, 0.3, 0.4], [0.6, 0.1, 0.8, 0.4], [0.105, 0.105, 0.295, 0.395]
    result = filters.apply([a, b, duplicate], (640, 360))
    assert result.boxes == [a, b]
    assert result.removed_duplicates == 1


def test_filters_can_be_disabled_independently():
    small = [0, 0, 0.01, 0.01]
    for size_enabled, dedup_enabled, expected in [
        (False, False, 2),
        (False, True, 1),
        (True, False, 0),
    ]:
        filters = FaceFilters(
            Settings(
                _env_file=None,
                cloud_face_min_size_enabled=size_enabled,
                cloud_face_dedup_enabled=dedup_enabled,
            )
        )
        assert len(filters.apply([small, small], (640, 360)).boxes) == expected


def test_filter_settings_load_from_env_and_reject_invalid_thresholds(monkeypatch):
    monkeypatch.setenv("CLOUD_FACE_MIN_SIZE_ENABLED", "false")
    monkeypatch.setenv("CLOUD_FACE_DEDUP_ENABLED", "false")
    settings = Settings(_env_file=None)
    assert not settings.cloud_face_min_size_enabled
    assert not settings.cloud_face_dedup_enabled
    with pytest.raises(ValueError):
        Settings(_env_file=None, cloud_face_min_size_px=0)
    with pytest.raises(ValueError):
        Settings(_env_file=None, cloud_face_dedup_iou=1.1)


@pytest.mark.parametrize("enabled,expected", [(True, 2), (False, 4)])
def test_prepare_filters_before_grouping_and_reports_counts(
    tmp_path, monkeypatch, enabled, expected
):
    import io
    import json

    from PIL import Image

    from raw2reel_ai.cloud_models import Grouping, Interval, SamBox
    from raw2reel_ai.cloud_pipeline import CloudPipeline

    class FakeMeta:
        def close(self):
            pass

    class FakeCloud:
        calls = ()

        def sam(self, *_):
            boxes = [
                [0, 0, 0.01, 0.01],
                [0.1, 0.1, 0.3, 0.4],
                [0.105, 0.105, 0.295, 0.395],
                [0.6, 0.1, 0.8, 0.4],
            ]
            return [SamBox(frame=0, object_id=i, bbox=b) for i, b in enumerate(boxes)]

        def structured(self, schema, prompt, **kwargs):
            assert schema is Grouping
            assert len(kwargs["images"]) == expected
            batch = json.loads(prompt.split("Image order: ", 1)[1])
            return Grouping(
                assignments=[
                    {
                        "observation_id": x["new_observation_id"],
                        "person_id": "p1",
                        "label": "Character",
                    }
                    for x in batch
                ]
            )

    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    pipeline = CloudPipeline(
        Settings(
            _env_file=None, cloud_face_min_size_enabled=enabled, cloud_face_dedup_enabled=enabled
        ),
        meta=FakeMeta(),
        cloud=FakeCloud(),
    )
    monkeypatch.setattr(pipeline, "source", lambda _: (source, {"duration": 1, "has_audio": False}))
    monkeypatch.setattr(pipeline.media, "scenes", lambda *_: [Interval(start=0, end=1)])
    buffer = io.BytesIO()
    Image.new("RGB", (640, 360)).save(buffer, format="JPEG")
    monkeypatch.setattr(pipeline.media, "frame", lambda *_: buffer.getvalue())
    data = pipeline.prepare(source, tmp_path / "prepared.json")
    report = data["catalog"]["face_filtering"]
    assert len(data["catalog"]["observations"]) == expected
    assert report["candidates_before"] == 4 and report["candidates_after"] == expected
    assert report["removed_small"] == int(enabled)
    assert report["removed_duplicates"] == int(enabled)
