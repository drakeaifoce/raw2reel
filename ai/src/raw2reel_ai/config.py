"""Конфигурация сервиса. Все переменные описаны в корневом .env.example."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    port: int = 8000

    mongo_url: str | None = None
    mongo_db: str = "raw2reel"

    azure_storage_connection_string: str | None = None
    azure_blob_container_uploads: str = "uploads"
    azure_blob_container_renders: str = "renders"

    # Внешние Muse-пайплайны. Сервис только выстраивает порядок вызовов,
    # локальных моделей не держит — на этой машине нет GPU.
    muse_spark_url: str | None = None
    muse_vision_url: str | None = None
    muse_voice_url: str | None = None

    # Предел на входящее изображение: защита от попытки распаковать «бомбу»
    # в 4 GB RAM, которые делят между собой все сервисы хоста.
    max_image_pixels: int = 50_000_000


settings = Settings()
