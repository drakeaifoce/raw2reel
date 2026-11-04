import itertools

import pytest

from raw2reel_ai.cloud_models import EditPlan
from raw2reel_ai.edit_structure import build_edit


def plan(clips=None, impact=7):
    return EditPlan(
        narrative="hook and impact",
        impact_start=impact,
        music_start=0,
        clips=clips
        or [
            dict(start=10, end=17, reason="dialogue", person_ids=["p1"]),
            dict(start=30, end=33, reason="reaction", person_ids=["p1"]),
            dict(start=50, end=53, reason="action", person_ids=["p1"]),
        ],
    )


def split(edit):
    position = 0
    setup, impact = [], []
    for clip in edit.segments:
        (setup if position < edit.impact_start - 1e-6 else impact).append(clip)
        position += clip.end - clip.start
    return setup, impact


def test_fixed_twenty_seconds_fast_impact_and_approved_source_bounds():
    original = plan()
    edit = build_edit(original)
    setup, impact = split(edit)
    assert sum(round((s.end - s.start) * 30) for s in edit.segments) == 600
    assert edit.impact_start == 7 and len(setup) == 1 and len(impact) >= 14
    assert all(0.4 - 1e-6 <= s.end - s.start <= 0.9 + 1e-6 for s in impact)
    assert all(
        any(s.start >= c.start - 1e-8 and s.end <= c.end + 1e-8 for c in original.clips)
        for s in edit.segments
    )
    assert any("reus" in w.lower() for w in edit.warnings)
    assert all((a.start < 40) != (b.start < 40) for a, b in itertools.pairwise(impact))


def test_setup_has_at_most_two_shots_and_caps_eight_seconds():
    clips = [dict(start=i * 10, end=i * 10 + 3, reason="shot", person_ids=["p1"]) for i in range(5)]
    edit = build_edit(plan(clips, impact=10))
    setup, impact = split(edit)
    assert len(setup) == 2 and edit.impact_start == 6
    assert impact and sum(s.end - s.start for s in edit.segments) == pytest.approx(20)


def test_one_short_approved_interval_reuses_without_extending_source():
    original = plan(
        [dict(start=2.013, end=3.147, reason="only shot", person_ids=["p1"])], impact=0.5
    )
    edit = build_edit(original)
    assert sum(round((s.end - s.start) * 30) for s in edit.segments) == 600
    assert all(s.start >= 2.013 - 1e-8 and s.end <= 3.147 + 1e-8 for s in edit.segments)
    assert 0 < edit.impact_start < 20 and edit.warnings


def test_beat_grid_controls_fast_cuts_without_tiny_tail():
    edit = build_edit(plan(), bpm=120, impact_beats=[i * 0.5 for i in range(40)])
    _, impact = split(edit)
    assert all(s.end - s.start == pytest.approx(0.5) for s in impact)


def test_large_setup_is_capped_and_split_boundary_stays_in_approved_interval():
    original = plan(
        [
            dict(start=0, end=15, reason="long dialogue", person_ids=["p1"]),
            dict(start=20, end=25, reason="action", person_ids=["p1"]),
        ],
        impact=12,
    )
    edit = build_edit(original)
    assert edit.impact_start == 8
    assert all(
        any(s.start >= c.start - 1e-8 and s.end <= c.end + 1e-8 for c in original.clips)
        for s in edit.segments
    )
    assert sum(s.end - s.start for s in edit.segments) == pytest.approx(20)


def test_thirteen_frame_reservoir_has_no_tiny_terminal_flash():
    original = plan(
        [
            dict(start=0, end=8, reason="setup", person_ids=["p1"]),
            dict(start=20, end=20 + 13 / 30, reason="impact", person_ids=["p1"]),
        ],
        impact=8,
    )
    edit = build_edit(original)
    _, impact = split(edit)
    assert all(12 <= round((s.end - s.start) * 30) <= 13 for s in impact)
    assert sum(round((s.end - s.start) * 30) for s in edit.segments) == 600
