import pytest

from raw2reel_ai.cloud_models import EditPlan, Interval
from raw2reel_ai.dialogue_setup import complete_dialogue
from raw2reel_ai.edit_structure import build_edit


def plan():
    return EditPlan(
        narrative="setup",
        impact_start=3.7,
        music_start=0,
        clips=[
            dict(start=10.5, end=14.2, reason="middle of speech", person_ids=["p1"]),
            dict(start=30, end=34, reason="impact", person_ids=["p1"]),
        ],
    )


def test_dialogue_is_completed_on_original_speech_boundary():
    setup = complete_dialogue(
        plan(),
        [dict(startMs=10000, endMs=15000, transcript="A complete thought.")],
        [Interval(start=8, end=18)],
    )
    assert setup.quote == "A complete thought."
    assert setup.clips[0].start <= 10 and setup.clips[0].end >= 15
    edit = build_edit(plan(), setup_override=setup.clips)
    assert edit.impact_start > 5 and sum(s.end - s.start for s in edit.segments) == pytest.approx(
        20
    )


def test_dialogue_may_finish_across_two_contiguous_reviewed_shots():
    setup = complete_dialogue(
        plan(),
        [dict(startMs=10000, endMs=15000, transcript="A complete thought.")],
        [Interval(start=8, end=12), Interval(start=12, end=18)],
    )
    assert len(setup.clips) == 2 and setup.clips[0].end == setup.clips[1].start
    assert setup.clips[-1].end >= 15


def test_gaps_and_unreviewed_dialogue_are_never_invented():
    setup = complete_dialogue(
        plan(),
        [dict(startMs=10000, endMs=15000, transcript="A complete thought.")],
        [Interval(start=8, end=12), Interval(start=13, end=18)],
    )
    assert setup.clips is None and setup.warnings


def test_drop_follows_recognized_complete_phrase_instead_of_trailing_pause():
    from raw2reel_ai.cloud_models import EditClip
    from raw2reel_ai.dialogue_setup import finish_at_speech_end

    clips = [EditClip(start=178.37, end=181.84, reason="phrase", person_ids=["p1"])]
    result = finish_at_speech_end(
        clips,
        "Makes me look so tough.",
        [dict(startMs=0, endMs=780, transcript="makes me look so tough")],
    )
    assert result[0].end - result[0].start == pytest.approx(0.9)


def test_partial_or_different_asr_text_cannot_cut_a_phrase_short():
    from raw2reel_ai.cloud_models import EditClip
    from raw2reel_ai.dialogue_setup import finish_at_speech_end

    clips = [EditClip(start=10, end=15, reason="phrase", person_ids=["p1"])]
    result = finish_at_speech_end(
        clips, "A complete long thought.", [dict(startMs=0, endMs=780, transcript="A")]
    )
    assert result == clips


def test_short_reaction_is_expanded_with_preceding_dialogue_context():
    original = EditPlan(
        narrative="setup",
        impact_start=3.6,
        music_start=0,
        clips=[
            dict(start=179.36, end=182.96, reason="isolated reaction", person_ids=["p1"]),
            dict(start=190, end=194, reason="impact", person_ids=["p1"]),
        ],
    )
    setup = complete_dialogue(
        original,
        [
            dict(startMs=174700, endMs=178380, transcript="I like standing next to you, Sean."),
            dict(startMs=178620, endMs=181740, transcript="Makes me look so tough."),
        ],
        [Interval(start=173.84, end=177.42725), Interval(start=177.42725, end=184.184)],
    )
    assert "standing next to you" in setup.quote and "Makes me look so tough" in setup.quote
    assert 6 <= sum(c.end - c.start for c in setup.clips) <= 10
    assert len(setup.clips) <= 2


def test_unreliable_asr_cannot_collapse_context_rich_setup_to_one_second():
    from raw2reel_ai.cloud_models import EditClip
    from raw2reel_ai.dialogue_setup import finish_at_speech_end

    quote = "I like standing next to you Sean. Makes me look so tough."
    clips = [EditClip(start=10, end=17, reason="context", person_ids=["p1"])]
    assert (
        finish_at_speech_end(clips, quote, [dict(startMs=0, endMs=780, transcript=quote)]) == clips
    )
