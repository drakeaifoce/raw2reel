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
