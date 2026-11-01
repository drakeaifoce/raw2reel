"""Validated model output; an LLM never gets to dictate a shell command or path."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


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
