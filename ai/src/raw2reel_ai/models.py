"""Validated model output; an LLM never gets to dictate a shell command or path."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Subject(StrictModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(max_length=500)
    timestamp: float = Field(ge=0)
    bbox: list[float] | None = None

    @model_validator(mode="after")
    def valid_box(self):
        if self.bbox is not None:
            if len(self.bbox) != 4 or not all(0 <= v <= 1 for v in self.bbox):
                raise ValueError("Bounding boxes must be normalized xyxy")
            x1, y1, x2, y2 = self.bbox
            if x1 >= x2 or y1 >= y2:
                raise ValueError("Empty bounding box")
        return self


class Segment(StrictModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    reason: str = Field(max_length=500)
    subject_ids: list[str] = Field(max_length=20)

    @model_validator(mode="after")
    def forward(self):
        if self.end <= self.start:
            raise ValueError("Segment must have positive duration")
        return self


class Analysis(StrictModel):
    summary: str = Field(min_length=1, max_length=2000)
    hook: str = Field(min_length=1, max_length=1000)
    subjects: list[Subject] = Field(max_length=20)
    segments: list[Segment] = Field(min_length=1, max_length=40)


class RenderRequest(StrictModel):
    subject_ids: list[str] = Field(default_factory=list, max_length=20)
    duration: float = Field(default=27, gt=0, le=30)
    use_music: bool = True
