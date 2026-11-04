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


@pytest.mark.parametrize("with_music", [True, False])
def test_epic_impact_mutes_source_and_captions(tmp_path, tools, with_music):
    import array
    import math

    from PIL import Image

    from raw2reel_ai.models import Segment
    from raw2reel_ai.planning import make_ass

    source = tmp_path / "speech.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x240:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=24000:duration=2",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        str(source),
    )
    music = tmp_path / "music.wav"
    tools.ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=3", str(music))
    segments = [
        Segment(start=0, end=1, reason="setup", subject_ids=[]),
        Segment(start=1, end=1.5, reason="impact", subject_ids=[]),
        Segment(start=0, end=0.5, reason="repeat", subject_ids=[]),
    ]
    captions = make_ass(
        [dict(startMs=0, endMs=2000, transcript="ONE TWO THREE FOUR")], segments, until=1
    )
    rendered, _ = tools.render(
        source,
        segments,
        tmp_path,
        captions,
        True,
        music if with_music else None,
        impact_start=1,
        epic=True,
    )
    audio = tmp_path / "result.wav"
    tools.extract_audio(rendered, audio)
    with wave.open(str(audio)) as wav:
        rate = wav.getframerate()
        samples = array.array("h", wav.readframes(wav.getnframes()))

    def level(frequency, start):
        data = samples[round(start * rate) : round((start + 0.25) * rate)]
        return (
            2
            * math.hypot(
                sum(v * math.cos(2 * math.pi * frequency * i / rate) for i, v in enumerate(data)),
                sum(v * math.sin(2 * math.pi * frequency * i / rate) for i, v in enumerate(data)),
            )
            / len(data)
        )

    assert level(440, 0.3) > 100
    assert level(440, 1.4) < level(440, 0.3) * 0.02
    if not with_music:
        # Check immediately after the boundary, not just half a second later.
        assert max(abs(v) for v in samples[rate : rate + round(0.01 * rate)]) < 50
    if with_music:
        assert level(880, 1.4) > level(880, 0.3) * 2
    for time, expected in ((0.3, True), (1.4, False)):
        frame = tmp_path / f"caption-{time}.png"
        tools.ffmpeg("-ss", str(time), "-i", str(rendered), "-frames:v", "1", str(frame))
        with Image.open(frame) as image:
            bright = image.convert("L").point(lambda v: 255 if v > 130 else 0).getbbox()
            assert bool(bright) == expected
            if expected:
                assert any(
                    r > 150 and g > 150 and b < 100
                    for r, g, b in image.convert("RGB").get_flattened_data()
                )


def test_epic_zoom_changes_static_impact_shot_and_keeps_duration(tmp_path, tools):
    from PIL import Image, ImageChops

    from raw2reel_ai.models import Segment

    source = tmp_path / "grid.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x240:rate=30:duration=2,drawgrid=w=40:h=40:t=2:c=white",
        "-an",
        "-c:v",
        "libx264",
        str(source),
    )
    rendered, info = tools.render(
        source,
        [
            Segment(start=0, end=1, reason="setup", subject_ids=[]),
            Segment(start=1, end=1.5, reason="impact", subject_ids=[]),
            Segment(start=0, end=0.5, reason="repeat", subject_ids=[]),
        ],
        tmp_path,
        "",
        False,
        None,
        impact_start=1,
        epic=True,
    )
    assert info["duration"] == pytest.approx(2, abs=0.04)
    frames = []
    for i, time in enumerate((1.03, 1.46)):
        path = tmp_path / f"zoom-{i}.png"
        tools.ffmpeg("-ss", str(time), "-i", str(rendered), "-frames:v", "1", str(path))
        with Image.open(path) as image:
            frames.append(image.copy())
    assert ImageChops.difference(*frames).getbbox() is not None


