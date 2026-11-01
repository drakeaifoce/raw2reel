"""Versioned, bounded cloud pipeline artifacts. All times are seconds."""

import itertools
from typing import Literal

from pydantic import Field, model_validator

from .models import StrictModel


class Box(StrictModel):
    bbox: list[float] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def valid_box(self):
        x1, y1, x2, y2 = self.bbox
        if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
            raise ValueError("Invalid normalized xyxy box")
        return self


class Interval(StrictModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def forward(self):
        if self.end <= self.start:
            raise ValueError("Empty interval")
        return self


class Observation(Box):
    id: str = Field(pattern=r"^o[0-9]+$")
    scene: int = Field(ge=0)
    time: float = Field(ge=0)


class Person(StrictModel):
    id: str = Field(pattern=r"^p[0-9]+$")
    label: str = Field(min_length=1, max_length=100)
    observation_ids: list[str] = Field(min_length=1, max_length=512)


class People(StrictModel):
    people: list[Person] = Field(max_length=100)


class TranscriptTurn(StrictModel):
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    transcript: str = Field(max_length=10000)

    @model_validator(mode="after")
    def forward(self):
        if self.endMs < self.startMs:
            raise ValueError("Invalid transcript times")
        return self


class Catalog(StrictModel):
    version: Literal[2] = 2
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_duration: float = Field(gt=0)
    scenes: list[Interval] = Field(min_length=1, max_length=1000)
    observations: list[Observation] = Field(max_length=512)
    people: list[Person] = Field(max_length=100)
    turns: list[TranscriptTurn] = Field(max_length=2000)
    warnings: list[str] = Field(max_length=100)
    provenance: dict[str, str] = Field(max_length=20)

    @model_validator(mode="after")
    def references(self):
        observations = {o.id: o for o in self.observations}
        if len(observations) != len(self.observations):
            raise ValueError("Duplicate observation")
        if len({p.id for p in self.people}) != len(self.people):
            raise ValueError("Duplicate person")
        used = []
        for person in self.people:
            if not set(person.observation_ids) <= observations.keys():
                raise ValueError("Unknown observation")
            used.extend(person.observation_ids)
        if len(used) != len(set(used)):
            raise ValueError("Observation assigned to multiple people")
        for index, scene in enumerate(self.scenes):
            if scene.end > self.source_duration + 0.05:
                raise ValueError("Scene outside source")
            if index and abs(scene.start - self.scenes[index - 1].end) > 0.05:
                raise ValueError("Scenes must partition source")
        if (
            abs(self.scenes[0].start) > 0.001
            or abs(self.scenes[-1].end - self.source_duration) > 0.05
        ):
            raise ValueError("Incomplete scene map")
        for o in self.observations:
            if o.scene >= len(self.scenes):
                raise ValueError("Unknown scene")
            scene = self.scenes[o.scene]
            if not scene.start <= o.time < scene.end:
                raise ValueError("Observation outside scene")
        if any(t.endMs > self.source_duration * 1000 + 100 for t in self.turns):
            raise ValueError("Transcript outside source")
        return self


class SamBox(Box):
    frame: int = Field(ge=0)
    object_id: int = Field(ge=0)


class TrackPoint(Box):
    time: float = Field(ge=0)
    person_id: str
    scene: int = Field(ge=0)


class Candidate(Interval):
    id: str = Field(pattern=r"^c[0-9]+$")
    person_ids: list[str] = Field(max_length=16)
    presence: Literal["present", "unknown"]
    reason: str = Field(max_length=500)


class Selection(StrictModel):
    candidate_ids: list[str] = Field(min_length=1, max_length=100)


class EditClip(Interval):
    reason: str = Field(max_length=500)
    person_ids: list[str] = Field(min_length=1, max_length=16)


class EditPlan(StrictModel):
    narrative: str = Field(min_length=1, max_length=4000)
    clips: list[EditClip] = Field(min_length=1, max_length=40)
    impact_start: float = Field(ge=0)
    music_start: float = Field(ge=0, le=3600)

    @model_validator(mode="after")
    def timeline(self):
        if any(c.end - c.start < 1 / 30 for c in self.clips):
            raise ValueError("Edit clips must contain at least one output frame")
        duration = sum(c.end - c.start for c in self.clips)
        if duration > 30.001 or self.impact_start >= duration:
            raise ValueError("Invalid edit duration or impact time")
        ordered = sorted(self.clips, key=lambda c: c.start)
        if any(b.start < a.end - 0.001 for a, b in itertools.pairwise(ordered)):
            raise ValueError("Overlapping source intervals")
        return self


class Assignment(StrictModel):
    observation_id: str
    person_id: str = Field(pattern=r"^p[0-9]+$")
    label: str = Field(min_length=1, max_length=100)


class Grouping(StrictModel):
    assignments: list[Assignment] = Field(max_length=256)


class FaceBoxes(StrictModel):
    faces: list[Box] = Field(max_length=16)
