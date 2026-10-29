"""Проверка зависимостей. Ненастроенная зависимость не делает сервис неготовым."""

from __future__ import annotations

from typing import Literal, TypedDict

from azure.storage.blob import BlobServiceClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from .config import settings

State = Literal["ok", "unconfigured", "error"]


class Dependency(TypedDict, total=False):
    state: State
    detail: str


def _check_mongo() -> Dependency:
    if not settings.mongo_url:
        return {"state": "unconfigured"}
    try:
        client: MongoClient = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=3000)
        try:
            # Именно операция с базой, а не ping: в Cosmos ping отвечает через
            # шлюз и проходит даже с недействительным ключом, то есть молчит
            # ровно в том случае, для которого проверка и нужна. Проверено.
            client[settings.mongo_db].list_collection_names()
        finally:
            client.close()
    except PyMongoError as error:
        return {"state": "error", "detail": str(error)}
    return {"state": "ok"}


def _check_blob() -> Dependency:
    if not settings.azure_storage_connection_string:
        return {"state": "unconfigured"}
    try:
        service = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
        service.get_container_client(
            settings.azure_blob_container_uploads
        ).get_container_properties()
    # Ловим любое исключение намеренно: наружу отдаём текст, каким бы он ни был,
    # и /ready не должен падать из-за неожиданного типа ошибки в SDK.
    except Exception as error:
        return {"state": "error", "detail": str(error)}
    return {"state": "ok"}


def readiness() -> dict[str, object]:
    dependencies: dict[str, Dependency] = {"mongo": _check_mongo(), "blob": _check_blob()}
    ready = all(d.get("state") != "error" for d in dependencies.values())
    return {"ready": ready, "dependencies": dependencies}
