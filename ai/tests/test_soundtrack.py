import pytest

from raw2reel_ai.soundtrack import SAMPLE_DROPS, align_music, detect_drop, find_drop


def test_detects_sustained_energy_change_not_single_peak():
    envelope = [0.08] * 80 + [0.9] + [0.08] * 19 + [0.8] * 100
    assert detect_drop(envelope, hop=0.1) == pytest.approx(10, abs=0.2)


def test_no_confident_drop_for_silence_or_constant_level():
    assert detect_drop([0] * 200) is None
    assert detect_drop([0.5] * 200) is None


def test_late_drop_uses_offset_and_early_drop_uses_delay():
    late = align_music(24, 7)
    assert late.offset == 17 and late.delay == 0
    early = align_music(2, 7)
    assert early.offset == 0 and early.delay == 5
    for drop in (0, 2, 7, 24):
        timing = align_music(drop, 7)
        assert drop - timing.offset + timing.delay == pytest.approx(7)


def test_preset_lookup_does_not_depend_on_original_filename(tmp_path, monkeypatch):
    import hashlib

    data = b"known audio bytes"
    digest = hashlib.sha256(data).hexdigest()
    monkeypatch.setitem(SAMPLE_DROPS, digest, dict(name="test", drop_seconds=12.5))
    music = tmp_path / "music"
    music.write_bytes(data)
    point = find_drop(None, music, tmp_path)
    assert point.seconds == 12.5 and point.method == "preset"


def test_unknown_flat_audio_falls_back_without_claiming_detection(tmp_path):
    from raw2reel_ai.config import Settings
    from raw2reel_ai.media import MediaTools

    tools = MediaTools(Settings(_env_file=None))
    music = tmp_path / "flat.wav"
    tools.ffmpeg("-f", "lavfi", "-i", "sine=frequency=80:duration=4", str(music))
    result = find_drop(tools, music, tmp_path)
    assert result.method == "fallback" and result.seconds == 0
