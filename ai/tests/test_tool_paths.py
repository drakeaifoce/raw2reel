import pytest

import raw2reel_ai.config as config
from raw2reel_ai.media import MediaError, MediaTools


def executable(directory, name, message):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(f"#!/bin/sh\nprintf '{message}'\n")
    path.chmod(0o755)
    return path


def test_pipeline_finds_local_tools_without_exports(tmp_path, monkeypatch):
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.delenv("FFPROBE_PATH", raising=False)
    monkeypatch.setenv("PATH", "")
    local = tmp_path / ".tools"
    monkeypatch.setattr(config, "LOCAL_TOOLS_DIR", local, raising=False)
    executable(local, "ffmpeg", "local ffmpeg")
    executable(local, "ffprobe", "local ffprobe")
    settings = config.Settings(_env_file=None)
    tools = MediaTools(settings)
    assert tools.run([settings.ffmpeg_path, "-version"]) == b"local ffmpeg"
    assert tools.run([settings.ffprobe_path, "-version"]) == b"local ffprobe"


def test_local_tool_has_priority_over_system_copy(tmp_path, monkeypatch):
    monkeypatch.delenv("FFPROBE_PATH", raising=False)
    local = tmp_path / ".tools"
    system = tmp_path / "system"
    monkeypatch.setattr(config, "LOCAL_TOOLS_DIR", local, raising=False)
    executable(local, "ffprobe", "local ffprobe")
    executable(system, "ffprobe", "system ffprobe")
    monkeypatch.setenv("PATH", str(system))
    settings = config.Settings(_env_file=None)
    assert MediaTools(settings).run([settings.ffprobe_path, "-version"]) == b"local ffprobe"


def test_missing_probe_explains_which_setting_to_fix(tmp_path):
    settings = config.Settings(_env_file=None, ffprobe_path=str(tmp_path / "not-installed"))
    with pytest.raises(MediaError, match="FFPROBE_PATH"):
        MediaTools(settings).run([settings.ffprobe_path, "-version"])
