import sys

import pytest

from raw2reel_ai.config import Settings, tool_path
from raw2reel_ai.media import MediaError, MediaTools


def test_local_tools_preferred_without_explicit_path(tmp_path, monkeypatch):
    import raw2reel_ai.config as config

    local = tmp_path / "ffmpeg"
    local.write_bytes(b"tool")
    monkeypatch.setattr(config, "LOCAL_TOOLS_DIR", tmp_path)
    monkeypatch.setattr(config, "which", lambda _: "/system/ffmpeg")
    assert tool_path("ffmpeg") == str(local)
    assert (
        Settings(_env_file=None, ffmpeg_path="/explicit/ffmpeg").ffmpeg_path == "/explicit/ffmpeg"
    )


def test_missing_subtitle_filter_fails_before_render(tmp_path):
    tools = MediaTools(Settings(_env_file=None))
    # A real executable stub with a filter inventory lacking libass.
    stub = tmp_path / "ffmpeg"
    stub.write_text(
        '#!/bin/sh\nprintf " ... zoompan V->V\\n ... eq V->V\\n '
        '... unsharp V->V\\n ... loudnorm A->A\\n ... aeval A->A\\n"\n'
    )
    stub.chmod(0o700)
    tools.settings.ffmpeg_path = str(stub)
    with pytest.raises(MediaError, match="libass"):
        tools.validate_render_tools(captions=True)
    tools.validate_render_tools(captions=False)


def test_command_error_retains_bounded_stderr_for_local_debug_only():
    tools = MediaTools(Settings(_env_file=None))
    with pytest.raises(MediaError) as raised:
        tools.run(
            [
                sys.executable,
                "-c",
                "import sys;sys.stderr.write('x'*20000+'\\nactual FFmpeg diagnostic');sys.exit(7)",
            ]
        )
    assert raised.value.code == "media_error"
    assert raised.value.stderr_tail.endswith("actual FFmpeg diagnostic")
    assert len(raised.value.stderr_tail) <= 16384
    assert "actual FFmpeg diagnostic" not in str(raised.value)
    from raw2reel_ai.observability import exception_fields

    fields = exception_fields(raised.value)
    assert fields["error_message"] == str(raised.value)
    assert "actual FFmpeg diagnostic" not in str(fields)


def test_cli_debug_prints_traceback_and_external_diagnostic(monkeypatch, capsys, tmp_path):
    import raw2reel_ai.cli as cli

    class Broken:
        def __init__(self, *_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def prepare(self, *_, **__):
            raise MediaError("FFmpeg failed.", stderr_tail="No such filter: 'ass'")

    monkeypatch.setattr(cli, "CloudPipeline", Broken)
    assert (
        cli.main(
            [
                "--env-file",
                str(tmp_path / "none.env"),
                "--debug",
                "prepare",
                "input.mp4",
                "--output",
                str(tmp_path / "analysis.json"),
            ]
        )
        == 1
    )
    err = capsys.readouterr().err
    assert "Traceback (most recent call last):" in err
    assert "MediaError: FFmpeg failed." in err
    assert "No such filter: 'ass'" in err


def test_render_checks_capabilities_before_cloud_or_analysis(tmp_path, monkeypatch):
    from raw2reel_ai.cloud_pipeline import CloudPipeline

    class NoCloud:
        def __getattr__(self, name):
            pytest.fail("Cloud must not be called when FFmpeg is unsupported")

    class Meta:
        def close(self):
            pass

    pipeline = CloudPipeline(Settings(_env_file=None), meta=Meta(), cloud=NoCloud())
    monkeypatch.setattr(pipeline, "source", lambda _: (tmp_path / "video.mp4", {}))

    def unsupported(**_):
        raise MediaError("Missing libass")

    monkeypatch.setattr(pipeline.tools, "validate_render_tools", unsupported)
    with pytest.raises(MediaError, match="libass"):
        pipeline.render(
            tmp_path / "video.mp4", tmp_path / "out.mp4", analysis={}, person_ids=["p1"]
        )
