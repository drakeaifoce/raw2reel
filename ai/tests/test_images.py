import io

from PIL import Image
from raw2reel_ai.images import normalize


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "navy").save(buffer, format="PNG")
    return buffer.getvalue()


def test_большое_изображение_уменьшается_до_предела() -> None:
    data, size = normalize(_png(4000, 2000), max_side=1920)
    assert max(size) == 1920
    assert size == (1920, 960)
    assert data[:2] == b"\xff\xd8"  # маркер JPEG


def test_маленькое_изображение_не_растягивается() -> None:
    _, size = normalize(_png(640, 480), max_side=1920)
    assert size == (640, 480)
