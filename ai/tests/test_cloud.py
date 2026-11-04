import json

import pytest

from raw2reel_ai.analysis import read_analysis
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


def test_analysis_rejects_invalid_json_and_unknown_fields(tmp_path):
    path = tmp_path / "prepared.json"
    path.write_text('{"bad": true}')
    with pytest.raises(ValueError):
        read_analysis(path)
    path.write_text("not-json")
    with pytest.raises(ValueError):
        read_analysis(path)


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
    assert centers[-1][1] == pytest.approx(0.15)
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


def test_cli_debug_preserves_safe_stack(monkeypatch, capsys, tmp_path):
    import raw2reel_ai.cli as cli

    class BrokenPipeline:
        def __init__(self, *_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def prepare(self, *_, **kwargs):
            raise ValueError("grouping diagnostic marker")

    monkeypatch.setattr(cli, "CloudPipeline", BrokenPipeline)
    args = [
        "--env-file",
        str(tmp_path / "none.env"),
        "--debug",
        "prepare",
        str(tmp_path / "source.mp4"),
        "--output",
        str(tmp_path / "result.json"),
    ]
    assert cli.main(args) == 1
    output = capsys.readouterr().err
    event = next(
        json.loads(line)
        for line in output.splitlines()
        if line.startswith("{") and "command_failed" in line
    )
    assert event["error_type"] == "ValueError"
    assert event["traceback"][-1]["function"] == "prepare"
    assert "grouping diagnostic marker" not in output


def test_cloud_incomplete_and_missing_output_are_model_errors():
    from raw2reel_ai.cloud_meta import output_text
    from raw2reel_ai.meta import MetaError

    with pytest.raises(MetaError, match="max_output_tokens") as error:
        output_text({"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}})
    assert error.value.code == "model_token_limit"
    with pytest.raises(MetaError):
        output_text({"status": "completed", "output": None})


def test_grouping_uses_low_reasoning_and_reports_progress(tmp_path):
    import json

    import httpx

    from raw2reel_ai.cloud_meta import CloudModels
    from raw2reel_ai.cloud_models import Grouping
    from raw2reel_ai.config import Settings
    from raw2reel_ai.meta import MetaClient

    def handler(request):
        body = json.loads(request.content)
        assert body["reasoning"]["effort"] == "low"
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"assignments":[]}'}],
                    }
                ],
            },
        )

    client = MetaClient(
        Settings(_env_file=None, model_api_key="test"), transport=httpx.MockTransport(handler)
    )
    try:
        assert (
            CloudModels(client).structured(Grouping, "group", stage="face_grouping").assignments
            == []
        )
    finally:
        client.close()


def test_analysis_validates_images_and_references():
    from raw2reel_ai.analysis import read_analysis
    from test_cloud_api import prepared_payload

    value = prepared_payload()
    value["thumbnails"]["o0"] = "data:image/jpeg;base64,eA=="
    with pytest.raises(ValueError, match="JPEG"):
        read_analysis(value)
    value = prepared_payload()
    value["thumbnails"]["o99"] = value["thumbnails"].pop("o0")
    with pytest.raises(ValueError, match="thumbnail"):
        read_analysis(value)
