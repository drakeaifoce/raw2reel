from fastapi import FastAPI, Response

from .config import settings
from .health import readiness

app = FastAPI(title="raw2reel-ai", version="0.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Только живость процесса: используется healthcheck'ом контейнера."""
    return {"status": "ok"}


@app.get("/version")
def version() -> dict[str, str]:
    """Версия развёрнутого образа. По её смене видно, что деплой доехал."""
    return {"service": "ai", "version": settings.git_sha}


@app.get("/ready")
def ready(response: Response) -> dict[str, object]:
    """Состояние зависимостей: используется деплоем до переключения трафика."""
    result = readiness()
    if not result["ready"]:
        response.status_code = 503
    return result
