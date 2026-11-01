"""Pure edit planning and subtitle timeline transformation."""

import html
import math
import re

from .models import Analysis, Segment


def choose_segments(
    analysis: Analysis, subject_ids: list[str], target: float, source_duration: float
) -> list[Segment]:
    known = {subject.id for subject in analysis.subjects}
    if not set(subject_ids) <= known:
        raise ValueError("Unknown person selection")
    if len(known) != len(analysis.subjects):
        raise ValueError("Duplicate subject identifiers")
    if any(s.timestamp >= source_duration for s in analysis.subjects):
        raise ValueError("Subject timestamp outside source")
    ordered = sorted(analysis.segments, key=lambda s: s.start)
    for index, segment in enumerate(ordered):
        if segment.end > source_duration + 0.05:
            raise ValueError("Model interval outside source")
        if not set(segment.subject_ids) <= known:
            raise ValueError("Unknown subject in model interval")
        if index and segment.start < ordered[index - 1].end - 0.001:
            raise ValueError("Overlapping model intervals")
    remaining = min(target, source_duration, 30)
    result = []
    for segment in analysis.segments:
        if subject_ids and not set(subject_ids).intersection(segment.subject_ids):
            continue
        duration = min(segment.end - segment.start, remaining)
        if duration <= 0.05:
            continue
        result.append(
            segment.model_copy(update={"end": min(segment.start + duration, source_duration)})
        )
        remaining -= duration
        if remaining <= 0.05:
            break
    if not result:
        raise ValueError("No usable footage for the selected people")
    return result


def quantize_segments(segments: list[Segment], fps: int = 30) -> list[Segment]:
    """Whole output frames, rounded inward so no cut escapes its approved interval."""
    result = []
    for segment in segments:
        frames = math.floor((segment.end - segment.start) * fps + 1e-6)
        if frames > 0:
            result.append(segment.model_copy(update={"end": segment.start + frames / fps}))
    if not result:
        raise ValueError("Selected footage is shorter than one output frame")
    return result


def align_to_beats(segments: list[Segment], beats: list[float]) -> list[Segment]:
    """Shorten cuts to real music beats, never extending beyond an approved shot."""
    result = []
    offset = 0.0
    for index, segment in enumerate(segments):
        end = offset + segment.end - segment.start
        candidates = [b for b in beats if offset + 0.25 < b <= end]
        if candidates and index < len(segments) - 1:
            end = candidates[-1]
        cut = quantize_segments([segment.model_copy(update={"end": segment.start + end - offset})])[
            0
        ]
        result.append(cut)
        offset += cut.end - cut.start
    return result


def _timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    secs, ms = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def make_srt(turns: list[dict], segments: list[Segment]) -> str:
    captions = []
    offset = 0.0
    for segment in segments:
        for turn in turns:
            start = max(segment.start, turn["startMs"] / 1000)
            end = min(segment.end, turn["endMs"] / 1000)
            text = html.unescape(str(turn.get("transcript", "")))
            text = re.sub(r"<[^>]*>|\{[^}]*\}", "", text)
            text = " ".join(text.replace("\\", "").split())[:500]
            if text and end - start >= 0.08:
                captions.append(
                    (offset + start - segment.start, offset + end - segment.start, text)
                )
        offset += segment.end - segment.start
    captions.sort()
    return "\n\n".join(
        f"{index}\n{_timestamp(start)} --> {_timestamp(end)}\n{text}"
        for index, (start, end, text) in enumerate(captions, 1)
    )
