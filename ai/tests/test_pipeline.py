import json
import os
import shutil
import subprocess
import sys
import wave

import httpx
import pytest
from pydantic import SecretStr

from raw2reel_ai.config import Settings
from raw2reel_ai.media import MediaTools
from raw2reel_ai.meta import MetaClient
from raw2reel_ai.pipeline import ReelPipeline


@pytest.fixture
def tools():
    settings = Settings()
    if not shutil.which(settings.ffmpeg_path) or not shutil.which(
        settings.ffprobe_path
    ):
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


def model_transport(request):
    if request.url.path == "/v1/files":
        return httpx.Response(200, json={"id": "file-123", "status": "uploaded"})
    if request.method == "DELETE":
        return httpx.Response(200, json={"deleted": True})
    if request.url.path == "/v1/asr/transcribe":
        return httpx.Response(
            200,
            json={
                "sessionId": "s",
                "audioDurationMs": 2500,
                "transcript": "First Second",
                "turns": [
                    {
                        "turnId": 0,
                        "startMs": 1000,
                        "endMs": 2000,
                        "transcript": "First",
                    },
                    {"turnId": 1, "startMs": 0, "endMs": 500, "transcript": "Second"},
                ],
            },
        )
    assert request.url.path == "/v1/responses"
    plan = {
        "summary": "A test pattern",
        "hook": "First",
        "subjects": [],
        "segments": [
            {"start": 1, "end": 2, "reason": "hook", "subject_ids": []},
            {"start": 0, "end": 0.75, "reason": "ending", "subject_ids": []},
        ],
    }
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(plan)}],
                }
            ],
        },
    )


def test_pipeline_creates_valid_mp4_and_truthful_sidecars(video, tmp_path, tools):
    settings = tools.settings.model_copy(
        update={"model_api_key": SecretStr("test-key")}
    )
    meta = MetaClient(settings, transport=httpx.MockTransport(model_transport))
    output = tmp_path / "reel.mp4"
    stages = []
    manifest = ReelPipeline(settings, meta=meta).render(
        video, output, duration=1.5, on_progress=stages.append
    )
    info = tools.probe(output)
    assert (info["width"], info["height"], info["codec"]) == (720, 1280, "h264")
    assert abs(info["duration"] - 1.5) < 0.3 and info["has_audio"]
    assert manifest["captions"] is True and manifest["subjects_tracked"] is False
    assert manifest["cuts"] == 1
    assert (
        "00:00:01,000 --> 00:00:01,500"
        in output.with_suffix(".captions.srt").read_text()
    )
    assert "test-key" not in output.with_suffix(".manifest.json").read_text()
    assert stages[-1] == "done"
    assert not list(tmp_path.glob(".raw2reel-*"))


def test_existing_output_and_source_cannot_be_overwritten_implicitly(
    video, tmp_path, tools
):
    pipeline = ReelPipeline(tools.settings)
    with pytest.raises(ValueError):
        pipeline.render(video, video, captions=False)
    output = tmp_path / "existing.mp4"
    output.write_bytes(b"keep this")
    with pytest.raises(FileExistsError):
        pipeline.render(video, output, captions=False)
    assert output.read_bytes() == b"keep this"


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


def test_analysis_artifact_is_bound_to_original_file(video, tmp_path, tools):
    meta = MetaClient(
        tools.settings.model_copy(update={"model_api_key": SecretStr("test-key")}),
        transport=httpx.MockTransport(model_transport),
    )
    pipeline = ReelPipeline(tools.settings, meta=meta)
    artifact = tmp_path / "analysis.json"
    pipeline.analyze(video, artifact)
    changed = tmp_path / "changed.mp4"
    changed.write_bytes(video.read_bytes() + b"different")
    with pytest.raises(ValueError, match="does not match"):
        pipeline.render(
            changed, tmp_path / "result.mp4", analysis_path=artifact, captions=False
        )


def test_sidecar_can_never_overwrite_source_even_with_overwrite(video, tmp_path, tools):
    source = tmp_path / "result.analysis.json"
    original = video.read_bytes()
    source.write_bytes(original)
    meta = MetaClient(
        tools.settings.model_copy(update={"model_api_key": SecretStr("test-key")}),
        transport=httpx.MockTransport(model_transport),
    )
    with pytest.raises(ValueError):
        ReelPipeline(tools.settings, meta=meta).render(
            source, tmp_path / "result.mp4", captions=False, overwrite=True
        )
    assert source.read_bytes() == original


def test_silent_source_and_short_music_render_offline(tmp_path, tools):
    import hashlib

    source = tmp_path / "silent.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=320x240:rate=30",
        "-t",
        "1",
        "-an",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        str(source),
    )
    music = tmp_path / "music.wav"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=24000",
        "-t",
        "0.25",
        str(music),
    )
    artifact = tmp_path / "analysis.json"
    artifact.write_text(
        json.dumps(
            {
                "source": {"sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
                "analysis": {
                    "summary": "Blue",
                    "hook": "Blue",
                    "subjects": [],
                    "segments": [
                        {"start": 0, "end": 1, "reason": "blue", "subject_ids": []}
                    ],
                },
                "turns": [],
            }
        )
    )
    output = tmp_path / "result.mp4"
    settings = tools.settings.model_copy(update={"model_api_key": None})
    with ReelPipeline(settings) as pipeline:
        result = pipeline.render(source, output, music=music, analysis_path=artifact)
    assert result["captions"] is False
    assert result["bpm"] is None
    assert result["duration"] >= 0.9
    audio = tmp_path / "mixed.wav"
    tools.extract_audio(output, audio)
    import array

    with wave.open(str(audio), "rb") as wav:
        samples = array.array("h", wav.readframes(wav.getnframes()))
    assert max(map(abs, samples)) > 100


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
    )
    assert result["has_audio"]
    assert result["audio_codec"] == "aac"


