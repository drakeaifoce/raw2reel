"""Finish the chosen setup on a complete, actually transcribed source utterance."""

import itertools
from dataclasses import dataclass

from .cloud_models import EditClip


@dataclass
class DialogueSetup:
    clips: list[EditClip] | None
    quote: str
    warnings: list[str]


SETUP_TARGET_SECONDS = 8
SETUP_PREFERRED_MIN_SECONDS = 6
SETUP_CONTEXT_MIN_WORDS = 10


def _dialogue_windows(turns):
    """Adjacent complete turns, including the lead-in to a short reaction/punchline."""
    records = sorted(
        [t for t in turns if t.get("transcript", "").strip() and t["endMs"] > t["startMs"]],
        key=lambda t: t["startMs"],
    )
    for index, first in enumerate(records):
        text = []
        previous_end = first["startMs"]
        for turn in records[index : index + 6]:
            if turn["startMs"] - previous_end > 1200 or turn["endMs"] - first["startMs"] > 14000:
                break
            text.append(turn["transcript"].strip())
            previous_end = max(previous_end, turn["endMs"])
            yield {"startMs": first["startMs"], "endMs": previous_end, "transcript": " ".join(text)}


def complete_dialogue(plan, turns, reviewed):
    prefix = []
    position = 0.0
    for clip in plan.clips:
        length = min(clip.end - clip.start, max(0, plan.impact_start - position))
        if length > 0:
            prefix.append((clip.start, clip.start + length, clip.person_ids))
        position += clip.end - clip.start
    options = []
    regions = sorted(reviewed, key=lambda r: r.start)
    for turn in _dialogue_windows(turns):
        start, end = turn["startMs"] / 1000, turn["endMs"] / 1000
        text = turn.get("transcript", "").strip()
        if not 1 <= end - start <= 14 or len(text.split()) < 2:
            continue
        overlap = sum(max(0, min(end, b) - max(start, a)) for a, b, _ in prefix)
        if overlap <= 0:
            continue
        selected = [r for r in regions if r.end > start and r.start < end]
        if (
            not selected
            or len(selected) > 2
            or selected[0].start > start + 0.001
            or selected[-1].end < end - 0.001
        ):
            continue
        if any(b.start > a.end + 0.001 for a, b in itertools.pairwise(selected)):
            continue
        # Context guards protect word onsets/endings without making the phrase shorter.
        room = 14 - (end - start)
        left = max(selected[0].start, start - min(0.25, room / 2))
        right = min(selected[-1].end, end + min(0.12, room / 2))
        ids = next(ids for a, b, ids in prefix if max(a, start) < min(b, end))
        clips = [
            EditClip(
                start=max(left, r.start),
                end=min(right, r.end),
                person_ids=ids,
                reason="Complete transcribed setup utterance",
            )
            for r in selected
        ]
        length = end - start
        word_count = len(text.split())
        rich = length >= SETUP_PREFERRED_MIN_SECONDS and word_count >= SETUP_CONTEXT_MIN_WORDS
        # A complete exchange outranks the isolated reaction it contains. No extra
        # silence or slowed speech is used to meet the preferred duration.
        rank = (
            rich,
            -abs(length - SETUP_TARGET_SECONDS) if rich else min(length, SETUP_TARGET_SECONDS),
            min(word_count, 24),
            overlap / length,
        )
        options.append((rank, clips, text))
    if not options:
        return DialogueSetup(
            None,
            "",
            ["No complete source utterance fits the reviewed setup; model phrase retained."],
        )
    _, clips, text = max(options, key=lambda option: option[0])
    warnings = []
    if (
        sum(c.end - c.start for c in clips) < SETUP_PREFERRED_MIN_SECONDS
        or len(text.split()) < SETUP_CONTEXT_MIN_WORDS
    ):
        warnings.append(
            "Only a short dialogue setup is available in reviewed footage; "
            "prefer more lead-in context."
        )
    return DialogueSetup(clips, text, warnings)


def finish_at_speech_end(clips, quote, turns):
    """Remove trailing pause only when fresh ASR confirms the complete expected text."""
    import math
    import re
    from difflib import SequenceMatcher

    def words(text):
        return " ".join(re.findall(r"\w+", text.lower()))

    actual = words(" ".join(t.get("transcript", "") for t in turns))
    expected = words(quote)
    if not expected or not actual or SequenceMatcher(None, expected, actual).ratio() < 0.85:
        return clips
    total = sum(c.end - c.start for c in clips)
    recognized_end = max(t["endMs"] for t in turns) / 1000
    if (
        len(expected.split()) >= SETUP_CONTEXT_MIN_WORDS
        and len(actual.split()) / max(0.001, recognized_end) > 6
    ):
        # An implausibly short ASR endpoint is not evidence that the whole exchange
        # fits in a one-second intro. Keep the complete source context instead.
        return clips
    end = math.ceil((max(t["endMs"] for t in turns) / 1000 + 0.12) * 30) / 30
    if end >= total - 0.35:
        return clips
    result = []
    remaining = end
    for clip in clips:
        length = min(clip.end - clip.start, remaining)
        if length > 1 / 30 - 1e-6:
            result.append(clip.model_copy(update={"end": clip.start + length}))
        remaining -= length
        if remaining <= 1e-6:
            break
    return result or clips
