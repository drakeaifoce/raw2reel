import pytest
from pydantic import ValidationError

from raw2reel_ai.models import Segment
from raw2reel_ai.planning import make_srt


def test_plan_rejects_nonfinite_and_backwards_intervals():
    for start, end in [(2, 1), (0, float("nan")), (-1, 2), (0, float("inf"))]:
        with pytest.raises(ValidationError):
            Segment(start=start, end=end, reason="hook", subject_ids=[])


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
