"""Run locally, without the application backend or UI."""

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from .config import Settings
from .media import MediaError
from .meta import MetaError
from .pipeline import ReelPipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Analyze and edit a local video with Muse and FFmpeg."
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env"),
        help="Server-side environment file",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser(
        "analyze", help="Save a reusable analysis and timed transcript"
    )
    analyze.add_argument("video", type=Path)
    analyze.add_argument("--output", "-o", type=Path, required=True)
    analyze.add_argument("--no-transcription", action="store_true")
    analyze.add_argument("--overwrite", action="store_true")
    render = commands.add_parser(
        "render", help="Create a portrait MP4 and metadata sidecars"
    )
    render.add_argument("video", type=Path)
    render.add_argument("--output", "-o", type=Path, required=True)
    render.add_argument("--music", type=Path)
    render.add_argument("--duration", type=float, default=27)
    render.add_argument(
        "--subject", action="append", default=[], help="Person ID from a saved analysis"
    )
    render.add_argument(
        "--analysis", type=Path, help="Analysis artifact from the analyze command"
    )
    render.add_argument(
        "--transcript", type=Path, help="JSON file containing timed Voice turns"
    )
    render.add_argument("--no-captions", action="store_true")
    render.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    try:
        settings = Settings(_env_file=args.env_file)
        with ReelPipeline(settings) as pipeline:

            def progress(stage: str):
                print(stage, file=sys.stderr, flush=True)

            if args.command == "analyze":
                result = pipeline.analyze(
                    args.video,
                    args.output,
                    transcribe=not args.no_transcription,
                    overwrite=args.overwrite,
                    on_progress=progress,
                )
            else:
                result = pipeline.render(
                    args.video,
                    args.output,
                    duration=args.duration,
                    music=args.music,
                    subject_ids=args.subject,
                    analysis_path=args.analysis,
                    transcript_path=args.transcript,
                    captions=not args.no_captions,
                    overwrite=args.overwrite,
                    on_progress=progress,
                )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except MetaError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
    except MediaError as error:
        print(f"media_error: {error}", file=sys.stderr)
    except ValidationError:
        print(
            "invalid_input: invalid settings, analysis or render options.",
            file=sys.stderr,
        )
    except (OSError, ValueError, KeyError, TypeError):
        print(
            "invalid_input: check input files, saved analysis and output paths.",
            file=sys.stderr,
        )
    return 1
