from raw2reel_ai.health import readiness


def test_без_настроенных_зависимостей_сервис_готов() -> None:
    result = readiness()
    assert result["ready"] is True
    assert sorted(result["dependencies"]) == ["blob", "mongo"]


def test_каждая_зависимость_сообщает_состояние() -> None:
    for dependency in readiness()["dependencies"].values():
        assert dependency["state"] in {"ok", "unconfigured", "error"}
