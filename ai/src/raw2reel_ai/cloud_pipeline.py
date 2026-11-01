"""Prepare -> user selects anonymous person IDs -> track -> budgeted edit -> render."""

import json
import tempfile
from pathlib import Path

from .artifacts import read_artifact, write_artifact
from .cloud_media import CloudMedia, face_thumbnail
from .cloud_meta import CloudModels
from .cloud_models import (
    Candidate,
    Catalog,
    EditPlan,
    FaceBoxes,
    Grouping,
    Observation,
    Person,
    Selection,
    TrackPoint,
    TranscriptTurn,
)
from .config import Settings
from .media import MediaTools
from .meta import MetaClient, MetaError
from .models import Segment
from .pipeline import _fingerprint, _has_signal, _write_json
from .planning import make_srt, quantize_segments
from .reframing import portrait_filter, remap_impact


class CloudPipeline:
    def __init__(self, settings: Settings, *, meta: MetaClient | None = None, cloud=None):
        self.settings = settings
        self.meta = meta or MetaClient(settings)
        self.cloud = cloud or CloudModels(self.meta)
        self.tools = MediaTools(settings)
        self.media = CloudMedia(self.tools)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.meta.close()

    def source(self, source: Path):
        source = source.resolve(strict=True)
        if not source.is_file() or source.stat().st_size > self.settings.max_upload_bytes:
            raise ValueError("Source exceeds size limit")
        return source, self.tools.probe(source)

    def prepare(self, source: Path, output: Path, *, overwrite=False, on_progress=None):
        progress = on_progress or (lambda _: None)
        source, info = self.source(source)
        output = output.resolve()
        if output == source or (output.exists() and not overwrite):
            raise ValueError("Choose a new preparation ZIP output")
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=output.parent) as temp:
            work = Path(temp)
            progress("discovering_scenes")
            scenes = self.media.scenes(source, info["duration"], work)
            maximum = self.settings.cloud_discovery_frames
            # Cover the complete timeline; short scenes count independently.
            indices = sorted(
                {
                    min(len(scenes) - 1, int((i + 0.5) * len(scenes) / min(maximum, len(scenes))))
                    for i in range(min(maximum, len(scenes)))
                }
            )
            observations, images = [], {}
            warnings = [
                "Cloud matching is approximate; tiny, obscured and brief faces may be missed.",
                "Discovery is sampled; unobserved scenes have unknown presence.",
            ]
            progress("discovering_faces")
            for index in indices:
                if len(observations) >= self.settings.cloud_max_observations:
                    warnings.append("Observation budget reached; remaining scenes are unknown.")
                    break
                scene = scenes[index]
                time = (scene.start + scene.end) / 2
                frame = self.media.frame(source, time, work / "frame.jpg")
                boxes = self.cloud.sam(frame, "face")
                if not boxes:
                    fallback = self.cloud.structured(
                        FaceBoxes,
                        "Locate visible faces in this image. Return normalized xyxy boxes; "
                        "return [] if none are visible.",
                        images=[frame],
                        stage="face_grounding",
                    )
                    normalized = [b.bbox for b in fallback.faces]
                else:
                    normalized = [b.bbox for b in boxes if b.frame == 0]
                for bbox in normalized[:16]:
                    if len(observations) >= self.settings.cloud_max_observations:
                        break
                    identity = f"o{len(observations)}"
                    name = f"faces/{identity}.jpg"
                    images[name] = face_thumbnail(frame, bbox)
                    observations.append(
                        Observation(id=identity, scene=index, time=time, image=name, bbox=bbox)
                    )
            progress("grouping_faces")
            people: dict[str, Person] = {}
            known = {o.id: o for o in observations}
            for start in range(0, len(observations), 8):
                batch = observations[start : start + 8]
                references = [(p.id, known[p.observation_ids[0]]) for p in people.values()]
                parts = [images[o.image] for _, o in references] + [images[o.image] for o in batch]
                prompt = (
                    "Match anonymous characters within this video only, across these face crops. "
                    "Return one assignment for every new observation. Reuse a reference person ID "
                    "only if confident; otherwise use a fresh pN ID, including uncertain matches. "
                    "No names, no demographic labels; neutral labels such as Character 1. "
                    "Image order: "
                    + json.dumps(
                        [
                            {"reference_person_id": pid, "observation_id": o.id}
                            for pid, o in references
                        ]
                        + [{"new_observation_id": o.id} for o in batch]
                    )
                )
                grouped = self.cloud.structured(
                    Grouping, prompt, images=parts, stage="face_grouping"
                )
                assignments = grouped.assignments
                if len(assignments) != len(batch) or {a.observation_id for a in assignments} != {
                    o.id for o in batch
                }:
                    raise MetaError(
                        "model_response", "Face grouping omitted or duplicated observations."
                    )
                for a in assignments:
                    if a.person_id in people:
                        people[a.person_id].observation_ids.append(a.observation_id)
                    else:
                        if len(people) >= 64:
                            raise ValueError("Too many distinct people; use a shorter source")
                        people[a.person_id] = Person(
                            id=a.person_id, label=a.label, observation_ids=[a.observation_id]
                        )
            progress("transcribing")
            turns = []
            if info["has_audio"]:
                audio = work / "speech.wav"
                self.tools.extract_audio(source, audio)
                if _has_signal(audio):
                    raw = self.meta.transcribe(audio)
                    turns = [
                        TranscriptTurn.model_validate(
                            {k: t[k] for k in ("startMs", "endMs", "transcript")}
                        )
                        for t in raw
                    ]
            catalog = Catalog(
                source_sha256=_fingerprint(source),
                source_duration=info["duration"],
                scenes=scenes,
                observations=observations,
                people=list(people.values()),
                turns=turns,
                warnings=warnings,
                provenance={
                    "sam": self.settings.sam_model,
                    "spark": self.settings.muse_spark_model,
                    "voice": self.settings.muse_voice_model,
                    "schema": "2",
                    "prompt": "cloud-edit-1",
                },
            )
            pending = work / "prepared.zip"
            write_artifact(pending, catalog, images)
            pending.replace(output)
        progress("done")
        return {
            "artifact": str(output),
            "people": [p.model_dump() for p in catalog.people],
            "observations": [o.model_dump() for o in catalog.observations],
            "warnings": warnings,
            "sampled_scenes": len(indices),
            "total_scenes": len(scenes),
            "calls": self.cloud.calls,
        }

    def render(
        self,
        source: Path,
        output: Path,
        *,
        artifact: Path,
        person_ids: list[str],
        music: Path | None = None,
        duration=27,
        captions=True,
        overwrite=False,
        on_progress=None,
    ):
        progress = on_progress or (lambda _: None)
        source, info = self.source(source)
        output = output.resolve()
        if output.suffix.lower() != ".mp4" or not person_ids or len(person_ids) > 16:
            raise ValueError("Choose 1..16 people and an MP4 output")
        if not 0 < duration <= 30:
            raise ValueError("Duration must be in (0,30]")
        sidecar = output.with_suffix(".v2.json")
        inputs = {source, artifact.resolve()}
        if music:
            music = music.resolve(strict=True)
            inputs.add(music)
            if music.stat().st_size > self.settings.max_music_bytes:
                raise ValueError("Music exceeds size limit")
            self.tools.probe(music, video=False)
        if any(p in inputs or (p.exists() and not overwrite) for p in (output, sidecar)):
            raise ValueError("Output must not replace inputs or existing files")
        catalog, images = read_artifact(artifact)
        if catalog.source_sha256 != _fingerprint(source):
            raise ValueError("Preparation artifact does not match source")
        known = {p.id: p for p in catalog.people}
        if len(set(person_ids)) != len(person_ids) or not set(person_ids) <= known.keys():
            raise ValueError("Unknown or duplicate selected person IDs")
        observations = {o.id: o for o in catalog.observations}
        selected = [
            (pid, observations[oid]) for pid in person_ids for oid in known[pid].observation_ids
        ]
        warnings = list(catalog.warnings)
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".cloud-render-", dir=output.parent) as temp:
            work = Path(temp)
            progress("tracking")
            tracks, candidates = [], []
            track_seconds = 0.0
            tracking_limited = False
            aspect_ratio = info["width"] / info["height"]
            # Positive observations are processed first. Unknown scenes remain candidates.
            scene_order = sorted(
                range(len(catalog.scenes)), key=lambda i: not any(o.scene == i for _, o in selected)
            )
            for scene_index in scene_order:
                scene = catalog.scenes[scene_index]
                seeds = [(pid, o) for pid, o in selected if o.scene == scene_index]
                points = []
                if (
                    seeds
                    and track_seconds + scene.end - scene.start <= self.settings.cloud_track_seconds
                ):
                    clip = work / "tracking.mp4"
                    self.media.clip(source, scene, clip)
                    clip_info = self.tools.probe(clip)
                    if track_seconds + clip_info["duration"] > self.settings.cloud_track_seconds:
                        tracking_limited = True
                        candidates.append(
                            Candidate(
                                id=f"c{scene_index}",
                                start=scene.start,
                                end=scene.end,
                                person_ids=[],
                                presence="unknown",
                                reason="Tracking budget reached",
                            )
                        )
                        continue
                    width, height = clip_info["width"], clip_info["height"]
                    aspect_ratio = width / height
                    fps = self.settings.cloud_analysis_fps
                    prompts = []
                    mapping = {}
                    # Only one seed per selected person per scene; preserve chosen order.
                    for pid in person_ids:
                        matches = [o for p, o in seeds if p == pid]
                        if not matches:
                            continue
                        o = matches[0]
                        identity = person_ids.index(pid) + 1
                        mapping[identity] = pid
                        frame = min(
                            max(0, round((o.time - scene.start) * fps)),
                            max(0, int(clip_info["duration"] * fps) - 1),
                        )
                        x1, y1, x2, y2 = o.bbox
                        prompts.append(
                            f"<{frame}f>{identity}<|box;x1={int(x1 * width)};"
                            f"y1={int(y1 * height)};x2={min(width - 1, int(x2 * width) - 1)};"
                            f"y2={min(height - 1, int(y2 * height) - 1)};w={width};h={height}|>"
                        )
                    boxes = self.cloud.sam(clip, "".join(prompts))
                    track_seconds += clip_info["duration"]
                    for box in boxes:
                        if (
                            box.object_id not in mapping
                            or box.frame >= int(clip_info["duration"] * fps) + 1
                        ):
                            raise MetaError(
                                "model_response", "SAM returned unexpected object or frame."
                            )
                        time = scene.start + box.frame / fps
                        if time < scene.end:
                            points.append(
                                TrackPoint(
                                    time=time,
                                    person_id=mapping[box.object_id],
                                    scene=scene_index,
                                    bbox=box.bbox,
                                )
                            )
                    tracks.extend(points)
                if (
                    seeds
                    and not points
                    and track_seconds + scene.end - scene.start > self.settings.cloud_track_seconds
                ):
                    tracking_limited = True
                candidates.append(
                    Candidate(
                        id=f"c{scene_index}",
                        start=scene.start,
                        end=scene.end,
                        person_ids=sorted({p.person_id for p in points}),
                        presence="present" if points else "unknown",
                        reason="SAM observations" if points else "Not conclusively tracked",
                    )
                )
            if tracking_limited:
                warnings.append("Tracking budget reached; remaining footage has unknown presence.")
            progress("detecting_beats")
            bpm, beats = self.tools.beats(music, work) if music else (None, [])
            progress("preselecting")
            turns = [t.model_dump() for t in catalog.turns]
            selection = self.cloud.structured(
                Selection,
                "Select candidate IDs worth watching for an edit about selected characters. "
                "Prefer strong dialogue, conflict, action, reactions and context. Silent scenes "
                "can be valuable. Unknown presence is not absence. Include context around speech. "
                f"Target edit {duration}s; "
                f"review budget {self.settings.cloud_review_seconds}s. "
                "Return candidate IDs in priority order. Data:\n"
                + json.dumps(
                    {
                        "selected_people": person_ids,
                        "candidates": [c.model_dump() for c in candidates],
                        "transcript": turns,
                    }
                ),
                stage="preselection",
            )
            by_id = {c.id: c for c in candidates}
            if (
                len(selection.candidate_ids) != len(set(selection.candidate_ids))
                or not set(selection.candidate_ids) <= by_id.keys()
            ):
                raise MetaError("model_response", "Unknown or duplicate review candidate IDs.")
            progress("reviewing_video")
            reviewed, reviewed_seconds = [], 0.0
            mapping = []
            for identity in selection.candidate_ids:
                c = by_id[identity]
                if reviewed_seconds + c.end - c.start > self.settings.cloud_review_seconds:
                    continue
                clip = work / f"review-{len(reviewed)}.mp4"
                self.media.clip(source, c, clip)
                actual = self.tools.probe(clip)["duration"]
                if reviewed_seconds + actual > self.settings.cloud_review_seconds:
                    clip.unlink()
                    continue
                mapping.append(
                    {
                        "montage_start": reviewed_seconds,
                        "montage_end": reviewed_seconds + actual,
                        "source_start": c.start,
                        "source_end": c.end,
                        "candidate_id": c.id,
                    }
                )
                reviewed.append(c)
                reviewed_seconds += actual
            if not reviewed:
                raise ValueError("No candidates fit the review budget")
            listing = work / "review.txt"
            listing.write_text("\n".join(f"file 'review-{i}.mp4'" for i in range(len(reviewed))))
            montage = work / "review.mp4"
            self.tools.ffmpeg(
                "-f", "concat", "-safe", "1", "-i", str(listing), "-c", "copy", str(montage)
            )
            if self.tools.probe(montage)["duration"] > self.settings.cloud_review_seconds + 0.001:
                raise ValueError("Review montage exceeds video budget")
            references = [
                images[observations[known[pid].observation_ids[0]].image] for pid in person_ids
            ]
            plan = self.cloud.structured(
                EditPlan,
                "Watch this review montage and make a two-part edit: dialogue/story setup, then "
                "music-led impact. First write narrative, then an ordered exact edit plan. "
                "Reference images follow selected_people order. "
                "Use only viewed intervals showing a selected character. "
                "Clip start/end MUST be original SOURCE seconds, translated using the mapping, "
                "not montage time. Each clip must fit inside ONE reviewed source interval; "
                "clips must not overlap but may be reordered. Never invent events. "
                f"Total duration must be <= {duration}s and > 0. "
                "impact_start: FINAL OUTPUT seconds. music_start: soundtrack offset. "
                "Align impact and cuts to provided beats if useful; do not exceed valid intervals. "
                "Data:\n"
                + json.dumps(
                    {
                        "selected_people": person_ids,
                        "mapping": mapping,
                        "transcript": turns,
                        "bpm": bpm,
                        "beats": beats[:400],
                        "music_duration": self.tools.probe(music, video=False)["duration"]
                        if music
                        else None,
                    }
                ),
                images=references,
                video=montage,
                stage="video_plan",
            )
            if sum(c.end - c.start for c in plan.clips) > duration + 0.001:
                raise MetaError("model_response", "Edit exceeds requested duration.")
            for c in plan.clips:
                if not set(c.person_ids) <= set(person_ids) or not any(
                    c.start >= r.start - 0.001 and c.end <= r.end + 0.001 for r in reviewed
                ):
                    raise MetaError(
                        "model_response", "Edit uses unreviewed footage or unknown people."
                    )
            if music and plan.music_start >= self.tools.probe(music, video=False)["duration"]:
                raise MetaError("model_response", "Music offset outside soundtrack.")
            segments = quantize_segments(
                [
                    Segment(start=c.start, end=c.end, reason=c.reason, subject_ids=c.person_ids)
                    for c in plan.clips
                ]
            )
            impact = remap_impact(plan.clips, segments, plan.impact_start)
            filters = [
                portrait_filter(
                    s,
                    [
                        t
                        for t in tracks
                        if catalog.scenes[t.scene].start <= s.start < catalog.scenes[t.scene].end
                    ],
                    person_ids,
                    aspect_ratio=aspect_ratio,
                )
                for s in segments
            ]
            if not tracks:
                warnings.append("No reliable SAM track; using central crop.")
            elif any(not any(s.start <= t.time < s.end for t in tracks) for s in segments):
                warnings.append("Some selected clips have no reliable track; central crop is used.")
            progress("rendering")
            rendered, result = self.tools.render(
                source,
                segments,
                work,
                make_srt(turns, segments) if captions else "",
                info["has_audio"],
                music,
                portrait_filters=filters,
                impact_start=impact,
                music_start=plan.music_start,
            )
            timeline, position = [], 0.0
            for segment in segments:
                length = segment.end - segment.start
                timeline.append(
                    {
                        **segment.model_dump(),
                        "output_start": position,
                        "output_end": position + length,
                    }
                )
                position += length
            manifest = {
                "version": 2,
                "source_sha256": catalog.source_sha256,
                "narrative": plan.narrative,
                "clips": timeline,
                "impact_start": impact,
                "music_start": plan.music_start,
                "duration": result["duration"],
                "bpm": bpm,
                "audio_mix": result["audio_mix"],
                "warnings": warnings,
                "tracks": [t.model_dump() for t in tracks],
                "candidates": [c.model_dump() for c in candidates],
                "review_mapping": mapping,
                "reviewed_seconds": reviewed_seconds,
                "tracked_seconds": track_seconds,
                "calls": self.cloud.calls,
            }
            _write_json(work / "manifest.json", manifest)
            (work / "manifest.json").replace(sidecar)
            rendered.replace(output)
        progress("done")
        return manifest
