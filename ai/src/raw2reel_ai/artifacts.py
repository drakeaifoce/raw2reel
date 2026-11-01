"""Portable preparation ZIPs: never extract arbitrary archive members."""

import re
import zipfile
from pathlib import Path

from .cloud_models import Catalog

MAX_ARTIFACT = 32 * 1024 * 1024


def read_artifact(path: Path) -> tuple[Catalog, dict[str, bytes]]:
    if path.stat().st_size > MAX_ARTIFACT:
        raise ValueError("Preparation archive too large")
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [e.filename for e in entries]
            if len(entries) > 513 or len(names) != len(set(names)):
                raise ValueError("Invalid archive entries")
            if any(not re.fullmatch(r"catalog\.json|faces/o[0-9]+\.jpg", n) for n in names):
                raise ValueError("Unexpected archive path")
            if sum(e.file_size for e in entries) > MAX_ARTIFACT:
                raise ValueError("Expanded preparation archive too large")
            if any(e.file_size > 4 * 1024 * 1024 or e.flag_bits & 1 for e in entries):
                raise ValueError("Invalid archive member")
            catalog = Catalog.model_validate_json(archive.read("catalog.json"))
            images = {o.image: archive.read(o.image) for o in catalog.observations}
            if set(names) != {"catalog.json", *images}:
                raise ValueError("Unreferenced archive images")
            # Do not decode untrusted thumbnails; tracking uses original-frame coordinates.
            return catalog, images
    except (zipfile.BadZipFile, KeyError, RuntimeError) as error:
        raise ValueError("Invalid preparation archive") from error


def write_artifact(path: Path, catalog: Catalog, images: dict[str, bytes]):
    if set(images) != {o.image for o in catalog.observations}:
        raise ValueError("Missing catalog images")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("catalog.json", catalog.model_dump_json(indent=2))
        for name, data in images.items():
            archive.writestr(name, data)
    read_artifact(path)
