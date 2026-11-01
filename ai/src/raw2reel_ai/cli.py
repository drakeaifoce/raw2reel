"""Run locally, without the application backend or UI."""

import argparse
import json
import sys
import traceback
from pathlib import Path

from pydantic import ValidationError

from .cloud_pipeline import CloudPipeline
from .config import Settings
from .media import MediaError
from .meta import MetaError


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
    parser.add_argument(
        "--debug", action="store_true", help="Print the original exception traceback"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser(
        "prepare", help="Discover faces; save catalog and thumbnails as JSON"
    )
    prepare.add_argument("video", type=Path)
    prepare.add_argument("--output", "-o", type=Path, required=True)
    prepare.add_argument("--overwrite", action="store_true")
    cloud_render = commands.add_parser("render-v2", help="Track selected people and render an edit")
    cloud_render.add_argument("video", type=Path)
    cloud_render.add_argument("--analysis", type=Path, required=True)
    cloud_render.add_argument("--person", action="append", required=True)
    cloud_render.add_argument("--music", type=Path)
    cloud_render.add_argument("--duration", type=float, default=27)
    cloud_render.add_argument("--output", "-o", type=Path, required=True)
    cloud_render.add_argument("--no-captions", action="store_true")
    cloud_render.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    try:
        settings = Settings(_env_file=args.env_file)
        with CloudPipeline(settings) as pipeline:

            def progress(stage: str):
                print(stage, file=sys.stderr, flush=True)

            if args.command == "prepare":
                result = pipeline.prepare(
                    args.video, args.output, overwrite=args.overwrite, on_progress=progress
                )
            elif args.command == "render-v2":
                result = pipeline.render(
                    args.video,
                    args.output,
                    analysis=args.analysis,
                    person_ids=args.person,
                    music=args.music,
                    duration=args.duration,
                    captions=not args.no_captions,
                    overwrite=args.overwrite,
                    on_progress=progress,
                )
        if args.command == "prepare":
            result = {
                "analysis": str(args.output),
                "people": result["catalog"]["people"],
                "warnings": result["catalog"]["warnings"],
                "calls": len(result["calls"]),
            }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except MetaError as error:
        if args.debug:
            traceback.print_exc()
        print(f"{error.code}: {error}", file=sys.stderr)
    except MediaError as error:
        if args.debug:
            traceback.print_exc()
        print(f"media_error: {error}", file=sys.stderr)
    except ValidationError:
        if args.debug:
            traceback.print_exc()
        print(
            "invalid_input: invalid settings, analysis or render options.",
            file=sys.stderr,
        )
    except (OSError, ValueError, KeyError, TypeError):
        if args.debug:
            traceback.print_exc()
        print(
            "invalid_input: check input files, saved analysis and output paths.",
            file=sys.stderr,
        )
    return 1
