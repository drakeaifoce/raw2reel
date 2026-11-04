import array
import wave

import pytest

from raw2reel_ai.render_captions import align_speech_edges


def test_caption_turn_does_not_include_half_second_of_trailing_silence(tmp_path):
    path = tmp_path / "speech.wav"
    samples = array.array("h", [0] * 2400 + [12000, -12000] * 12000 + [0] * 9600)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(samples.tobytes())
    turns = align_speech_edges([dict(startMs=0, endMs=1500, transcript="one phrase")], path)
    assert turns[0]["startMs"] == pytest.approx(100, abs=30)
    assert turns[0]["endMs"] == pytest.approx(1100, abs=30)


def test_short_setup_flushes_asr_and_falls_back_when_endpointing_is_empty(tmp_path):
    from types import SimpleNamespace

    from raw2reel_ai.models import Segment
    from raw2reel_ai.render_captions import setup_captions

    path = tmp_path / "dialogue.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(array.array("h", [12000, -12000] * 12000).tobytes())

    class Meta:
        def __init__(self):
            self.modes = []

        def transcribe(self, audio, *, mode):
            self.modes.append(mode)
            with wave.open(str(audio), "rb") as wav:
                assert wav.getnframes() > 24000
            return (
                []
                if mode == "ENDPOINTING"
                else [dict(startMs=0, endMs=1000, transcript="Complete thought.")]
            )

    meta = Meta()
    text, turns = setup_captions(
        meta,
        SimpleNamespace(dialogue_audio=lambda *_: path),
        None,
        [Segment(start=0, end=1, reason="speech", subject_ids=[])],
        1,
        tmp_path,
    )
    assert "Complete" in text and turns
    assert meta.modes == ["ENDPOINTING", "DIARIZATION"]
