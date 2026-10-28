from fastapi import FastAPI, Response

from .health import readiness

app = FastAPI(title="raw2reel-ai", version="0.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Только живость процесса: используется healthcheck'ом контейнера."""
    return {"status": "ok"}


@app.get("/ready")
def ready(response: Response) -> dict[str, object]:
    """Состояние зависимостей: используется деплоем до переключения трафика."""
    result = readiness()
    if not result["ready"]:
        response.status_code = 503
    return result
