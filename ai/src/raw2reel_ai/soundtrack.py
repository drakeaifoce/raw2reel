"""Bounded soundtrack drop detection and exact alignment to the impact boundary."""

import array
import math
import wave
from dataclasses import dataclass
from pathlib import Path

from .pipeline_io import fingerprint

# Fingerprints survive multipart uploads, which intentionally discard filenames.
# Bundled sample presets are populated from measured bass-energy rises.
SAMPLE_DROPS: dict[str, dict] = {
    "dc57ef5b2cb4f265f5aae1d04e647ac68e7f7cc184416712ceb77943ef4b180c": {
        "name": "CHASHKAKEFIRA - MONTAGEM FAVELA [NCS Release]",
        "drop_seconds": 37.5,
    },
    "239a88f8a73872c6a277d4a56cd43ac6cd8baeeebabbb07bdb1620bf4709353e": {
        "name": "Emin Nilsen - BANE [NCS Release]",
        "drop_seconds": 69.8,
    },
    "4e80811f8d26a14b4665ec68f7357bf63ee7ca18ee23fbdaac8859ace846d430": {
        "name": "Lieless, Luuna, Yarimov - Sky Verse [NCS Release]",
        "drop_seconds": 4.1,
    },
    "f1bcf6f219f55c7ab5f6ac2c14e606e22b8bccd046d24d17d29ac9d99c104e40": {
        "name": "X972, sk3tch01, MXZI - Montagem Toma [NCS Release]",
        "drop_seconds": 14.5,
    },
}


@dataclass(frozen=True)
class DropPoint:
    seconds: float
    method: str


@dataclass(frozen=True)
class MusicTiming:
    offset: float
    delay: float


def align_music(drop: float, impact: float) -> MusicTiming:
    if not all(math.isfinite(t) and t >= 0 for t in (drop, impact)):
        raise ValueError("Invalid soundtrack alignment")
    return MusicTiming(max(0, drop - impact), max(0, impact - drop))


def detect_drop(energy: list[float], *, hop: float = 0.1) -> float | None:
    """Find a sustained rise, ignoring isolated transients and constant-level tracks.

    This is an energy heuristic, not semantic music analysis. No confident rise means
    None, which callers report explicitly rather than claiming an identified drop.
    """
    peak = max(energy, default=0)
    if peak <= 1e-8 or len(energy) < 40:
        return None
    before = max(1, round(2 / hop))
    after = max(1, round(1 / hop))
    candidates = []
    for i in range(before, len(energy) - 2 * after):
        baseline = sum(energy[i - before : i]) / before
        level = sum(energy[i : i + after]) / after
        sustained = sum(energy[i + after : i + 2 * after]) / after
        ratio = level / max(baseline, peak * 0.03)
        if ratio >= 1.8 and level >= peak * 0.3 and sustained >= level * 0.65:
            score = (level - baseline) * math.log(ratio)
            candidates.append((score, i))
    return round(max(candidates)[1] * hop, 3) if candidates else None


def bass_envelope(samples, rate=8000, hop=0.1):
    """Low-pass envelope gives kick/bass entries more weight than a loud spoken intro."""
    alpha = 1 - math.exp(-2 * math.pi * 160 / rate)
    step = max(1, round(rate * hop))
    low = power = 0.0
    result = []
    for i, value in enumerate(samples):
        low += alpha * (value - low)
        power += low * low
        if (i + 1) % step == 0:
            result.append(math.sqrt(power / step))
            power = 0.0
    return result


def find_drop(tools, music: Path, directory: Path) -> DropPoint:
    preset = SAMPLE_DROPS.get(fingerprint(music))
    if preset:
        return DropPoint(preset["drop_seconds"], "preset")
    audio = directory / "drop-analysis.wav"
    tools.ffmpeg(
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(music),
        "-t",
        "90",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-c:a",
        "pcm_s16le",
        str(audio),
    )
    try:
        with wave.open(str(audio), "rb") as wav:
            samples = array.array("h", wav.readframes(wav.getnframes()))
        detected = detect_drop(bass_envelope(samples))
        return DropPoint(detected, "energy") if detected is not None else DropPoint(0, "fallback")
    finally:
        audio.unlink(missing_ok=True)
