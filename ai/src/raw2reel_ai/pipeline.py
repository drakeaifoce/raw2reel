"""Standalone local-file → Meta analysis/transcription → FFmpeg → MP4 pipeline."""

import array
import hashlib
import json
import tempfile
import wave
from collections.abc import Callable
from pathlib import Path

from .config import Settings
from .media import MediaTools
from .meta import MetaClient
from .models import Analysis, RenderRequest
from .planning import align_to_beats, choose_segments, make_srt, quantize_segments


def _fingerprint(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _write_json(path: Path, value: dict):
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _has_signal(audio: Path) -> bool:
    with wave.open(str(audio), "rb") as wav:
        while frames := wav.readframes(24000):
            if max(map(abs, array.array("h", frames)), default=0) > 100:
                return True
    return False


def _turns(value) -> list[dict]:
    if not isinstance(value, list) or len(value) > 2000:
        raise ValueError("Transcript must contain a list of timed speech turns.")
    for turn in value:
        if (
            not isinstance(turn, dict)
            or not isinstance(turn.get("startMs"), int)
            or not isinstance(turn.get("endMs"), int)
            or turn["startMs"] < 0
            or turn["endMs"] < turn["startMs"]
            or not isinstance(turn.get("transcript"), str)
        ):
            raise ValueError("Invalid transcript timestamps or text.")
    return value


class ReelPipeline:
    def __init__(
        self, settings: Settings | None = None, *, meta: MetaClient | None = None
    ):
        self.settings = settings or Settings()
        self.media = MediaTools(self.settings)
        self.meta = meta or MetaClient(self.settings)

    def close(self):
        self.meta.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _source(self, source: Path) -> tuple[Path, dict]:
        source = Path(source).resolve(strict=True)
        if (
            not source.is_file()
            or source.stat().st_size > self.settings.max_upload_bytes
        ):
            raise ValueError("Input must be a video file of at most 150 MiB.")
        return source, self.media.probe(source)

    def _speech(self, source: Path, info: dict, work: Path) -> list[dict]:
        if not info["has_audio"]:
            return []
        audio = work / "speech.wav"
        self.media.extract_audio(source, audio)
        return self.meta.transcribe(audio) if _has_signal(audio) else []

    def _analysis(
        self, source: Path, info: dict, work: Path, turns: list[dict]
    ) -> Analysis:
        prepared = work / "analysis.mp4"
        self.media.prepare_analysis(source, prepared)
        analysis = self.meta.analyze(prepared, info["duration"], transcript=turns)
        choose_segments(analysis, [], 30, info["duration"])
        return analysis

    @staticmethod
    def _artifact(
        source: Path, info: dict, analysis: Analysis, turns: list[dict] | None
    ) -> dict:
        return {
            "version": 1,
            "source": {
                "name": source.name,
                "sha256": _fingerprint(source),
                "bytes": source.stat().st_size,
                **info,
            },
            "analysis": analysis.model_dump(),
            "turns": turns,
        }

    def analyze(
        self,
        source: Path,
        output: Path,
        *,
        transcribe: bool = True,
        overwrite: bool = False,
        on_progress: Callable[[str], None] | None = None,
    ) -> dict:
        progress = on_progress or (lambda _: None)
        output = Path(output).resolve()
        source, info = self._source(source)
        if output == source:
            raise ValueError("Analysis output must not overwrite the source video.")
        if output.exists() and not overwrite:
            raise FileExistsError(
                "Analysis output exists; use --overwrite to replace it."
            )
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix=".raw2reel-", dir=output.parent
        ) as directory:
            work = Path(directory)
            progress("transcribing")
            turns = self._speech(source, info, work) if transcribe else None
            progress("analyzing")
            analysis = self._analysis(source, info, work, turns or [])
            artifact = self._artifact(source, info, analysis, turns)
            pending = work / "analysis.json"
            _write_json(pending, artifact)
            pending.replace(output)
        progress("done")
        return artifact

    def render(
        self,
        source: Path,
        output: Path,
        *,
        duration: float = 27,
        music: Path | None = None,
        subject_ids: list[str] | None = None,
        analysis_path: Path | None = None,
        transcript_path: Path | None = None,
        captions: bool = True,
        overwrite: bool = False,
        on_progress: Callable[[str], None] | None = None,
    ) -> dict:
        options = RenderRequest(
            subject_ids=subject_ids or [], duration=duration, use_music=bool(music)
        )
        progress = on_progress or (lambda _: None)
        source, info = self._source(source)
        output = Path(output).resolve()
        if output.suffix.lower() != ".mp4" or output == source:
            raise ValueError("Choose an MP4 output different from the source.")
        artifacts = {
            "analysis": output.with_suffix(".analysis.json"),
            "captions": output.with_suffix(".captions.srt"),
            "manifest": output.with_suffix(".manifest.json"),
        }
        inputs = {source}
        inputs.update(
            Path(path).resolve()
            for path in (music, analysis_path, transcript_path)
            if path is not None
        )
        for destination in [output, *artifacts.values()]:
            if destination in inputs:
                raise ValueError(
                    "Output and sidecars must not overwrite any input file."
                )
            if destination.exists() and not overwrite:
                raise FileExistsError(
                    "Output or sidecar exists; use --overwrite to replace it."
                )
        if music is not None:
            music = Path(music).resolve(strict=True)
            if music == output or music.stat().st_size > self.settings.max_music_bytes:
                raise ValueError("Music must be a separate file of at most 32 MiB.")
            self.media.probe(music, video=False)
        analysis = None
        turns = None
        if analysis_path:
            artifact = json.loads(Path(analysis_path).read_text(encoding="utf-8"))
            artifact_source = (
                artifact.get("source") if isinstance(artifact, dict) else None
            )
            if not isinstance(artifact_source, dict) or artifact_source.get(
                "sha256"
            ) != _fingerprint(source):
                raise ValueError("Analysis does not match this source video.")
            analysis = Analysis.model_validate(artifact["analysis"])
            if artifact.get("turns") is not None:
                turns = _turns(artifact["turns"])
        if transcript_path:
            transcript = json.loads(Path(transcript_path).read_text(encoding="utf-8"))
            turns = _turns(
                transcript.get("turns") if isinstance(transcript, dict) else transcript
            )
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix=".raw2reel-", dir=output.parent
        ) as directory:
            work = Path(directory)
            if turns is None and captions:
                progress("transcribing")
                turns = self._speech(source, info, work)
            if analysis is None:
                progress("analyzing")
                analysis = self._analysis(source, info, work, turns or [])
            segments = quantize_segments(
                choose_segments(
                    analysis, options.subject_ids, duration, info["duration"]
                )
            )
            warnings = [
                "Portrait framing fits the image; exact person tracking is not implemented."
            ]
            bpm, beats = None, []
            if music:
                progress("detecting_beats")
                bpm, beats = self.media.beats(music, work)
                if beats:
                    segments = align_to_beats(segments, beats)
                else:
                    warnings.append(
                        "Music rhythm uncertain; cuts follow the edit plan."
                    )
            if options.subject_ids:
                warnings.append(
                    "People filtering uses approximate Muse scene observations, "
                    "not identity recognition."
                )
            srt = make_srt(turns or [], segments) if captions else ""
            progress("rendering")
            rendered, result = self.media.render(
                source, segments, work, srt, info["has_audio"], music
            )
            manifest = {
                "version": 1,
                "file": output.name,
                "duration": result["duration"],
                "width": result["width"],
                "height": result["height"],
                "cuts": len(segments) - 1,
                "bpm": bpm,
                "captions": bool(srt),
                "audio_mix": result["audio_mix"],
                "subjects_tracked": False,
                "warnings": warnings,
                "segments": [s.model_dump() for s in segments],
                "hook": analysis.hook,
                "summary": analysis.summary,
                "configured_models": {
                    "analysis": self.settings.muse_spark_model,
                    "transcription": self.settings.muse_voice_model
                    if captions
                    else None,
                },
            }
            _write_json(
                work / "analysis.json", self._artifact(source, info, analysis, turns)
            )
            _write_json(work / "manifest.json", manifest)
            (work / "captions.srt").write_text(srt, encoding="utf-8")
            progress("saving")
            for name, destination in artifacts.items():
                extension = ".srt" if name == "captions" else ".json"
                (work / (name + extension)).replace(destination)
            rendered.replace(output)
        progress("done")
        return manifest
