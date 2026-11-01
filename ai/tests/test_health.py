import sys

from raw2reel_ai.config import Settings
from raw2reel_ai.health import readiness


def test_readiness_uses_local_media_dependencies_only():
    settings = Settings(_env_file=None, ffmpeg_path=sys.executable, ffprobe_path=sys.executable)
    result = readiness(settings)
    assert result["ready"] is True
    assert result["dependencies"] == {"ffmpeg": {"state": "ok"}, "ffprobe": {"state": "ok"}}


def test_missing_tool_makes_service_unready(tmp_path):
    settings = Settings(
        _env_file=None, ffmpeg_path=str(tmp_path / "missing-ffmpeg"), ffprobe_path=sys.executable
    )
    result = readiness(settings)
    assert result["ready"] is False
    assert result["dependencies"]["ffmpeg"]["state"] == "error"
    assert "FFMPEG_PATH" in result["dependencies"]["ffmpeg"]["detail"]
