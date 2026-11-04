"""Caption the final dialogue audio, not an estimated slice of a long source turn."""

import array
import math
import wave

from .models import Segment
from .pipeline_io import has_signal
from .planning import make_ass


def align_speech_edges(turns, audio):
    """Trim leading/trailing low-energy padding without pretending to align phonemes."""
    with wave.open(str(audio), "rb") as wav:
        rate = wav.getframerate()
        samples = array.array("h", wav.readframes(wav.getnframes()))
    step = max(1, round(rate * 0.02))
    energy = [
        math.sqrt(sum(v * v for v in samples[i : i + step]) / len(samples[i : i + step]))
        for i in range(0, len(samples), step)
    ]
    result = []
    for turn in turns:
        start = max(0, turn["startMs"] / 1000)
        end = min(len(samples) / rate, turn["endMs"] / 1000)
        lo = max(0, int(start / 0.02))
        hi = min(len(energy), math.ceil(end / 0.02))
        peak = max(energy[lo:hi], default=0)
        active = [i for i in range(lo, hi) if energy[i] > max(30, peak * 0.05)]
        if not active:
            continue
        start = max(start, active[0] * 0.02 - 0.02)
        end = min(end, (active[-1] + 1) * 0.02 + 0.02)
        if end - start > 0.04:
            result.append({**turn, "startMs": round(start * 1000), "endMs": round(end * 1000)})
    return result


def setup_captions(meta, tools, source, segments, impact, work):
    audio = tools.dialogue_audio(source, segments, impact, work)
    if not has_signal(audio):
        return "", []
    # Endpointing finds utterance boundaries; speaker attribution is not needed here.
    turns = align_speech_edges(meta.transcribe(audio, mode="ENDPOINTING"), audio)
    text = make_ass(
        turns, [Segment(start=0, end=impact, reason="final dialogue", subject_ids=[])], until=impact
    )
    return text, turns
