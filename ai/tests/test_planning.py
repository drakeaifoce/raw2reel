import pytest
from pydantic import ValidationError
from raw2reel_ai.models import Analysis, Segment
from raw2reel_ai.planning import choose_segments, make_srt


def test_plan_rejects_nonfinite_and_backwards_intervals():
    for start, end in [(2, 1), (0, float("nan")), (-1, 2), (0, float("inf"))]:
        with pytest.raises(ValidationError):
            Segment(start=start, end=end, reason="hook", subject_ids=[])


def test_selection_filters_people_trims_to_target_and_does_not_repeat_frames():
    analysis = Analysis.model_validate(
        {
            "summary": "A conversation",
            "hook": "The answer",
            "subjects": [
                {
                    "id": "p1",
                    "label": "Blue shirt",
                    "description": "Blue shirt",
                    "timestamp": 2,
                    "bbox": [0.1, 0.1, 0.5, 0.8],
                }
            ],
            "segments": [
                {"start": 10, "end": 15, "reason": "hook", "subject_ids": ["p1"]},
                {"start": 1, "end": 5, "reason": "context", "subject_ids": []},
                {"start": 20, "end": 28, "reason": "ending", "subject_ids": ["p1"]},
            ],
        }
    )
    chosen = choose_segments(analysis, ["p1"], 7, 30)
    assert [(s.start, s.end) for s in chosen] == [(10, 15), (20, 22)]
    with pytest.raises(ValueError):
        choose_segments(analysis, ["unknown"], 7, 30)


def test_out_of_bounds_and_overlaps_rejected():
    base = {"summary": "s", "hook": "h", "subjects": []}
    for segments in [
        [{"start": 1, "end": 100, "reason": "r", "subject_ids": []}],
        [
            {"start": 1, "end": 4, "reason": "r", "subject_ids": []},
            {"start": 3, "end": 5, "reason": "r", "subject_ids": []},
        ],
    ]:
        with pytest.raises(ValueError):
            choose_segments(
                Analysis.model_validate({**base, "segments": segments}), [], 10, 20
            )


def test_captions_are_clipped_and_remapped_across_reordered_cuts():
    segments = [
        Segment(start=10, end=12, reason="a", subject_ids=[]),
        Segment(start=2, end=5, reason="b", subject_ids=[]),
    ]
    srt = make_srt(
        [
            {"startMs": 10500, "endMs": 13000, "transcript": "First <script> {\\b1}"},
            {"startMs": 1000, "endMs": 3500, "transcript": "Second\nline"},
        ],
        segments,
    )
    assert "00:00:00,500 --> 00:00:02,000" in srt
    assert "00:00:02,000 --> 00:00:03,500" in srt
    assert "<script>" not in srt and "\\b1" not in srt


def test_no_word_timing_or_captions_invented_for_silence():
    assert make_srt([], [Segment(start=0, end=2, reason="a", subject_ids=[])]) == ""
