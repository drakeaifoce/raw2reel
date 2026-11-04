"""Numeric-only FFmpeg crop expressions generated from validated tracks."""

import itertools

from PIL import Image

from .cloud_models import TrackPoint
from .models import Segment


def crop_centers(
    segment: Segment,
    tracks: list[TrackPoint],
    person_ids: list[str],
    *,
    aspect_ratio: float = 16 / 9,
):
    crop_width = min(1.0, (9 / 16) / aspect_ratio)
    crop_height = min(1.0, aspect_ratio / (9 / 16))
    points = sorted(
        [
            p
            for p in tracks
            if segment.start - 0.5 <= p.time < segment.end and p.person_id in person_ids
        ],
        key=lambda p: p.time,
    )
    centers = []
    previous = None
    time = 0.0
    while time < segment.end - segment.start:
        source_time = segment.start + time
        recent = {}
        for pid in person_ids:
            matches = [p for p in points if p.person_id == pid]
            before = [p for p in matches if p.time <= source_time]
            after = [p for p in matches if p.time > source_time]
            if before:
                point = before[-1]
                if after and after[0].time - point.time <= 1.2:
                    weight = (source_time - point.time) / (after[0].time - point.time)
                    box = [
                        a + (b - a) * weight for a, b in zip(point.bbox, after[0].bbox, strict=True)
                    ]
                    point = point.model_copy(update={"bbox": box})
                recent[pid] = point
            elif after and after[0].time - source_time <= 0.6:
                recent[pid] = after[0]
        if recent:
            values = list(recent.values())
            left, top = min(p.bbox[0] for p in values), min(p.bbox[1] for p in values)
            right, bottom = max(p.bbox[2] for p in values), max(p.bbox[3] for p in values)
            # A wide group cannot fit a portrait crop: deterministic first selected person.
            if right - left > crop_width or bottom - top > crop_height:
                first = next(recent[pid] for pid in person_ids if pid in recent)
                left, top, right, bottom = first.bbox
            target = ((left + right) / 2, (top + bottom) / 2)
        else:
            target = (0.5, 0.5)
        center = (
            target
            if previous is None
            else tuple(0.55 * a + 0.45 * b for a, b in zip(previous, target, strict=False))
        )
        if recent and right - left <= crop_width and bottom - top <= crop_height:
            # Keep smoothing within a narrow band around the subject, not just
            # barely inside the frame (zoom would otherwise cut off the face).
            center = (
                max(target[0] - crop_width * 0.1, min(target[0] + crop_width * 0.1, center[0])),
                center[1],
            )
            center = (
                max(right - crop_width / 2, min(left + crop_width / 2, center[0])),
                max(bottom - crop_height / 2, min(top + crop_height / 2, center[1])),
            )
        centers.append((time, *center))
        previous = center
        time += 0.2
    return centers


def _expression(centers, index):
    expression = f"{centers[-1][index]:.6f}"
    for a, b in reversed(list(itertools.pairwise(centers))):
        start, end = a[0], b[0]
        linear = f"({a[index]:.6f}+({b[index] - a[index]:.6f})*(t-{start:.3f})/{end - start:.3f})"
        expression = f"if(lt(t,{end:.3f}),{linear},{expression})"
    return expression


def portrait_filter(
    segment: Segment,
    tracks: list[TrackPoint],
    person_ids: list[str],
    *,
    aspect_ratio: float = 16 / 9,
    content_bounds: tuple[float, float, float, float] = (0, 0, 1, 1),
) -> str:
    prefix = ""
    left, top, right, bottom = content_bounds
    if content_bounds != (0, 0, 1, 1):
        width, height = right - left, bottom - top
        transformed = []
        for point in tracks:
            x1, y1, x2, y2 = point.bbox
            box = [
                max(0, min(1, (x1 - left) / width)),
                max(0, min(1, (y1 - top) / height)),
                max(0, min(1, (x2 - left) / width)),
                max(0, min(1, (y2 - top) / height)),
            ]
            if box[0] < box[2] and box[1] < box[3]:
                transformed.append(point.model_copy(update={"bbox": box}))
        tracks = transformed
        aspect_ratio *= width / height
        prefix = (
            f"crop=w='trunc(iw*{width:.9f}/2)*2':h='trunc(ih*{height:.9f}/2)*2':"
            f"x='trunc(iw*{left:.9f}/2)*2':y='trunc(ih*{top:.9f}/2)*2',"
        )
    centers = crop_centers(segment, tracks, person_ids, aspect_ratio=aspect_ratio)
    x, y = _expression(centers, 1), _expression(centers, 2)
    # Runtime iw/ih are the displayed (auto-rotated) frame dimensions.
    return prefix + (
        "crop=w='trunc(min(iw,ih*9/16)/2)*2':"
        "h='trunc(min(ih,iw*16/9)/2)*2':"
        f"x='max(0,min(iw-ow,iw*({x})-ow/2))':"
        f"y='max(0,min(ih-oh,ih*({y})-oh/2))',"
        "scale=720:1280,setsar=1,fps=30"
    )


def remap_impact(clips, segments: list[Segment], impact: float) -> float:
    """Translate model output time after each cut has been rounded inward to frames."""
    original_offset = 0.0
    output_offset = 0.0
    mapped = 0.0
    for clip, segment in zip(clips, segments, strict=True):
        old_length = clip.end - clip.start
        new_length = segment.end - segment.start
        if impact <= original_offset + old_length:
            mapped = output_offset + min(new_length, max(0, impact - original_offset))
            break
        original_offset += old_length
        output_offset += new_length
    total = sum(s.end - s.start for s in segments)
    return min(int((mapped + 1e-8) * 30) / 30, max(0, total - 1 / 30))


def detect_content_bounds(frames: list[Image.Image]) -> tuple[float, float, float, float]:
    """Conservative stable black-border removal; ignore corner watermarks and fades."""
    bounds = []
    for frame in frames:
        image = frame.convert("L")
        w, h = image.size
        pixels = image.load()

        def black_row(y, pixels=pixels, w=w):
            values = [pixels[x, y] for x in range(w // 6, w - w // 6)]
            return sum(v < 20 for v in values) >= len(values) * 0.98

        top = 0
        while top < h // 4 and black_row(top):
            top += 1
        bottom = h
        while bottom > h - h // 4 and black_row(bottom - 1):
            bottom -= 1
        if top >= h // 4 or bottom <= h - h // 4:
            continue  # all-black/fade/large dark composition is not a reliable border
        bounds.append((0, top / h, 1, bottom / h))
    if len(bounds) < 2:
        return (0, 0, 1, 1)
    top = min(b[1] for b in bounds)
    bottom = max(b[3] for b in bounds)
    if top < 0.015:
        top = 0
    if bottom > 0.985:
        bottom = 1
    return (0, top, 1, bottom)
