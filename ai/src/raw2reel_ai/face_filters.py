"""Independent deterministic filters between cloud detection and face grouping."""

from dataclasses import dataclass

from .config import Settings


def _area(box: list[float]) -> float:
    return (box[2] - box[0]) * (box[3] - box[1])


def _iou(a: list[float], b: list[float]) -> float:
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0, min(a[3], b[3]) - max(a[1], b[1])
    )
    union = _area(a) + _area(b) - intersection
    return intersection / union if union > 0 else 0


@dataclass(frozen=True)
class FilterResult:
    boxes: list[list[float]]
    removed_small: int = 0
    removed_duplicates: int = 0


class FaceFilters:
    """Composable switches; no cross-frame identity matching or neural inference."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def apply(self, boxes: list[list[float]], frame_size: tuple[int, int]) -> FilterResult:
        width, height = frame_size
        if width <= 0 or height <= 0:
            raise ValueError("Invalid detection frame dimensions")
        retained = list(boxes)
        if self.settings.cloud_face_min_size_enabled:
            minimum = self.settings.cloud_face_min_size_px
            retained = [
                b
                for b in retained
                if (b[2] - b[0]) * width + 1e-6 >= minimum
                and (b[3] - b[1]) * height + 1e-6 >= minimum
            ]
        removed_small = len(boxes) - len(retained)
        if self.settings.cloud_face_dedup_enabled:
            # SAM has no face confidence score: prefer the larger box, then original order.
            selected = []
            for index in sorted(range(len(retained)), key=lambda i: (-_area(retained[i]), i)):
                if all(
                    _iou(retained[index], retained[other]) < self.settings.cloud_face_dedup_iou
                    for other in selected
                ):
                    selected.append(index)
            unique = [retained[i] for i in sorted(selected)]
        else:
            unique = retained
        return FilterResult(
            boxes=unique,
            removed_small=removed_small,
            removed_duplicates=len(retained) - len(unique),
        )
