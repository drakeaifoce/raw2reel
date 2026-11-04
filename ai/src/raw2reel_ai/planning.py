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


def _caption_cues(turns: list[dict], segments: list[Segment]):
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
    return serial


def make_srt(turns: list[dict], segments: list[Segment]) -> str:
    """Short rolling captions with estimated within-turn timing."""
    serial = _caption_cues(turns, segments)
    return "\n\n".join(
        f"{index}\n{_timestamp(start)} --> {_timestamp(end)}\n{text}"
        for index, (start, end, text) in enumerate(serial, 1)
    )


def _ass_time(seconds: float) -> str:
    # Round inward so no subtitle remains on the first impact frame.
    centiseconds = max(0, math.floor(seconds * 100 + 1e-6))
    hours, centiseconds = divmod(centiseconds, 360000)
    minutes, centiseconds = divmod(centiseconds, 6000)
    secs, cs = divmod(centiseconds, 100)
    return f"{hours}:{minutes:02}:{secs:02}.{cs:02}"


def make_ass(turns: list[dict], segments: list[Segment], *, until: float) -> str:
    """Setup-only karaoke: current word yellow, other words white.

    Word timing is estimated from timed speech turns; it is not forced alignment.
    Input text has already had ASS/HTML control syntax stripped by _caption_cues.
    """
    events = []
    for start, end, text in _caption_cues(turns, segments):
        words = text.split()
        for index in range(len(words)):
            word_start = start + (end - start) * index / len(words)
            word_end = min(until, start + (end - start) * (index + 1) / len(words))
            if word_end - word_start < 0.04:
                continue
            highlighted = " ".join(
                r"{\c&H00FFFF&}" + word + r"{\c&HFFFFFF&}" if i == index else word
                for i, word in enumerate(words)
            )
            events.append(
                f"Dialogue: 0,{_ass_time(word_start)},{_ass_time(word_end)},"
                f"Default,,0,0,0,,{highlighted}"
            )
    if not events:
        return ""
    return (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\n"
        "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,"
        "-1,0,0,0,100,100,0,0,1,2,1,2,40,40,110,1\n\n[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "\n".join(events)
    )
