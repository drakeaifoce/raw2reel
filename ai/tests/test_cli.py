import pytest

from raw2reel_ai import cli


def test_only_current_pipeline_commands_are_available(capsys):
    with pytest.raises(SystemExit) as help_exit:
        cli.main(["--help"])
    assert help_exit.value.code == 0
    assert "{prepare,render-v2}" in capsys.readouterr().out
    for old in ("analyze", "render"):
        with pytest.raises(SystemExit) as error:
            cli.main([old, "source.mp4", "--output", "result.mp4"])
        assert error.value.code == 2


def test_explicit_env_does_not_load_broken_default_env(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("MODEL_MAX_RETRIES=not-an-integer\n")
    explicit = tmp_path / "explicit.env"
    explicit.write_text("MODEL_MAX_RETRIES=1\n")

    class FakePipeline:
        def __init__(self, settings):
            assert settings.model_max_retries == 1

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def prepare(self, *_, **kwargs):
            return {"catalog": {"people": [], "warnings": []}, "calls": []}

    monkeypatch.setattr(cli, "CloudPipeline", FakePipeline)
    assert (
        cli.main(
            ["--env-file", str(explicit), "prepare", "source.mp4", "--output", "prepared.json"]
        )
        == 0
    )
