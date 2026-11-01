"""Общие настройки сервиса и изолированного CLI (см. ai/.env.example)."""

from functools import cache
from pathlib import Path
from shutil import which

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

    ai_service_token: SecretStr | None = None

    port: int = 8000

    # Подставляется при сборке образа через --build-arg GIT_SHA, поэтому не может
    # разойтись с тем, что развёрнуто. Локальный запуск отдаёт dev.
    git_sha: str = "dev"

    mongo_url: str | None = None
    mongo_db: str = "raw2reel"

    azure_storage_connection_string: str | None = None
    azure_blob_container_uploads: str = "uploads"
    azure_blob_container_renders: str = "renders"

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

    # Внешние Muse-пайплайны. Сервис только выстраивает порядок вызовов,
    # локальных моделей не держит — на этой машине нет GPU.
    muse_spark_url: str | None = None
    muse_vision_url: str | None = None
    muse_voice_url: str | None = None

    # Предел на входящее изображение: защита от попытки распаковать «бомбу»
    # в 4 GB RAM, которые делят между собой все сервисы хоста.
    max_image_pixels: int = 50_000_000


@cache
def get_settings() -> Settings:
    return Settings()


def __getattr__(name: str):
    # Preserve the service's shared settings import without reading .env on CLI import.
    if name == "settings":
        return get_settings()
    raise AttributeError(name)
