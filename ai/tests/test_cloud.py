import json
import zipfile

import pytest

from raw2reel_ai.artifacts import read_artifact
from raw2reel_ai.cloud_meta import parse_sam
from raw2reel_ai.cloud_models import EditPlan


def test_sam_out_of_order_and_inclusive_coordinates():
    result = parse_sam(
        "<2f>7<|box;x1=10;y1=20;x2=29;y2=39;w=100;h=100|>"
        "<|mask;x=0;y=0;data=ignored|>\n<0f>7<|box;x1=0;y1=0;x2=9;y2=9;w=100;h=100|>"
    )
    assert [r.frame for r in result] == [0, 2]
    assert result[1].bbox == [0.1, 0.2, 0.3, 0.4]
    with pytest.raises(ValueError):
        parse_sam("<0f>1<|box;x1=5;y1=0;x2=3;y2=9;w=100;h=100|>")


def test_plan_rejects_unbounded_or_overlapping_clips():
    clip = {"start": 5, "end": 7, "reason": "hook", "person_ids": ["p1"]}
    with pytest.raises(ValueError):
        EditPlan(narrative="edit", clips=[clip, clip], impact_start=1, music_start=0)
    with pytest.raises(ValueError):
        EditPlan(narrative="edit", clips=[clip], impact_start=3, music_start=0)


def test_artifact_rejects_paths_and_large_uncompressed_files(tmp_path):
    target = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("../catalog.json", "{}")
    with pytest.raises(ValueError):
        read_artifact(target)
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("catalog.json", json.dumps({"bad": True}))
    with pytest.raises(ValueError):
        read_artifact(target)


def test_crop_prioritizes_first_person_and_falls_back_smoothly():
    from raw2reel_ai.cloud_models import TrackPoint
    from raw2reel_ai.models import Segment
    from raw2reel_ai.reframing import crop_centers, portrait_filter

    segment = Segment(start=0, end=2, reason="test", subject_ids=["p1", "p2"])
    points = [
        TrackPoint(time=0, person_id="p1", scene=0, bbox=[0.1, 0.2, 0.2, 0.4]),
        TrackPoint(time=0, person_id="p2", scene=0, bbox=[0.8, 0.2, 0.9, 0.4]),
    ]
    centers = crop_centers(segment, points, ["p1", "p2"])
    assert centers[0][1] == pytest.approx(0.15)
    assert 0.15 < centers[-1][1] < 0.5
    assert "scale=720:1280" in portrait_filter(segment, points, ["p1", "p2"])


def test_impact_remaps_after_frame_quantization():
    from raw2reel_ai.cloud_models import EditClip
    from raw2reel_ai.models import Segment
    from raw2reel_ai.planning import quantize_segments
    from raw2reel_ai.reframing import remap_impact

    clips = [
        EditClip(start=0, end=0.39, reason="a", person_ids=["p1"]),
        EditClip(start=1, end=2, reason="b", person_ids=["p1"]),
    ]
    segments = quantize_segments(
        [
            Segment(start=c.start, end=c.end, reason=c.reason, subject_ids=c.person_ids)
            for c in clips
        ]
    )
    assert remap_impact(clips, segments, 0.39) == pytest.approx(11 / 30)


def test_square_source_keeps_group_that_fits_portrait():
    from raw2reel_ai.cloud_models import TrackPoint
    from raw2reel_ai.models import Segment
    from raw2reel_ai.reframing import crop_centers

    segment = Segment(start=0, end=1, reason="group", subject_ids=["p1", "p2"])
    points = [
        TrackPoint(time=0, person_id="p1", scene=0, bbox=[0.25, 0.2, 0.35, 0.4]),
        TrackPoint(time=0, person_id="p2", scene=0, bbox=[0.65, 0.2, 0.75, 0.4]),
    ]
    centers = crop_centers(segment, points, ["p1", "p2"], aspect_ratio=1)
    assert centers[0][1] == pytest.approx(0.5)
