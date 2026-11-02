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


CAPTION_MAX_WORDS = 3
CAPTION_MAX_CHARS = 26


def _caption_chunks(text: str) -> list[list[str]]:
    # Split exceptionally long tokens too, so a single word cannot fill three lines.
    words = [
        word[start : start + CAPTION_MAX_CHARS]
        for word in text.split()
        for start in range(0, len(word), CAPTION_MAX_CHARS)
    ]
    chunks = []
    position = 0
    while position < len(words):
        remaining = len(words) - position
        # Prefer 2+2 over 3+1 at the end of a phrase.
        count = 2 if remaining == 4 else min(CAPTION_MAX_WORDS, remaining)
        chunk = []
        for word in words[position : position + count]:
            if chunk and len(" ".join([*chunk, word])) > CAPTION_MAX_CHARS:
                break
            chunk.append(word)
            if re.search(r"[.!?…][\"'»)]*$", word):
                break
        chunks.append(chunk)
        position += len(chunk)
    return chunks


def make_srt(turns: list[dict], segments: list[Segment]) -> str:
    """Short rolling captions; within-turn word timing is estimated, not forced alignment."""
    captions = []
    offset = 0.0
    for segment in segments:
        for turn in turns:
            turn_start, turn_end = turn["startMs"] / 1000, turn["endMs"] / 1000
            if turn_end <= turn_start or turn_end <= segment.start or turn_start >= segment.end:
                continue
            text = html.unescape(str(turn.get("transcript", "")))
            text = re.sub(r"<[^>]*>|\{[^}]*\}", "", text)
            text = " ".join(text.replace("\\", "").split())[:10000]
            chunks = _caption_chunks(text)
            units = sum(len(chunk) for chunk in chunks)
            consumed = 0
            for chunk in chunks:
                # Establish timing on the SOURCE turn before clipping/reordering shots.
                cue_start = turn_start + (turn_end - turn_start) * consumed / units
                consumed += len(chunk)
                cue_end = turn_start + (turn_end - turn_start) * consumed / units
                start, end = max(segment.start, cue_start), min(segment.end, cue_end)
                if end - start >= 0.08:
                    captions.append(
                        (
                            offset + start - segment.start,
                            offset + end - segment.start,
                            " ".join(chunk),
                        )
                    )
        offset += segment.end - segment.start
    captions.sort()
    # Overlapping speech must not stack multiple caption blocks on the screen.
    serial = []
    for index, (start, end, text) in enumerate(captions):
        if index + 1 < len(captions):
            end = min(end, captions[index + 1][0])
        if end - start >= 0.08:
            serial.append((start, end, text))
    return "\n\n".join(
        f"{index}\n{_timestamp(start)} --> {_timestamp(end)}\n{text}"
        for index, (start, end, text) in enumerate(serial, 1)
    )
