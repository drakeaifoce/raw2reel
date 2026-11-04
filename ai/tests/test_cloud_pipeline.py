import pytest

from raw2reel_ai.analysis import read_analysis
from raw2reel_ai.cloud_models import EditPlan, FaceBoxes, Grouping, SamBox, Selection
from raw2reel_ai.cloud_pipeline import CloudPipeline
from raw2reel_ai.config import Settings
from raw2reel_ai.media import MediaTools


class FakeMeta:
    transcriptions = 0

    def transcribe(self, audio):
        self.transcriptions += 1
        return [{"startMs": 0, "endMs": 500, "transcript": "Hello."}]

    def close(self):
        pass


class FakeCloud:
    def __init__(self):
        self.calls = []

    def sam(self, media, prompt):
        if isinstance(media, bytes):
            return [SamBox(frame=0, object_id=0, bbox=[0.2, 0.2, 0.4, 0.5])]
        return [
            SamBox(frame=i, object_id=1, bbox=[0.2 + i * 0.005, 0.2, 0.4 + i * 0.005, 0.5])
            for i in range(10)
        ]

    def structured(self, schema, prompt, **kwargs):
        self.calls.append({"stage": kwargs.get("stage")})
        if schema is Grouping:
            return Grouping(
                assignments=[
                    {"observation_id": f"o{i}", "person_id": "p1", "label": "Character 1"}
                    for i in range(2)
                ]
            )
        if schema is Selection:
            return Selection(candidate_ids=["c1", "c0"])
        from raw2reel_ai.render_tracking import ShotGrounding

        if schema is ShotGrounding:
            return ShotGrounding(faces=[dict(frame=0, person_id="p1", bbox=[200, 200, 400, 500])])
        if schema is EditPlan:
            return EditPlan(
                narrative="Reordered hook, then impact.",
                impact_start=1,
                music_start=0,
                clips=[
                    {"start": 2, "end": 3, "person_ids": ["p1"], "reason": "hook"},
                    {"start": 0, "end": 1, "person_ids": ["p1"], "reason": "impact"},
                ],
            )
        raise AssertionError(schema)


def test_prepare_render_reuses_transcript_and_remaps_reordered_clips(tmp_path):
    settings = Settings(_env_file=None, cloud_clip_seconds=2, cloud_discovery_frames=2)
    tools = MediaTools(settings)
    source = tmp_path / "source.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        str(source),
    )
    meta, cloud = FakeMeta(), FakeCloud()
    pipeline = CloudPipeline(settings, meta=meta, cloud=cloud)
    artifact = tmp_path / "prepared.json"
    pipeline.prepare(source, artifact)
    catalog, images = read_analysis(artifact)
    assert len(catalog.people) == 1 and len(images) == 2
    assert meta.transcriptions == 1
    manifest = pipeline.render(
        source,
        tmp_path / "result.mp4",
        analysis=artifact,
        person_ids=["p1"],
        duration=15,
        captions=False,
    )
    assert meta.transcriptions == 1
    assert manifest["clips"][0]["start"] == 2
    assert manifest["clips"][0]["output_start"] == 0
    assert manifest["clips"][1]["output_start"] == 1
    assert manifest["impact_start"] == 1
    assert manifest["requested_duration"] == 15
    assert manifest["duration"] == pytest.approx(20, abs=0.04)
    assert len(manifest["clips"]) >= 20
    assert all(c["output_end"] - c["output_start"] <= 0.9 + 1e-6 for c in manifest["clips"][1:])
    assert manifest["reviewed_seconds"] <= settings.cloud_review_seconds
    assert manifest["tracks"]
    assert tools.probe(tmp_path / "result.mp4")["duration"] == pytest.approx(20, abs=0.04)
    changed = tmp_path / "changed.mp4"
    changed.write_bytes(source.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="does not match"):
        pipeline.render(
            changed, tmp_path / "invalid.mp4", analysis=artifact, person_ids=["p1"], duration=2
        )


def test_prepare_falls_back_to_grounding_when_sam_finds_no_faces(tmp_path):
    """SAM находит лица не в каждой сцене, и тогда работает резервная ветка.

    Она не была покрыта тестом и падала с TypeError: вызов structured()
    передавал лишнюю схему. На проде это дало 68 ответов 500 за три часа —
    разбор обрывался на первой же сцене без лиц.
    """
    settings = Settings(_env_file=None, cloud_clip_seconds=2, cloud_discovery_frames=2)
    tools = MediaTools(settings)
    source = tmp_path / "source.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        str(source),
    )

    class BlindSam(FakeCloud):
        def sam(self, media, prompt):
            if isinstance(media, bytes):
                return []
            return super().sam(media, prompt)

        def structured(self, schema, prompt, **kwargs):
            if schema is FaceBoxes:
                self.calls.append({"stage": kwargs.get("stage")})
                return FaceBoxes(faces=[{"bbox": [0.2, 0.2, 0.4, 0.5]}])
            return super().structured(schema, prompt, **kwargs)

    cloud = BlindSam()
    pipeline = CloudPipeline(settings, meta=FakeMeta(), cloud=cloud)
    artifact = tmp_path / "prepared.json"
    pipeline.prepare(source, artifact)

    catalog, _ = read_analysis(artifact)
    assert [call["stage"] for call in cloud.calls].count("face_grounding") == 2
    assert catalog.observations


