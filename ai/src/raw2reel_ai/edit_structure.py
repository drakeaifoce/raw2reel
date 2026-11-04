"""Frame-exact two-part edit scheduling over model-approved source intervals."""

import math
from dataclasses import dataclass

from .cloud_models import EditPlan
from .models import Segment

FPS = 30
EDIT_SECONDS = 20
TOTAL_FRAMES = EDIT_SECONDS * FPS
MIN_SHOT = 12  # 0.4 seconds
MAX_SHOT = 27  # 0.9 seconds


@dataclass
class StructuredEdit:
    segments: list[Segment]
    impact_start: float
    warnings: list[str]


def _segment(clip, start, frames):
    return Segment(
        start=start, end=start + frames / FPS, reason=clip.reason, subject_ids=list(clip.person_ids)
    )


def build_edit(plan: EditPlan, *, bpm: float | None = None, impact_beats=()) -> StructuredEdit:
    """Keep <=2 setup shots; fill impact with bounded, intentionally reusable footage.

    The caller validates every plan clip against reviewed footage BEFORE calling this.
    Source timestamps need not be frame-aligned: only durations are quantized inward.
    """
    setup, reservoir = [], []
    position = 0.0
    for clip in plan.clips:
        length = clip.end - clip.start
        before = min(length, max(0, plan.impact_start - position))
        if before >= 1 / FPS:
            setup.append((clip, clip.start, math.floor(before * FPS + 1e-6)))
        after = length - before
        if after >= 1 / FPS:
            reservoir.append((clip, clip.start + before, math.floor(after * FPS + 1e-6)))
        position += length
    warnings = []
    if not setup:
        clip = plan.clips[0]
        setup = [
            (clip, clip.start, min(14 * FPS, math.floor((clip.end - clip.start) * FPS + 1e-6)))
        ]
        warnings.append("No dialogue setup was supplied; the first approved shot is used.")
    if len(setup) > 2:
        raise ValueError(
            "Dialogue setup needs more than two shots; select a complete shorter phrase"
        )
    used = sum(frames for _, _, frames in setup)
    if used > 14 * FPS:
        raise ValueError(
            "Dialogue setup is longer than 14 seconds; select a complete shorter phrase"
        )
    segments = [_segment(clip, start, frames) for clip, start, frames in setup]
    if not used:
        raise ValueError("Approved setup is shorter than one output frame")
    if used < 6 * FPS:
        warnings.append("Approved setup is shorter than six seconds; dialogue is not stretched.")
    impact_start = used / FPS
    if not reservoir:
        reservoir = [(c, c.start, math.floor((c.end - c.start) * FPS + 1e-6)) for c in plan.clips]
    reservoir = [r for r in reservoir if r[2] > 0]
    # Tiny model-selected highlights cannot support normal fast cuts: reuse the full
    # approved interval, including setup if needed, rather than inventing extra footage.
    if max(r[2] for r in reservoir) < MIN_SHOT:
        reservoir = [(c, c.start, math.floor((c.end - c.start) * FPS + 1e-6)) for c in plan.clips]
        reservoir = [r for r in reservoir if r[2] > 0]
        warnings.append("Very little impact footage; approved setup shots may be reused.")
    remaining = TOTAL_FRAMES - used
    budget = remaining
    beat_frames = sorted({round(t * FPS) for t in impact_beats if math.isfinite(t) and t > 0})
    if not beat_frames and bpm and math.isfinite(bpm) and 40 <= bpm <= 240:
        step = 60 / bpm * FPS
        beat_frames = [round(i * step) for i in range(1, math.ceil(TOTAL_FRAMES / step) + 1)]
    index = elapsed = 0
    visits = [0] * len(reservoir)
    capacity = min(MAX_SHOT, max(r[2] for r in reservoir))

    def fits(frames):
        return frames == 0 or (
            capacity >= MIN_SHOT and math.ceil(frames / capacity) <= frames // MIN_SHOT
        )

    while remaining:
        desired = next(
            (b - elapsed for b in beat_frames if MIN_SHOT <= b - elapsed <= MAX_SHOT),
            (24, 18, 15, 18)[index % 4],
        )
        viable = [i for i, r in enumerate(reservoir) if r[2] >= desired]
        if not viable:
            viable = [i for i, r in enumerate(reservoir) if r[2] == max(r[2] for r in reservoir)]
        choice = viable[index % len(viable)]
        clip, start, available = reservoir[choice]
        frames = min(desired, available, remaining)
        if fits(remaining):
            # Look ahead: avoid a tail that cannot be partitioned into normal shots.
            choices = [
                n
                for n in range(MIN_SHOT, min(remaining, available, MAX_SHOT) + 1)
                if fits(remaining - n)
            ]
            if choices:
                frames = min(choices, key=lambda n: abs(n - frames))
        elif 0 < remaining - frames < MIN_SHOT and remaining >= 2 * MIN_SHOT:
            frames = min(remaining - MIN_SHOT, available, MAX_SHOT)
        room = available - frames
        offset = (visits[choice] * max(1, frames // 2)) % (room + 1)
        segments.append(_segment(clip, start + offset / FPS, frames))
        visits[choice] += 1
        remaining -= frames
        elapsed += frames
        index += 1
    if budget > sum(r[2] for r in reservoir):
        warnings.append("Limited approved footage is intentionally reused in the impact montage.")
    if max(r[2] for r in reservoir) < MIN_SHOT:
        warnings.append("Approved intervals are shorter than the normal 0.4-second impact shot.")
    return StructuredEdit(segments, impact_start, warnings)
