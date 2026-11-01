"""Portable JSON response owned by the backend; no AI-side project storage."""

import base64
import binascii
import io
from pathlib import Path

from PIL import Image
from pydantic import Field, model_validator

from .cloud_models import Catalog
from .models import StrictModel

MAX_ANALYSIS_BYTES = 16 * 1024 * 1024
IMAGE_PREFIX = "data:image/jpeg;base64,"


class PreparedAnalysis(StrictModel):
    catalog: Catalog
    thumbnails: dict[str, str] = Field(max_length=256)
    calls: list[dict] = Field(default_factory=list, max_length=512)

    @model_validator(mode="after")
    def references(self):
        if set(self.thumbnails) != {o.id for o in self.catalog.observations}:
            raise ValueError("Missing or unreferenced thumbnail")
        if any(not v.startswith(IMAGE_PREFIX) or len(v) > 90000 for v in self.thumbnails.values()):
            raise ValueError("Thumbnails must be bounded JPEG data URLs")
        return self


def thumbnail_bytes(value: str) -> bytes:
    try:
        data = base64.b64decode(value[len(IMAGE_PREFIX) :], validate=True)
        if len(data) > 64 * 1024:
            raise ValueError("Thumbnail exceeds size limit")
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG" or not all(0 < dimension <= 256 for dimension in image.size):
                raise ValueError("Invalid thumbnail format or dimensions")
            image.verify()
        return data
    except (binascii.Error, OSError) as error:
        raise ValueError("Invalid JPEG thumbnail") from error


def read_analysis(value: Path | dict | PreparedAnalysis) -> tuple[Catalog, dict[str, bytes]]:
    if isinstance(value, Path):
        if value.stat().st_size > MAX_ANALYSIS_BYTES:
            raise ValueError("Analysis JSON exceeds size limit")
        payload = PreparedAnalysis.model_validate_json(value.read_bytes())
    elif isinstance(value, PreparedAnalysis):
        payload = value
    else:
        payload = PreparedAnalysis.model_validate(value)
    images = {identity: thumbnail_bytes(data) for identity, data in payload.thumbnails.items()}
    return payload.catalog, images


def write_analysis(path: Path, catalog: Catalog, images: dict[str, bytes], calls: list[dict]):
    payload = PreparedAnalysis(
        catalog=catalog,
        thumbnails={
            identity: IMAGE_PREFIX + base64.b64encode(data).decode()
            for identity, data in images.items()
        },
        calls=calls,
    )
    encoded = payload.model_dump_json(indent=2).encode()
    if len(encoded) > MAX_ANALYSIS_BYTES:
        raise ValueError("Analysis JSON exceeds size limit")
    path.write_bytes(encoded)
    return payload