def test_cut_timeline_is_frame_accurate(video, tmp_path, tools):
    import hashlib

    artifact = tmp_path / "fractional.json"
    artifact.write_text(
        json.dumps(
            {
                "source": {"sha256": hashlib.sha256(video.read_bytes()).hexdigest()},
                "analysis": {
                    "summary": "Clip",
                    "hook": "Start",
                    "subjects": [],
                    "segments": [
                        {"start": 0, "end": 0.353, "reason": "one", "subject_ids": []},
                        {"start": 1, "end": 1.353, "reason": "two", "subject_ids": []},
                    ],
                },
                "turns": [],
            }
        )
    )
    with ReelPipeline(tools.settings) as pipeline:
        result = pipeline.render(
            video, tmp_path / "quantized.mp4", analysis_path=artifact
        )
    durations = [s["end"] - s["start"] for s in result["segments"]]
    assert all(abs(d * 30 - round(d * 30)) < 1e-6 for d in durations)
    assert abs(result["duration"] - sum(durations)) <= 1 / 30 + 0.001


def test_cli_explicit_env_bypasses_bad_default_env(tmp_path):
    (tmp_path / ".env").write_text("MODEL_TIMEOUT_SECONDS=broken\n")
    alternate = tmp_path / "custom.env"
    alternate.write_text("MODEL_TIMEOUT_SECONDS=120\n")
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    result = subprocess.run(
        [sys.executable, "-m", "raw2reel_ai", "--env-file", str(alternate), "--help"],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0
    assert "Traceback" not in result.stderr


def test_cli_renders_saved_analysis_with_no_api_key(video, tmp_path, tools):
    meta = MetaClient(
        tools.settings.model_copy(update={"model_api_key": SecretStr("test-key")}),
        transport=httpx.MockTransport(model_transport),
    )
    artifact = tmp_path / "saved-analysis.json"
    with ReelPipeline(tools.settings, meta=meta) as pipeline:
        pipeline.analyze(video, artifact)
    output = tmp_path / "folder with spaces" / "reel.mp4"
    environment = dict(os.environ, MODEL_API_KEY="", PYTHONDONTWRITEBYTECODE="1")
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "raw2reel_ai",
            "render",
            str(video),
            "--analysis",
            str(artifact),
            "--output",
            str(output),
            "--duration",
            "1.5",
        ],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr
    assert json.loads(process.stdout)["captions"] is True
    assert "done" in process.stderr
    assert tools.probe(output)["audio_codec"] == "aac"


def test_many_short_cuts_do_not_accumulate_timeline_drift(tmp_path, tools):
    import hashlib

    source = tmp_path / "twenty-seconds.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=320x240:rate=30:duration=20",
        "-an",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        str(source),
    )
    artifact = tmp_path / "forty-cuts.json"
    artifact.write_text(
        json.dumps(
            {
                "source": {"sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
                "analysis": {
                    "summary": "Many cuts",
                    "hook": "First",
                    "subjects": [],
                    "segments": [
                        {
                            "start": i / 2,
                            "end": i / 2 + 0.353,
                            "reason": "cut",
                            "subject_ids": [],
                        }
                        for i in range(40)
                    ],
                },
                "turns": [],
            }
        )
    )
    with ReelPipeline(tools.settings) as pipeline:
        result = pipeline.render(source, tmp_path / "forty.mp4", analysis_path=artifact)
    assert result["cuts"] == 39
    assert abs(result["duration"] - 13.333333) <= 1 / 30


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
    )
    frame = tmp_path / "caption.png"
    tools.ffmpeg("-ss", "0.5", "-i", str(rendered), "-frames:v", "1", str(frame))
    with Image.open(frame) as image:
        box = (
            image.convert("L").point(lambda value: 255 if value > 200 else 0).getbbox()
        )
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
    )
    mixed = tmp_path / "mixed.wav"
    tools.extract_audio(rendered, mixed)
    with wave.open(str(mixed), "rb") as wav:
        samples = array.array("h", wav.readframes(wav.getnframes()))

    def amplitude_at(frequency, start, end):
        window = samples[int(start * rate) : int(end * rate)]
        cosine = sum(
            v * math.cos(2 * math.pi * frequency * i / rate)
            for i, v in enumerate(window)
        )
        sine = sum(
            v * math.sin(2 * math.pi * frequency * i / rate)
            for i, v in enumerate(window)
        )
        return 2 * math.hypot(cosine, sine) / len(window)

    foreground = amplitude_at(440, 1.6, 2.6)
    music_during_voice = amplitude_at(880, 1.6, 2.6)
    music_in_pause = amplitude_at(880, 0.2, 0.7)
    assert 20 * math.log10(foreground / music_during_voice) >= 10
    assert 20 * math.log10(music_in_pause / music_during_voice) >= 5
