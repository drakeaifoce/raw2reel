"""Deterministic media preparation; no local inference or model weights."""

import io
import itertools
import math
import re
from pathlib import Path

from PIL import Image

from .cloud_models import Interval
from .media import MediaTools


class CloudMedia:
    def __init__(self, tools: MediaTools):
        self.tools = tools

    def scenes(self, source: Path, duration: float, work: Path) -> list[Interval]:
        metadata = work / "scene-times.txt"
        self.tools.ffmpeg(
            "-i",
            str(source),
            "-an",
            "-vf",
            "scale=160:-2,select='gt(scene,0.18)',metadata=print:file=scene-times.txt",
            "-f",
            "null",
            "-",
            cwd=work,
        )
        text = metadata.read_text() if metadata.exists() else ""
        cuts = sorted(
            {
                float(t)
                for t in re.findall(r"pts_time:([0-9.]+)", text)
                if 0.1 < float(t) < duration - 0.1
            }
        )
        boundaries = [0.0, *cuts, duration]
        result = []
        for start, end in itertools.pairwise(boundaries):
            count = max(1, math.ceil((end - start) / self.tools.settings.cloud_clip_seconds))
            for i in range(count):
                result.append(
                    Interval(
                        start=start + (end - start) * i / count,
                        end=start + (end - start) * (i + 1) / count,
                    )
                )
        if len(result) > 1000:
            raise ValueError("Too many scenes for one source")
        return result

    def frame(self, source: Path, time: float, output: Path) -> bytes:
        self.tools.ffmpeg(
            "-ss",
            str(time),
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            str(output),
        )
        return output.read_bytes()

    def clip(self, source: Path, interval: Interval, output: Path, *, include_audio=False):
        self.tools.ffmpeg(
            "-ss",
            str(interval.start),
            "-i",
            str(source),
            "-t",
            str(interval.end - interval.start),
            *(
                [
                    "-af",
                    "aresample=48000:async=1:first_pts=0,apad",
                    "-c:a",
                    "aac",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                ]
                if include_audio
                else ["-an"]
            ),
            "-vf",
            f"scale=640:-2,fps={self.tools.settings.cloud_analysis_fps}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            str(output),
        )


def face_thumbnail(data: bytes, bbox: list[float]) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        width, height = image.size
        x1, y1, x2, y2 = bbox
        # A little context helps distinguish profiles and avoids clipping the face.
        dx, dy = (x2 - x1) * 0.2, (y2 - y1) * 0.2
        crop = image.crop(
            (
                max(0, int((x1 - dx) * width)),
                max(0, int((y1 - dy) * height)),
                min(width, math.ceil((x2 + dx) * width)),
                min(height, math.ceil((y2 + dy) * height)),
            )
        )
        crop.thumbnail((192, 192))
        buffer = io.BytesIO()
        crop.convert("RGB").save(buffer, format="JPEG", quality=90)
        return buffer.getvalue()
