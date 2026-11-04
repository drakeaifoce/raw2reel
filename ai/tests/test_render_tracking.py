from pathlib import Path

from raw2reel_ai.cloud_models import Interval, SamBox, TrackPoint
from raw2reel_ai.config import Settings
from raw2reel_ai.models import Segment
from raw2reel_ai.render_tracking import ShotGrounding, refine_tracks


class Media:
    def frame(self, *_):
        return b"frame"

    def clip(self, *_):
        pass


class Tools:
    def probe(self, *_):
        return dict(width=640, height=360, duration=2)


class Cloud:
    def __init__(self):
        self.ground_calls = 0
        self.sam_calls = 0

    def structured(self, schema, *_, **__):
        assert schema is ShotGrounding
        self.ground_calls += 1
        return ShotGrounding(faces=[dict(frame=0, person_id="p1", bbox=[650, 200, 750, 400])])

    def sam(self, *_):
        self.sam_calls += 1
        return [SamBox(frame=i, object_id=1, bbox=[0.65, 0.2, 0.75, 0.4]) for i in range(10)]


def test_selected_untracked_scene_gets_reference_grounding_and_sam(tmp_path):
    cloud = Cloud()
    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        [],
        settings=Settings(_env_file=None),
        cloud=cloud,
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=0,
    )
    assert cloud.ground_calls == 1 and cloud.sam_calls == 1
    assert len(result.tracks) >= 10 and all(p.person_id == "p1" for p in result.tracks)
    assert result.used_seconds == 2


def test_correct_dense_track_is_verified_without_repeating_sam(tmp_path):
    cloud = Cloud()
    points = [
        TrackPoint(time=10 + i * 0.2, person_id="p1", scene=0, bbox=[0.65, 0.2, 0.75, 0.4])
        for i in range(10)
    ]
    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        points,
        settings=Settings(_env_file=None),
        cloud=cloud,
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=2,
    )
    assert cloud.ground_calls == 1 and cloud.sam_calls == 0
    assert all(p in result.tracks for p in points)


def test_optional_grounding_schema_error_keeps_full_frame_instead_of_aborting(tmp_path):
    from raw2reel_ai.meta import MetaError

    class Invalid(Cloud):
        def structured(self, *_, **__):
            raise MetaError("model_response", "Cloud model returned invalid structured data.")

    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        [],
        settings=Settings(_env_file=None),
        cloud=Invalid(),
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=0,
    )
    assert result.tracks == [] and result.warnings


def test_actual_spark_thousand_grid_response_is_converted_for_crop(tmp_path):
    class ThousandGrid(Cloud):
        def structured(self, *_, **__):
            return ShotGrounding(faces=[dict(frame=0, person_id="p1", bbox=[630, 275, 755, 445])])

    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        [],
        settings=Settings(_env_file=None),
        cloud=ThousandGrid(),
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=120,
    )
    assert result.tracks[0].bbox == [0.63, 0.275, 0.755, 0.445]


def test_optional_sam_failure_retains_reference_grounded_anchors(tmp_path):
    from raw2reel_ai.meta import MetaError

    class FailedSam(Cloud):
        def sam(self, *_):
            raise MetaError("model_response", "Invalid SAM segmentation output.")

    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        [],
        settings=Settings(_env_file=None),
        cloud=FailedSam(),
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=0,
    )
    assert result.tracks and result.tracks[0].bbox == [0.65, 0.2, 0.75, 0.4]
    assert result.warnings


def test_dense_track_of_background_subject_is_not_trusted_without_reference_check(tmp_path):
    cloud = Cloud()
    wrong = [
        TrackPoint(time=10 + i * 0.2, person_id="p1", scene=0, bbox=[0.1, 0.2, 0.2, 0.4])
        for i in range(10)
    ]
    result = refine_tracks(
        Path("video.mp4"),
        [Segment(start=10, end=12, reason="setup", subject_ids=["p1"])],
        [Interval(start=10, end=12)],
        {"p1": b"reference"},
        wrong,
        settings=Settings(_env_file=None),
        cloud=cloud,
        media=Media(),
        tools=Tools(),
        work=tmp_path,
        used_seconds=2,
    )
    assert cloud.ground_calls == 1 and cloud.sam_calls == 1
    assert all(p.bbox[0] > 0.5 for p in result.tracks)
