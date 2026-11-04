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
        return ShotGrounding(faces=[dict(frame=0, person_id="p1", bbox=[0.65, 0.2, 0.75, 0.4])])

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


def test_already_tracked_scene_is_not_reprocessed(tmp_path):
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
    assert cloud.ground_calls == 0 and result.tracks == points
