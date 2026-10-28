"""Предобработка изображений."""

from __future__ import annotations

import io

from PIL import Image

from .config import settings

# Pillow по умолчанию предупреждает и продолжает при огромных изображениях.
# На хосте с 4 GB это кончается OOM, поэтому ставим жёсткий потолок.
Image.MAX_IMAGE_PIXELS = settings.max_image_pixels


def normalize(data: bytes, *, max_side: int = 1920) -> tuple[bytes, tuple[int, int]]:
    """Привести изображение к JPEG с ограничением длинной стороны.

    Возвращает закодированные байты и итоговые размеры.
    """
    with Image.open(io.BytesIO(data)) as source:
        image = source.convert("RGB")
        scale = min(1.0, max_side / max(image.size))
        if scale < 1.0:
            target = (round(image.width * scale), round(image.height * scale))
            image = image.resize(target, Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85, optimize=True)
        return buffer.getvalue(), image.size