def test_early_soundtrack_drop_is_delayed_to_impact(tmp_path, tools):
    import array
    import math

    from raw2reel_ai.models import Segment
    from raw2reel_ai.soundtrack import align_music

    source = tmp_path / "silent.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x240:rate=30:duration=2",
        "-an",
        "-c:v",
        "libx264",
        str(source),
    )
    music = tmp_path / "early.wav"
    rate = 24000
    data = array.array(
        "h",
        (
            round(6000 * math.sin(2 * math.pi * (660 if i < rate * 0.3 else 880) * i / rate))
            for i in range(rate * 3)
        ),
    )
    with wave.open(str(music), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(data.tobytes())
    timing = align_music(0.3, 1)
    rendered, _ = tools.render(
        source,
        [Segment(start=0, end=2, reason="test", subject_ids=[])],
        tmp_path,
        "",
        False,
        music,
        impact_start=1,
        epic=True,
        music_start=timing.offset,
        music_delay=timing.delay,
    )
    audio = tmp_path / "mixed.wav"
    tools.extract_audio(rendered, audio)
    with wave.open(str(audio)) as wav:
        rate = wav.getframerate()
        samples = array.array("h", wav.readframes(wav.getnframes()))

    def power(start, end):
        data = samples[round(start * rate) : round(end * rate)]
        return math.sqrt(sum(v * v for v in data) / len(data))

    assert power(0.1, 0.5) < 2
    assert power(0.75, 0.9) > 2
    assert power(1.2, 1.5) > power(0.75, 0.9) * 2


def test_dialogue_audio_keeps_cut_order_and_exact_duration(tmp_path, tools):
    import array
    import math

    from raw2reel_ai.models import Segment

    source = tmp_path / "words.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=64x64:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=24000:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=24000:duration=1",
        "-filter_complex",
        "[1:a][2:a]concat=n=2:v=0:a=1[a]",
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        str(source),
    )
    segments = [
        Segment(start=1, end=2, reason="second", subject_ids=[]),
        Segment(start=0, end=1, reason="first", subject_ids=[]),
    ]
    path = tools.dialogue_audio(source, segments, 2, tmp_path)
    with wave.open(str(path)) as wav:
        rate = wav.getframerate()
        values = array.array("h", wav.readframes(wav.getnframes()))
    assert len(values) / rate == pytest.approx(2, abs=1 / rate)

    def amplitude(frequency, start):
        data = values[round(start * rate) : round((start + 0.2) * rate)]
        return math.hypot(
            sum(v * math.cos(2 * math.pi * frequency * i / rate) for i, v in enumerate(data)),
            sum(v * math.sin(2 * math.pi * frequency * i / rate) for i, v in enumerate(data)),
        )

    assert amplitude(880, 0.3) > amplitude(440, 0.3) * 10
    assert amplitude(440, 1.3) > amplitude(880, 1.3) * 10


def test_portrait_keeps_off_center_subject_after_letterbox_crop_and_lost_detection(tmp_path, tools):
    from PIL import Image

    from raw2reel_ai.cloud_models import TrackPoint
    from raw2reel_ai.models import Segment
    from raw2reel_ai.reframing import portrait_filter

    source = tmp_path / "off-center.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=black:size=640x360:rate=30:duration=2,drawbox=x=0:y=46:w=640:h=268:c=gray:t=fill,"
        "drawbox=x=420:y=70:w=40:h=60:c=red:t=fill",
        "-an",
        "-c:v",
        "libx264",
        str(source),
    )
    segment = Segment(start=0, end=2, reason="subject", subject_ids=["p1"])
    points = [
        TrackPoint(
            time=0.1, person_id="p1", scene=0, bbox=[420 / 640, 70 / 360, 460 / 640, 130 / 360]
        )
    ]
    crop = portrait_filter(
        segment, points, ["p1"], aspect_ratio=640 / 360, content_bounds=(0, 46 / 360, 1, 314 / 360)
    )
    rendered, _ = tools.render(
        source,
        [segment],
        tmp_path,
        "",
        False,
        None,
        impact_start=1.5,
        portrait_filters=[crop],
        epic=True,
    )
    for index, time in enumerate((0.05, 1.3, 1.8)):
        frame = tmp_path / f"person-{index}.png"
        tools.ffmpeg("-ss", str(time), "-i", str(rendered), "-frames:v", "1", str(frame))
        with Image.open(frame) as image:
            mask = image.convert("RGB").point(lambda v: v)
            rows = [
                [
                    x
                    for x in range(720)
                    if (lambda rgb: rgb[0] > 150 and rgb[1] < 100 and rgb[2] < 100)(
                        mask.getpixel((x, y))
                    )
                ]
                for y in range(0, 500, 5)
            ]
            xs = [x for row in rows for x in row]
            assert xs and 330 < sum(xs) / len(xs) < 390


def test_review_clip_can_preserve_audio_while_sam_clip_stays_silent(tmp_path, tools, video):
    from raw2reel_ai.cloud_media import CloudMedia
    from raw2reel_ai.cloud_models import Interval

    media = CloudMedia(tools)
    for enabled in (True, False):
        path = tmp_path / f"review-{enabled}.mp4"
        media.clip(video, Interval(start=0.2, end=1.2), path, include_audio=enabled)
        assert tools.probe(path)["has_audio"] == enabled
