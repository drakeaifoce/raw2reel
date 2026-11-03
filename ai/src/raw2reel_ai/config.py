"""Общие настройки сервиса и изолированного CLI (см. ai/.env.example)."""

from functools import cache
from pathlib import Path
from shutil import which
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_TOOLS_DIR = Path(__file__).resolve().parents[2] / ".tools"


def tool_path(name: str) -> str:
    installed = which(name)
    if installed:
        return installed
    local = LOCAL_TOOLS_DIR / name
    return str(local) if local.is_file() else name


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore", env_file=".env")

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["json", "console"] = "json"
    ai_service_token: SecretStr | None = None
    sam_model: str = "sam-3.1"
    cloud_discovery_frames: int = Field(default=48, ge=1, le=96)
    cloud_max_observations: int = Field(default=128, ge=1, le=256)
    cloud_review_seconds: float = Field(default=90, gt=0, le=180)
    cloud_track_seconds: float = Field(default=120, gt=0, le=300)
    cloud_clip_seconds: float = Field(default=8, ge=2, le=12)
    cloud_analysis_fps: int = Field(default=5, ge=2, le=10)
    cloud_face_min_size_enabled: bool = True
    cloud_face_min_size_px: int = Field(default=32, ge=1, le=640)
    cloud_face_dedup_enabled: bool = True
    cloud_face_dedup_iou: float = Field(default=0.7, gt=0, le=1)

    # Подставляется при сборке образа через --build-arg GIT_SHA, поэтому не может
    # разойтись с тем, что развёрнуто. Локальный запуск отдаёт dev.
    git_sha: str = "dev"

    # Общий серверный ключ Meta Model API. SecretStr скрывает его в repr и JSON.
    model_api_key: SecretStr | None = None
    model_api_base_url: str = "https://api.meta.ai/v1"
    muse_spark_model: str = "muse-spark-1.3"
    muse_voice_model: str = "muse-voice-transcribe-1.0"
    model_timeout_seconds: float = 120
    model_max_retries: int = 2

    ffmpeg_path: str = Field(default_factory=lambda: tool_path("ffmpeg"))
    ffprobe_path: str = Field(default_factory=lambda: tool_path("ffprobe"))
    media_timeout_seconds: float = 600
    max_upload_bytes: int = 150 * 1024 * 1024
    max_music_bytes: int = 32 * 1024 * 1024
    max_source_seconds: float = 1200


@cache
def get_settings() -> Settings:
    return Settings()
