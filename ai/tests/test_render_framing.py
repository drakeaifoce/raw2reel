import pytest
from PIL import Image

from raw2reel_ai.cloud_models import TrackPoint
from raw2reel_ai.models import Segment
from raw2reel_ai.reframing import crop_centers, detect_content_bounds, portrait_filter


def test_tracking_holds_subject_instead_of_drifting_to_middle():
    segment = Segment(start=10, end=12, reason="shot", subject_ids=["p1"])
    points = [TrackPoint(time=10, person_id="p1", scene=0, bbox=[0.65, 0.2, 0.75, 0.4])]
    centers = crop_centers(segment, points, ["p1"])
    assert all(c[1] == pytest.approx(0.7) for c in centers)


def test_first_video_frame_uses_nearby_future_detection():
    segment = Segment(start=10, end=11, reason="shot", subject_ids=["p1"])
    points = [TrackPoint(time=10.1, person_id="p1", scene=0, bbox=[0.65, 0.2, 0.75, 0.4])]
    assert crop_centers(segment, points, ["p1"])[0][1] == pytest.approx(0.7)


def test_stable_letterbox_detected_despite_corner_watermark():
    frames = []
    for color in ("#403020", "#705040", "#908070"):
        image = Image.new("RGB", (640, 360), "black")
        image.paste(color, (0, 46, 640, 314))
        image.paste("white", (15, 320, 85, 342))
        frames.append(image)
    bounds = detect_content_bounds(frames)
    assert bounds[1] == pytest.approx(46 / 360, abs=0.01)
    assert bounds[3] == pytest.approx(314 / 360, abs=0.01)


def test_black_frame_and_unstable_dark_edges_are_not_content_crop():
    assert detect_content_bounds([Image.new("RGB", (640, 360), "black")] * 3) == (0, 0, 1, 1)
    assert detect_content_bounds([Image.new("RGB", (640, 360), "white")] * 3) == (0, 0, 1, 1)


def test_portrait_crop_uses_rebased_tracking_after_letterbox_removal():
    segment = Segment(start=0, end=1, reason="shot", subject_ids=["p1"])
    points = [TrackPoint(time=0, person_id="p1", scene=0, bbox=[0.65, 0.2, 0.75, 0.4])]
    result = portrait_filter(
        segment, points, ["p1"], aspect_ratio=640 / 360, content_bounds=(0, 46 / 360, 1, 314 / 360)
    )
    assert result.count("crop=") == 2
