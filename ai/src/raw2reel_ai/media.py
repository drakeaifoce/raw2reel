"""Bounded local FFmpeg operations. Never executes model/user text as code."""

import array
import json
import math
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import structlog

from .config import Settings
from .editing_effects import GRADE, NORMALIZE, epic_mix, impact_zoom, setup_audio
from .models import Segment
from .observability import configure_logging
from .reframing import portrait_filter


class MediaError(Exception):
    code = "media_error"

    def __init__(self, message: str, *, stderr_tail: str = ""):
        super().__init__(message)
        # External diagnostic is for explicitly requested local CLI debug only.
        # Never include it in str(error), HTTP responses or structured logs.
        self.stderr_tail = stderr_tail
        self.safe_message = message


class MediaTools:
    def __init__(self, settings: Settings):
        configure_logging(settings.log_level, settings.log_format)
        self.settings = settings

    def run(
        self,
        arguments: list[str],
        *,
        timeout: float | None = None,
        cwd: Path | None = None,
    ):
        log = structlog.get_logger(__name__)
        tool = "ffprobe" if arguments[0] == self.settings.ffprobe_path else "ffmpeg"
        started = time.monotonic()
        log.debug("media_command_started", tool=tool)

        def failed(reason, **fields):
            log.error(
                "media_command_failed",
                tool=tool,
                reason=reason,
                duration_ms=round((time.monotonic() - started) * 1000, 2),
                **fields,
            )

        try:
            with tempfile.TemporaryFile() as diagnostics:
                result = subprocess.run(
                    arguments,
                    stdout=subprocess.PIPE,
                    stderr=diagnostics,
                    cwd=cwd,
                    timeout=timeout or self.settings.media_timeout_seconds,
                    check=False,
                )
                diagnostics.seek(0, 2)
                diagnostics.seek(max(0, diagnostics.tell() - 16384))
                stderr_tail = diagnostics.read().decode("utf-8", errors="replace")
        except FileNotFoundError:
            failed("executable_missing")
            variable = (
                "FFPROBE_PATH" if arguments[0] == self.settings.ffprobe_path else "FFMPEG_PATH"
            )
            raise MediaError(
                f"Cannot find executable {Path(arguments[0]).name!r}. Set {variable} "
                "to its full path, install it on PATH, or put it in ai/.tools/."
            ) from None
        except subprocess.TimeoutExpired:
            failed("timeout")
            raise MediaError("Media processing exceeded its time limit.") from None
        if result.returncode:
            failed("nonzero_exit", exit_code=result.returncode)
            # Stderr can contain private paths and input metadata; never pass it to clients.
            raise MediaError("Could not decode or render this media file.", stderr_tail=stderr_tail)
        log.debug(
            "media_command_completed",
            tool=tool,
            exit_code=0,
            duration_ms=round((time.monotonic() - started) * 1000, 2),
        )
        return result.stdout

    def validate_render_tools(self, *, captions: bool):
        """Reject unsupported FFmpeg builds before cloud analysis is paid for."""
        inventory = self.ffmpeg("-filters").decode("utf-8", errors="replace")
        filters = {parts[1] for line in inventory.splitlines() if len(parts := line.split()) >= 3}
        required = {"zoompan", "eq", "unsharp", "loudnorm", "aeval"}
        if captions:
            required.add("ass")
        missing = sorted(required - filters)
        if missing:
            names = ", ".join(missing)
            libass = " (libass subtitle support)" if "ass" in missing else ""
            raise MediaError(
                f"FFmpeg is missing required filters: {names}{libass}. "
                "Set FFMPEG_PATH to a full FFmpeg build, e.g. ai/.tools/ffmpeg."
            )

    def ffmpeg(self, *args: str, cwd: Path | None = None):
        return self.run(
            [
                self.settings.ffmpeg_path,
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-threads",
                "1",
                "-filter_threads",
                "1",
                "-filter_complex_threads",
                "1",
                *args,
            ],
            cwd=cwd,
        )

    def probe(self, path: Path, *, video: bool = True) -> dict:
        result = self.run(
            [
                self.settings.ffprobe_path,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,mp4,m4a,3gp,3g2,mj2,wav,mp3,flac,ogg,aac",
                "-show_format",
                "-show_streams",
                "-show_entries",
                "format=duration,format_name:stream=codec_type,codec_name,width,height:"
                "stream_disposition=attached_pic",
                "-of",
                "json",
                str(path),
            ],
            timeout=30,
        )
        try:
            data = json.loads(result)
            duration = float(data["format"]["duration"])
            streams = data["streams"]
            primary = next(
                (
                    s
                    for s in streams
                    if s["codec_type"] == ("video" if video else "audio")
                    and not s.get("disposition", {}).get("attached_pic")
                ),
                None,
            )
            if primary is None or not math.isfinite(duration) or duration <= 0:
                raise ValueError
            if duration > (self.settings.max_source_seconds if video else 600):
                raise MediaError("Video must be at most 120 seconds; music at most 10 minutes.")
            if video:
                if not set(data["format"]["format_name"].split(",")).intersection({"mov", "mp4"}):
                    raise MediaError("Upload an MP4 or MOV video.")
                if primary.get("width", 0) * primary.get("height", 0) > 12_000_000:
                    raise MediaError("Video resolution is too large; use 4K or smaller.")
            return {
                "duration": duration,
                "width": primary.get("width"),
                "height": primary.get("height"),
                "has_audio": any(s["codec_type"] == "audio" for s in streams),
                "audio_codec": next(
                    (s.get("codec_name") for s in streams if s["codec_type"] == "audio"),
                    None,
                ),
                "codec": primary.get("codec_name"),
            }
        except (ValueError, KeyError, TypeError, StopIteration):
            raise MediaError("This file has no usable media stream or duration.") from None

    def extract_audio(self, source: Path, output: Path):
        self.ffmpeg(
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            "-map_metadata",
            "-1",
            str(output),
        )

    def dialogue_audio(self, source: Path, segments: list[Segment], until: float, directory: Path):
        """The exact reordered setup audio, on the final output clock, before mixing."""
        args = []
        labels = []
        filters = []
        position = 0.0
        for segment in segments:
            length = min(segment.end - segment.start, until - position)
            if length <= 1e-6:
                break
            index = len(labels)
            args += [
                "-protocol_whitelist",
                "file,pipe",
                "-ss",
                str(segment.start),
                "-i",
                str(source),
            ]
            label = f"s{index}"
            filters.append(
                f"[{index}:a:0]aresample=24000,asetpts=PTS-STARTPTS,apad,"
                f"atrim=duration={length:.9f}[{label}]"
            )
            labels.append(f"[{label}]")
            position += length
        if not labels:
            raise ValueError("No dialogue interval")
        filters.append("".join(labels) + f"concat=n={len(labels)}:v=0:a=1[a]")
        output = directory / "dialogue.wav"
        self.ffmpeg(
            *args,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[a]",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            "-t",
            str(until),
            "-map_metadata",
            "-1",
            str(output),
        )
        return output

    def beats(self, music: Path, directory: Path) -> tuple[float | None, list[float]]:
        audio = directory / "beats.wav"
        self.ffmpeg(
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(music),
            "-t",
            "32",
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
            # Energy-onset envelope, 10ms windows; no large ML/audio dependencies.
            energy = [
                sum(abs(v) for v in samples[i : i + 80]) / 80
                for i in range(0, len(samples) - 80, 80)
            ]
            onset = [max(0, energy[i] - energy[i - 1]) for i in range(1, len(energy))]
            if len(onset) < 200 or max(onset, default=0) < 50:
                return None, []
            correlations = {
                lag: sum(onset[i] * onset[i - lag] for i in range(lag, len(onset)))
                for lag in range(33, 101)
            }
            lag = max(correlations, key=correlations.get)
            norm = sum(v * v for v in onset)
            if norm <= 0 or correlations[lag] / norm < 0.15:
                return None, []
            phase = max(range(lag), key=lambda p: sum(onset[p::lag]))
            return round(6000 / lag, 1), [i / 100 for i in range(phase + 1, len(onset), lag)]
        finally:
            audio.unlink(missing_ok=True)

    def render(
        self,
        source: Path,
        segments: list[Segment],
        directory: Path,
        srt: str,
        has_audio: bool,
        music: Path | None,
        *,
        portrait_filters: list[str] | None = None,
        impact_start: float,
        music_start: float = 0,
        music_delay: float = 0,
        epic: bool = False,
    ) -> tuple[Path, dict]:
        outputs = []
        encoded = {}
        position = 0.0
        impact_index = 0
        if portrait_filters is not None and len(portrait_filters) != len(segments):
            raise ValueError("One portrait filter is required per segment")
        if not all(math.isfinite(t) and t >= 0 for t in (music_start, music_delay)):
            raise ValueError("Invalid music offset")
        total_duration = sum(s.end - s.start for s in segments)
        if not 0 <= impact_start < total_duration:
            raise ValueError("Invalid impact time")
        for index, segment in enumerate(segments):
            clip = directory / f"cut-{index}.mov"
            clip_duration = segment.end - segment.start
            video_filter = "setpts=PTS-STARTPTS," + (
                portrait_filters[index]
                if portrait_filters is not None
                else portrait_filter(segment, [], [])
            )
            if epic:
                if position >= impact_start - 1e-6:
                    video_filter += "," + impact_zoom(round(clip_duration * 30), impact_index)
                    impact_index += 1
                video_filter += "," + GRADE
            position += clip_duration
            key = (segment.start, segment.end, video_filter)
            if key in encoded:
                outputs.append(encoded[key])
                continue
            args = [
                "-protocol_whitelist",
                "file,pipe",
                "-ss",
                str(segment.start),
                "-i",
                str(source),
            ]
            # Always provide silence: a source audio stream may end before this cut.
            args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            if has_audio:
                args += [
                    "-filter_complex",
                    "[0:a:0]aresample=48000:async=1:first_pts=0[voice];"
                    "[voice][1:a:0]amix=inputs=2:duration=longest:normalize=0,"
                    f"atrim=duration={clip_duration:.9f}[audio]",
                ]
            args += [
                "-t",
                str(clip_duration),
                "-map",
                "0:v:0",
                "-map",
                "[audio]" if has_audio else "1:a:0",
                "-vf",
                video_filter,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-threads",
                "1",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "pcm_s16le",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-map_metadata",
                "-1",
                str(clip),
            ]
            self.ffmpeg(*args)
            outputs.append(clip)
            encoded[key] = clip
        listing = directory / "cuts.txt"
        listing.write_text("\n".join(f"file '{p.name}'" for p in outputs))
        # PCM intermediates avoid adding an AAC encoder delay at every cut.
        joined = directory / "joined.mov"
        self.ffmpeg("-f", "concat", "-safe", "1", "-i", str(listing), "-c", "copy", str(joined))
        ass = srt.startswith("[Script Info]")
        subtitle = directory / ("captions.ass" if ass else "captions.srt")
        subtitle.write_text(srt, encoding="utf-8")
        result = directory / "render.mp4"
        duration = sum(s.end - s.start for s in segments)
        args = ["-i", str(joined)]
        if music:
            transition = f"clip((t-{impact_start:.6f}+0.25)/0.5,0,1)"
            mix = (
                "[0:a]loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,"
                f"volume='1-0.82*({transition})':eval=frame,asplit=2[voice][sidechain];"
                "[1:a]loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,"
                f"volume='0.25+0.25*({transition})':eval=frame[music];"
                "[music][sidechain]sidechaincompress=threshold=0.035:ratio=6:"
                "attack=15:release=450[ducked];"
                "[voice][ducked]amix=inputs=2:duration=first:normalize=0,"
                "alimiter=limit=0.89125:level=false:latency=true[a]"
            )
            if epic:
                mix = epic_mix(impact_start, music_delay)
            args += [
                "-stream_loop",
                "-1",
                "-ss",
                str(music_start),
                "-i",
                str(music),
                "-filter_complex",
                mix,
                "-map",
                "0:v:0",
                "-map",
                "[a]",
            ]
        elif epic:
            args += ["-af", NORMALIZE + "," + setup_audio(impact_start)]
        if srt:
            # Fixed relative filename avoids FFmpeg filter injection/path escaping.
            # Set script resolution too: SRT's default ASS canvas otherwise scales the font up.
            subtitle_filter = (
                "ass=captions.ass"
                if ass
                else (
                    "subtitles=captions.srt:force_style='PlayResX=720,PlayResY=1280,"
                    "FontName=DejaVu Sans,FontSize=36,Outline=2,MarginL=40,MarginR=40,MarginV=80'"
                )
            )
            args += [
                "-vf",
                subtitle_filter,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-threads",
                "1",
            ]
        else:
            args += ["-c:v", "copy"]
        args += [
            "-t",
            str(duration),
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(result),
        ]
        with structlog.contextvars.bound_contextvars(media_step="final_mux"):
            self.ffmpeg(*args, cwd=directory)
        info = self.probe(result)
        info["audio_mix"] = (
            "dialogue_then_silent_source"
            if epic and not music
            else "two_phase_dialogue_then_music"
            if music
            else "original"
        )
        if (
            info["width"] != 720
            or info["height"] != 1280
            or info["codec"] != "h264"
            or info["audio_codec"] != "aac"
            or abs(info["duration"] - duration) > 1 / 30 + 0.001
        ):
            raise MediaError("Rendered video did not pass validation.")
        return result, info
