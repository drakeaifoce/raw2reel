"""Numeric-only FFmpeg crop expressions generated from validated tracks."""

import itertools

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
        for p in points:
            if p.time <= source_time and source_time - p.time <= 0.6:
                recent[p.person_id] = p
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
            center = (
                max(right - crop_width / 2, min(left + crop_width / 2, center[0])),
                max(bottom - crop_height / 2, min(top + crop_height / 2, center[1])),
            )
        centers.append((time, *center))
        previous = center
        time += 0.5
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
) -> str:
    centers = crop_centers(segment, tracks, person_ids, aspect_ratio=aspect_ratio)
    x, y = _expression(centers, 1), _expression(centers, 2)
    # Runtime iw/ih are the displayed (auto-rotated) frame dimensions.
    return (
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
