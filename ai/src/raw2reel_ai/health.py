"""Local runtime readiness; storage belongs to the application backend."""

from shutil import which

from .config import Settings, get_settings


def readiness(settings: Settings | None = None) -> dict[str, object]:
    settings = settings or get_settings()
    dependencies = {}
    for name, path in (("ffmpeg", settings.ffmpeg_path), ("ffprobe", settings.ffprobe_path)):
        dependencies[name] = (
            {"state": "ok"}
            if which(path)
            else {"state": "error", "detail": f"Install {name} or configure {name.upper()}_PATH."}
        )
    return {
        "ready": all(d["state"] == "ok" for d in dependencies.values()),
        "dependencies": dependencies,
    }
