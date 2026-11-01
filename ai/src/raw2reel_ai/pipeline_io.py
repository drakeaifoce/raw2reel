"""Shared file fingerprints, safe JSON output and PCM signal inspection."""

import array
import hashlib
import json
import wave
from pathlib import Path


def fingerprint(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value: dict):
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def has_signal(audio: Path) -> bool:
    with wave.open(str(audio), "rb") as wav:
        while frames := wav.readframes(24000):
            if max(map(abs, array.array("h", frames)), default=0) > 100:
                return True
    return False
