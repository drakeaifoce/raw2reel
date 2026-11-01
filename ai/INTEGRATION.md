# Интеграция AI-сервиса

Рабочий HTTP API состоит из двух операций:

- `POST /v2/prepare`: файл video → JSON с catalog, thumbnails и calls.
- `POST /v2/render`: video, сохранённый JSON в analysis, person_ids,
  необязательная music и параметры → MP4.

Обе операции требуют `Authorization: Bearer <AI_SERVICE_TOKEN>`.
Подробный контракт и команды CLI: [CLOUD_PIPELINE.md](CLOUD_PIPELINE.md).

## Состояние подключения

Старый `POST /v1/render` удалён из FastAPI и возвращает 404.
Существующий `backend/src/ai-client.ts` и worker ещё используют этот адрес;
для работы генерации через приложение им требуется переход на v2.
Backend/frontend этой правкой не изменены.

Бэкенд должен сохранить полный JSON подготовки с привязкой к владельцу
и исходному media ID, отдать пользователю карточки персонажей, затем запустить
render с сохранённым analysis и выбранными person_ids. Долгие вызовы выполняются
через существующую очередь и worker. Проверка владения всеми медиа остаётся
на бэкенде; результат сохраняется через MediaRepository.

`GET /health`, `GET /ready`, `GET /version` остаются служебными маршрутами.
