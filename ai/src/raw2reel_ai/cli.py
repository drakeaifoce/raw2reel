"""Run locally, without the application backend or UI."""

import argparse
import json
import sys
import traceback
import uuid
from pathlib import Path

import structlog

from .cloud_pipeline import CloudPipeline
from .config import Settings
from .media import MediaError
from .meta import MetaError
from .observability import configure_logging, exception_fields


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
        "--debug",
        action="store_true",
        help="Show a readable traceback and external FFmpeg diagnostics (may include media paths)",
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
    configure_logging()
    with structlog.contextvars.bound_contextvars(
        request_id=uuid.uuid4().hex, entrypoint="cli", operation=args.command
    ):
        return _execute(args)


def _execute(args):
    try:
        settings = Settings(_env_file=args.env_file)
        configure_logging(settings.log_level, settings.log_format)
        with CloudPipeline(settings) as pipeline:
            if args.command == "prepare":
                result = pipeline.prepare(args.video, args.output, overwrite=args.overwrite)
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
    except Exception as error:
        fields = exception_fields(error)
        if isinstance(error, MediaError):
            fields["error_code"] = "media_error"
        if not args.debug and fields["error_code"] != "internal_error":
            fields.pop("traceback", None)
        structlog.get_logger(__name__).error("command_failed", **fields)
        if args.debug:
            _debug_exception(error, fields)

    return 1


def _debug_exception(error: Exception, fields: dict):
    """Readable traceback without copying validation payloads into the terminal."""
    frames = traceback.StackSummary.from_list(
        [
            traceback.FrameSummary(f["file"], f["line"], f["function"], line="")
            for f in fields.get("traceback", [])
        ]
    )
    message = str(error) if isinstance(error, (MediaError, MetaError)) else fields["error_code"]
    sys.stderr.write(
        "Traceback (most recent call last):\n"
        + "".join(frames.format())
        + f"{type(error).__name__}: {message}\n"
    )
    if isinstance(error, MediaError) and error.stderr_tail:
        sys.stderr.write("FFmpeg/ffprobe stderr (last 16 KiB):\n" + error.stderr_tail + "\n")
