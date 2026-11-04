"""Ground only selected, insufficiently tracked scenes against chosen face references."""

import json
from dataclasses import dataclass

import structlog
from pydantic import Field

from .cloud_models import Box, TrackPoint
from .meta import MetaError
from .models import StrictModel

log = structlog.get_logger(__name__)


class GroundedFace(Box):
    frame: int = Field(ge=0, le=2)
    person_id: str = Field(pattern=r"^p[0-9]+$")


class ShotGrounding(StrictModel):
    faces: list[GroundedFace] = Field(max_length=48)


@dataclass
class RefinedTracks:
    tracks: list[TrackPoint]
    used_seconds: float
    warnings: list[str]


def has_track(segment, tracks):
    times = [
        segment.start,
        (segment.start + segment.end) / 2,
        max(segment.start, segment.end - 1 / 30),
    ]
    return all(
        any(p.person_id in segment.subject_ids and abs(p.time - t) <= 0.4 + 1e-6 for p in tracks)
        for t in times
    )


def refine_tracks(
    source,
    segments,
    scenes,
    references,
    tracks,
    *,
    settings,
    cloud,
    media,
    tools,
    work,
    used_seconds,
):
    result = list(tracks)
    warnings = []
    for scene_index, scene in enumerate(scenes):
        selected = [
            s
            for s in segments
            if scene.start - 1e-5 <= s.start < scene.end
            and not has_track(s, [p for p in result if p.scene == scene_index])
        ]
        if not selected:
            continue
        times = sorted(
            {
                selected[0].start + min(0.1, (selected[0].end - selected[0].start) / 2),
                (selected[0].start + selected[0].end) / 2,
                max(s.end for s in selected)
                - min(0.1, (selected[-1].end - selected[-1].start) / 2),
            }
        )
        times = [max(scene.start, min(scene.end - 1 / 30, t)) for t in times][:3]
        ids = list(
            dict.fromkeys(pid for s in selected for pid in s.subject_ids if pid in references)
        )
        if not ids:
            continue
        frames = [
            media.frame(source, t, work / f"ground-{scene_index}-{i}.jpg")
            for i, t in enumerate(times)
        ]
        grounded = cloud.structured(
            ShotGrounding,
            "Locate ONLY the selected anonymous people in these video frames "
            "using the face references. "
            "Reference images come first in reference_ids order; "
            "then video frames in frame_times order. "
            "Return normalized xyxy FACE boxes in full frame coordinates and frame index 0..2. "
            "Match stable facial structure across pose/lighting. "
            "Never assign a different visible person "
            "to a reference just because they are prominent. "
            "If no selected person is visible, return []. "
            "No names or demographic labels. Data: "
            + json.dumps(dict(reference_ids=ids, frame_times=times)),
            images=[references[pid] for pid in ids] + frames,
            stage="render_grounding",
        )
        if any(f.person_id not in ids or f.frame >= len(times) for f in grounded.faces):
            raise MetaError("model_response", "Invalid selected-shot grounding reference.")
        if not grounded.faces:
            warnings.append(
                f"No reliable selected-person grounding in scene {scene_index}; "
                "full frame retained."
            )
            continue
        anchors = [
            TrackPoint(time=times[f.frame], person_id=f.person_id, scene=scene_index, bbox=f.bbox)
            for f in grounded.faces
        ]
        dense = []
        if used_seconds + scene.end - scene.start <= settings.cloud_track_seconds:
            clip = work / f"selected-tracking-{scene_index}.mp4"
            media.clip(source, scene, clip)
            info = tools.probe(clip)
            if used_seconds + info["duration"] <= settings.cloud_track_seconds:
                fps = settings.cloud_analysis_fps
                prompts = []
                for face in grounded.faces:
                    frame = min(
                        max(0, round((times[face.frame] - scene.start) * fps)),
                        max(0, int(info["duration"] * fps) - 1),
                    )
                    x1, y1, x2, y2 = face.bbox
                    w, h = info["width"], info["height"]
                    prompts.append(
                        f"<{frame}f>{ids.index(face.person_id) + 1}<|box;x1={int(x1 * w)};"
                        f"y1={int(y1 * h)};x2={min(w - 1, int(x2 * w) - 1)};"
                        f"y2={min(h - 1, int(y2 * h) - 1)};w={w};h={h}|>"
                    )
                boxes = cloud.sam(clip, "".join(prompts))
                used_seconds += info["duration"]
                for box in boxes:
                    if (
                        not 1 <= box.object_id <= len(ids)
                        or box.frame >= int(info["duration"] * fps) + 1
                    ):
                        raise MetaError(
                            "model_response", "Invalid selected-shot SAM object or frame."
                        )
                    time = scene.start + box.frame / fps
                    if time < scene.end:
                        dense.append(
                            TrackPoint(
                                time=time,
                                person_id=ids[box.object_id - 1],
                                scene=scene_index,
                                bbox=box.bbox,
                            )
                        )
        if not dense:
            warnings.append(
                f"Scene {scene_index} uses reference-grounded anchors without dense tracking."
            )
        matched = {p.person_id for p in anchors}
        result = [p for p in result if p.scene != scene_index or p.person_id not in matched]
        result.extend(dense + anchors)
        log.info(
            "selected_scene_tracked",
            scene_index=scene_index,
            anchors=len(anchors),
            points=len(dense),
        )
    return RefinedTracks(result, used_seconds, warnings)


def shot_tracks(segment, tracks, scenes):
    """Do not let a nearby observation from another camera shot anchor this crop."""
    scene = next((i for i, s in enumerate(scenes) if s.start - 1e-5 <= segment.start < s.end), None)
    return [
        p
        for p in tracks
        if p.scene == scene
        and p.person_id in segment.subject_ids
        and segment.start - 0.6 <= p.time < segment.end
    ]
