"""Cloud preparation and reel generation HTTP service."""

import hmac
import threading
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .cloud_api import install_cloud_routes
from .cloud_pipeline import CloudPipeline
from .config import Settings, get_settings
from .health import readiness


def create_app(
    service_settings: Settings | None = None,
    *,
    cloud_pipeline_factory=CloudPipeline,
):
    settings = service_settings or get_settings()
    app = FastAPI(title="raw2reel-ai", version="0.0.0")
    render_lock = threading.Lock()
    bearer = HTTPBearer(
        scheme_name="AIServiceToken",
        description="AI_SERVICE_TOKEN from the AI service environment (not MODEL_API_KEY).",
        auto_error=False,
    )

    def authenticate(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        token = settings.ai_service_token
        if not token or not token.get_secret_value():
            raise HTTPException(503, "Set AI_SERVICE_TOKEN on the AI service.")
        supplied = credentials.credentials if credentials else ""
        if not hmac.compare_digest(supplied.encode(), token.get_secret_value().encode()):
            raise HTTPException(401, "Invalid AI service token.")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/version")
    def version():
        return {"service": "ai", "version": settings.git_sha}

    @app.get("/ready")
    def ready(response: Response):
        result = readiness(settings)
        if not result["ready"]:
            response.status_code = 503
        return result

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse(
            {"error": {"code": f"http_{error.status_code}", "message": error.detail}},
            status_code=error.status_code,
            headers=error.headers,
        )

    install_cloud_routes(app, settings, authenticate, render_lock, cloud_pipeline_factory)
    return app


app = create_app()
