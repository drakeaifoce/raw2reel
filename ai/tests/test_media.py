"""FFmpeg behavior used by the current cloud pipeline."""

import shutil
import wave

import pytest

from raw2reel_ai.config import Settings
from raw2reel_ai.media import MediaTools


@pytest.fixture
def tools():
    settings = Settings()
    if not shutil.which(settings.ffmpeg_path) or not shutil.which(settings.ffprobe_path):
        pytest.skip("Install ffmpeg and ffprobe for media integration tests")
    return MediaTools(settings)


@pytest.fixture
def video(tmp_path, tools):
    source = tmp_path / "source.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=24000",
        "-t",
        "2.5",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(source),
    )
    return source


def test_tempo_comes_from_audio_not_placeholder_metadata(tmp_path, tools):
    import array

    samples = array.array("h", [0] * (8000 * 6))
    for offset in range(0, len(samples), 4000):
        for i in range(80):
            samples[offset + i] = 20000 if i % 2 else -20000
    music = tmp_path / "clicks.wav"
    with wave.open(str(music), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(samples.tobytes())
    bpm, beats = tools.beats(music, tmp_path)
    assert bpm is not None and 118 <= bpm <= 122
    assert len(beats) >= 9


def test_cut_after_audio_end_still_has_aac_track(tmp_path, tools):
    from raw2reel_ai.models import Segment

    source = tmp_path / "short-audio.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=320x240:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=0.25",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        str(source),
    )
    assert tools.probe(source)["has_audio"]
    _, result = tools.render(
        source,
        [Segment(start=1, end=2, reason="end", subject_ids=[])],
        tmp_path,
        "",
        True,
        None,
        impact_start=0,
    )
    assert result["has_audio"]
    assert result["audio_codec"] == "aac"


def test_caption_font_uses_output_pixels_and_safe_bottom_margin(tmp_path, tools):
    from PIL import Image

    from raw2reel_ai.models import Segment

    source = tmp_path / "black.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=720x1280:rate=30:duration=1",
        "-an",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        str(source),
    )
    rendered, _ = tools.render(
        source,
        [Segment(start=0, end=1, reason="caption", subject_ids=[])],
        tmp_path,
        "1\n00:00:00,000 --> 00:00:01,000\nSmall caption",
        False,
        None,
        impact_start=0,
    )
    frame = tmp_path / "caption.png"
    tools.ffmpeg("-ss", "0.5", "-i", str(rendered), "-frames:v", "1", str(frame))
    with Image.open(frame) as image:
        box = image.convert("L").point(lambda value: 255 if value > 200 else 0).getbbox()
    assert box is not None
    assert 15 <= box[3] - box[1] <= 45
    assert 1150 <= box[3] <= 1220


def test_quiet_foreground_stays_above_hot_music_and_music_ducks(tmp_path, tools):
    import array
    import math

    from raw2reel_ai.models import Segment

    rate = 24000
    for name, frequency, amplitude in (("voice", 440, 180), ("music", 880, 16000)):
        samples = array.array(
            "h",
            (
                int(amplitude * math.sin(2 * math.pi * frequency * i / rate))
                if name == "music" or rate <= i < 3 * rate
                else 0
                for i in range(4 * rate)
            ),
        )
        with wave.open(str(tmp_path / (name + ".wav")), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(samples.tobytes())
    source = tmp_path / "quiet-video.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x240:rate=30:duration=4",
        "-i",
        str(tmp_path / "voice.wav"),
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        str(source),
    )
    rendered, _ = tools.render(
        source,
        [Segment(start=0, end=4, reason="voice", subject_ids=[])],
        tmp_path,
        "",
        True,
        tmp_path / "music.wav",
        impact_start=3.9,
    )
    mixed = tmp_path / "mixed.wav"
    tools.extract_audio(rendered, mixed)
    with wave.open(str(mixed), "rb") as wav:
        samples = array.array("h", wav.readframes(wav.getnframes()))

    def amplitude_at(frequency, start, end):
        window = samples[int(start * rate) : int(end * rate)]
        cosine = sum(v * math.cos(2 * math.pi * frequency * i / rate) for i, v in enumerate(window))
        sine = sum(v * math.sin(2 * math.pi * frequency * i / rate) for i, v in enumerate(window))
        return 2 * math.hypot(cosine, sine) / len(window)

    foreground = amplitude_at(440, 1.6, 2.6)
    music_during_voice = amplitude_at(880, 1.6, 2.6)
    music_in_pause = amplitude_at(880, 0.2, 0.7)
    assert 20 * math.log10(foreground / music_during_voice) >= 10
    assert 20 * math.log10(music_in_pause / music_during_voice) >= 5


def test_cloud_portrait_and_two_phase_mix(tmp_path, tools, video):
    from raw2reel_ai.models import Segment
    from raw2reel_ai.reframing import portrait_filter

    music = tmp_path / "music.wav"
    tools.ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=3", str(music))
    segment = Segment(start=0, end=2, reason="test", subject_ids=["p1"])
    rendered, info = tools.render(
        video,
        [segment],
        tmp_path,
        "",
        True,
        music,
        portrait_filters=[portrait_filter(segment, [], ["p1"])],
        impact_start=1,
        music_start=0.1,
    )
    assert rendered.is_file()
    assert info["width"] == 720 and info["height"] == 1280
    assert info["audio_mix"] == "two_phase_dialogue_then_music"
    # Check audible behavior, not just the chosen filter label: music/voice ratio rises.
    import math

    audio = tmp_path / "mixed.wav"
    tools.extract_audio(rendered, audio)
    with wave.open(str(audio)) as wav:
        samples = __import__("array").array("h", wav.readframes(wav.getnframes()))
        rate = wav.getframerate()

    def amplitude(start, frequency):
        values = samples[int(start * rate) : int((start + 0.2) * rate)]
        cosine = sum(v * math.cos(2 * math.pi * frequency * i / rate) for i, v in enumerate(values))
        sine = sum(v * math.sin(2 * math.pi * frequency * i / rate) for i, v in enumerate(values))
        return math.hypot(cosine, sine)

    before = amplitude(0.3, 880) / max(1, amplitude(0.3, 440))
    after = amplitude(1.6, 880) / max(1, amplitude(1.6, 440))
    assert 1.5 < after / before < 2.5


def test_short_captions_change_in_rendered_video(tmp_path, tools):
    from PIL import Image, ImageChops

    from raw2reel_ai.models import Segment
    from raw2reel_ai.planning import make_srt

    source = tmp_path / "black.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=720x1280:rate=30:duration=2",
        "-an",
        "-c:v",
        "libx264",
        str(source),
    )
    segments = [Segment(start=0, end=2, reason="captions", subject_ids=[])]
    srt = make_srt(
        [{"startMs": 0, "endMs": 2000, "transcript": "ONE TWO THREE FOUR FIVE SIX"}], segments
    )
    rendered, _ = tools.render(source, segments, tmp_path, srt, False, None, impact_start=0)
    frames = []
    for i, time in enumerate((0.5, 1.5)):
        path = tmp_path / f"caption-{i}.png"
        tools.ffmpeg("-ss", str(time), "-i", str(rendered), "-frames:v", "1", str(path))
        with Image.open(path) as image:
            ink = image.convert("L").point(lambda value: 255 if value > 200 else 0)
            bounds = ink.getbbox()
            assert bounds is not None and bounds[3] - bounds[1] <= 45
            frames.append(ink.copy())
    assert ImageChops.difference(*frames).getbbox() is not None