def test_hard_cut_boundaries_reset_tracking(tmp_path):
    from raw2reel_ai.cloud_media import CloudMedia

    settings = Settings(_env_file=None)
    tools = MediaTools(settings)
    source = tmp_path / "cuts.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=0x303030:size=320x240:rate=30:duration=1",
        "-f",
        "lavfi",
        "-i",
        "color=0x505050:size=320x240:rate=30:duration=1",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        str(source),
    )
    scenes = CloudMedia(tools).scenes(source, 2, tmp_path)
    assert len(scenes) == 2
    assert scenes[0].end == pytest.approx(1, abs=0.04)


def test_review_budget_counts_cfr_rounding(tmp_path):
    class BudgetCloud(FakeCloud):
        def structured(self, schema, prompt, **kwargs):
            if schema is Selection:
                return Selection(candidate_ids=["c0", "c1"])
            if schema is EditPlan:
                return EditPlan(
                    narrative="setup",
                    impact_start=0.5,
                    music_start=0,
                    clips=[{"start": 0, "end": 1, "person_ids": ["p1"], "reason": "setup"}],
                )
            return super().structured(schema, prompt, **kwargs)

    settings = Settings(
        _env_file=None, cloud_clip_seconds=2, cloud_discovery_frames=2, cloud_review_seconds=3.99
    )
    tools = MediaTools(settings)
    source = tmp_path / "source.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30",
        "-frames:v",
        "119",
        "-c:v",
        "libx264",
        str(source),
    )
    pipeline = CloudPipeline(settings, meta=FakeMeta(), cloud=BudgetCloud())
    artifact = tmp_path / "prepared.json"
    pipeline.prepare(source, artifact)
    result = pipeline.render(
        source,
        tmp_path / "result.mp4",
        analysis=artifact,
        person_ids=["p1"],
        duration=2,
        captions=False,
    )
    actual = sum(c["montage_end"] - c["montage_start"] for c in result["review_mapping"])
    assert actual <= settings.cloud_review_seconds
    assert result["reviewed_seconds"] == pytest.approx(actual)


def test_vfr_clip_keeps_source_time_offset(tmp_path):
    from PIL import Image

    from raw2reel_ai.cloud_media import CloudMedia
    from raw2reel_ai.cloud_models import Interval

    tools = MediaTools(Settings(_env_file=None))
    source = tmp_path / "vfr.mp4"
    tools.ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=red:size=320x240:rate=30:duration=2",
        "-vf",
        "drawbox=color=blue:t=fill:enable='gte(t,1)',select='if(lt(t,1),not(mod(n,3)),1)'",
        "-fps_mode",
        "vfr",
        "-c:v",
        "libx264",
        str(source),
    )
    media = CloudMedia(tools)
    clip = tmp_path / "cfr.mp4"
    media.clip(source, Interval(start=0.5, end=1.5), clip)
    media.frame(clip, 0.6, tmp_path / "frame.jpg")  # source time 1.1, after color change
    with Image.open(tmp_path / "frame.jpg") as image:
        red, _, blue = image.getpixel((image.width // 2, image.height // 2))
    assert blue > red * 2
    assert tools.probe(clip)["duration"] == pytest.approx(1, abs=0.21)


def test_grouping_limit_reports_actual_reason_without_cloud_calls(tmp_path, monkeypatch):
    import io
    import json

    from PIL import Image

    from raw2reel_ai.cloud_models import Interval
    from raw2reel_ai.meta import MetaError

    class DistinctPeople(FakeCloud):
        def sam(self, media, prompt):
            return [SamBox(frame=0, object_id=i, bbox=[0.1, 0.1, 0.5, 0.5]) for i in range(3)]

        def structured(self, schema, prompt, **kwargs):
            entries = json.loads(prompt.split("Image order: ", 1)[1])
            return Grouping(
                assignments=[
                    {
                        "observation_id": item["new_observation_id"],
                        "person_id": "p" + item["new_observation_id"][1:],
                        "label": "Character",
                    }
                    for item in entries
                    if "new_observation_id" in item
                ]
            )

    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    pipeline = CloudPipeline(
        Settings(
            _env_file=None,
            cloud_face_min_size_enabled=False,
            cloud_face_dedup_enabled=False,
            cloud_discovery_frames=48,
            cloud_max_observations=256,
        ),
        meta=FakeMeta(),
        cloud=DistinctPeople(),
    )
    monkeypatch.setattr(
        pipeline, "source", lambda _: (source, {"duration": 48, "has_audio": False})
    )
    monkeypatch.setattr(
        pipeline.media, "scenes", lambda *_: [Interval(start=i, end=i + 1) for i in range(48)]
    )
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16)).save(buffer, format="JPEG")
    monkeypatch.setattr(pipeline.media, "frame", lambda *_: buffer.getvalue())
    with pytest.raises(MetaError, match="64") as error:
        pipeline.prepare(source, tmp_path / "prepared.json")
    assert error.value.code == "face_catalog_limit"
