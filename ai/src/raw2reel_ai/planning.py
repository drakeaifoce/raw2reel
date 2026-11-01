"""Pure edit planning and subtitle timeline transformation."""

import html
import math
import re

from .models import Segment


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
