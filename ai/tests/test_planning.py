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


def test_captions_change_every_two_or_three_words():
    segment = Segment(start=0, end=6, reason="speech", subject_ids=[])
    srt = make_srt(
        [
            {
                "startMs": 0,
                "endMs": 6000,
                "transcript": "one two three four five six seven eight nine",
            }
        ],
        [segment],
    )
    cues = srt.split("\n\n")
    assert [c.splitlines()[2] for c in cues] == [
        "one two three",
        "four five six",
        "seven eight nine",
    ]
    assert cues[0].splitlines()[1] == "00:00:00,000 --> 00:00:02,000"
    assert cues[-1].splitlines()[1] == "00:00:04,000 --> 00:00:06,000"


def test_captions_split_before_clipping_and_reordering():
    srt = make_srt(
        [
            {
                "startMs": 0,
                "endMs": 6000,
                "transcript": "one two three four five six seven eight nine",
            }
        ],
        [
            Segment(start=4, end=6, reason="last", subject_ids=[]),
            Segment(start=0, end=2, reason="first", subject_ids=[]),
        ],
    )
    cues = srt.split("\n\n")
    assert [c.splitlines()[2] for c in cues] == ["seven eight nine", "one two three"]
    assert cues[1].splitlines()[1] == "00:00:02,000 --> 00:00:04,000"


def test_long_words_do_not_make_multiline_paragraphs():
    text = "extraordinarily complicated conversations " + "x" * 60
    srt = make_srt(
        [{"startMs": 0, "endMs": 6000, "transcript": text}],
        [Segment(start=0, end=6, reason="speech", subject_ids=[])],
    )
    for cue in srt.split("\n\n"):
        assert len(cue.splitlines()[2]) <= 26
        assert len(cue.splitlines()[2].split()) <= 3


def test_four_words_are_balanced_into_two_short_cues():
    srt = make_srt(
        [{"startMs": 0, "endMs": 2000, "transcript": "one two three four"}],
        [Segment(start=0, end=2, reason="speech", subject_ids=[])],
    )
    assert [c.splitlines()[2] for c in srt.split("\n\n")] == ["one two", "three four"]


def test_overlapping_speakers_do_not_stack_caption_blocks():
    srt = make_srt(
        [
            {"startMs": 0, "endMs": 2000, "transcript": "first speaker"},
            {"startMs": 1000, "endMs": 3000, "transcript": "second speaker"},
        ],
        [Segment(start=0, end=3, reason="dialogue", subject_ids=[])],
    )
    assert "00:00:00,000 --> 00:00:01,000" in srt
    assert "00:00:01,000 --> 00:00:03,000" in srt


def test_caption_blocks_respect_sentence_endings():
    srt = make_srt(
        [{"startMs": 0, "endMs": 3000, "transcript": "Вот, здравствуйте. А вы нигде не"}],
        [Segment(start=0, end=3, reason="speech", subject_ids=[])],
    )
    assert srt.split("\n\n")[0].splitlines()[2] == "Вот, здравствуйте."


def test_karaoke_captions_end_before_impact_and_highlight_active_word():
    from raw2reel_ai.models import Segment
    from raw2reel_ai.planning import make_ass

    segments = [
        Segment(start=0, end=3, reason="setup", subject_ids=[]),
        Segment(start=10, end=12, reason="impact", subject_ids=[]),
    ]
    turns = [
        dict(startMs=0, endMs=3000, transcript="ONE TWO THREE FOUR FIVE SIX"),
        dict(startMs=10000, endMs=12000, transcript="MUST NOT APPEAR"),
    ]
    ass = make_ass(turns, segments, until=2.5)
    assert "[Script Info]" in ass and "MUST NOT APPEAR" not in ass
    events = [line.split(",", 9) for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(events) >= 5
    assert all(float(e[2].split(":")[-1]) <= 2.5 for e in events)
    assert any(r"{\c&H00FFFF&}ONE" in e[9] for e in events)
    assert any(r"{\c&H00FFFF&}TWO" in e[9] for e in events)


def test_karaoke_cannot_inject_ass_tags():
    from raw2reel_ai.models import Segment
    from raw2reel_ai.planning import make_ass

    text = make_ass(
        [dict(startMs=0, endMs=1000, transcript=r"{\pos(0,0)}HELLO <b>WORLD</b>")],
        [Segment(start=0, end=1, reason="safe", subject_ids=[])],
        until=0.5,
    )
    assert r"\pos" not in text and "<b>" not in text


def test_karaoke_does_not_retime_words_from_a_partially_clipped_phrase():
    from raw2reel_ai.planning import make_ass

    ass = make_ass(
        [dict(startMs=0, endMs=6000, transcript="ONE TWO THREE FOUR FIVE SIX")],
        [Segment(start=2, end=4, reason="middle", subject_ids=[])],
        until=2,
    )
    assert "ONE" not in ass and "TWO" not in ass and "FIVE" not in ass
    assert "THREE" in ass and "FOUR" in ass
