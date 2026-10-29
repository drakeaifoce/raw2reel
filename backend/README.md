# backend

Bun HTTP API: health/readiness, загрузка и выдача медиа через Azure Blob,
метаданные в MongoDB и минимальный сквозной пример работы с базой.

## Стек

Bun с TypeScript в strict-режиме. Драйвер `mongodb` для Cosmos DB через
Mongo-совместимый API, `@azure/storage-blob` для файлов. S3-совместимости у
Blob нет, поэтому нативный SDK, а не boto-подобные библиотеки.

## Запуск

```bash
cd backend
bun install
cp ../.env.example .env   # заполнить значения
bun run dev
```

## Скрипты

- `bun run dev` — с перезапуском по изменениям
- `bun run start` — как в контейнере
- `bun test` — тесты
- `bun run typecheck` — только проверка типов, без сборки
- `bun run format:check` — то же, что гоняет CI

## Эндпоинты

В production Caddy публикует backend под префиксом `/api` и удаляет этот
префикс перед проксированием. Поэтому публичные пути ниже начинаются с `/api`,
а при прямом обращении к backend на порту 3000 тот же путь используется без
`/api` (например, `/media` вместо `/api/media`).

`GET /health` отвечает всегда, пока жив процесс, — его опрашивает healthcheck
контейнера, поэтому он не зависит от внешних сервисов.

`GET /ready` проверяет Mongo и Blob и возвращает 503, если какая-то
зависимость в состоянии `error`. Ненастроенная зависимость неготовностью не
считается: пока Cosmos не создан, деплой не должен из-за этого откатываться.

### Медиа

`POST /api/media` принимает `multipart/form-data` с полем `file`. Допустимые
MIME-типы задаёт `MEDIA_ALLOWED_TYPES` (по умолчанию
`video/*,image/*,audio/*`), максимальный размер — `MAX_MEDIA_SIZE_BYTES`
(по умолчанию 100 MiB). Успешный ответ `201`:

```json
{
  "id": "0d587a6f-315f-4c28-968a-9e9ab43f156f",
  "name": "clip.mp4",
  "type": "video/mp4",
  "size": 12345,
  "blobKey": "0d587a6f-315f-4c28-968a-9e9ab43f156f/clip.mp4",
  "createdAt": "2026-10-29T12:00:00.000Z"
}
```

`GET /api/media?limit=20` возвращает `{ "items": [...] }`; `limit` должен быть
целым числом от 1 до 100. `GET /api/media/:id` потоково отдаёт содержимое Blob
с сохранёнными `Content-Type`, `Content-Length` и именем файла. Ответ также
содержит `X-Content-Type-Options: nosniff` и sandbox CSP, чтобы загруженный
контент не мог выполнить скрипт в origin приложения.

Ошибки клиента возвращаются как `{ "error": "...", "code": "..." }` с
соответствующим статусом 400, 404, 413 или 415. Если MongoDB или Blob не
настроены, API отвечает 503 с кодом `DEPENDENCY_UNAVAILABLE`.

### Пример MongoDB

`GET /api/db/hello` делает upsert документа в коллекцию `examples`, читает его
обратно и отвечает `{ "message": "hello from MongoDB" }`.

## Ручная проверка

```bash
# Через публичный Caddy (замените localhost на адрес развёрнутого приложения):
curl -sS -F 'file=@./clip.mp4;type=video/mp4' http://localhost/api/media
curl -sS 'http://localhost/api/media?limit=10'
curl -OJ http://localhost/api/media/<id>
curl -sS http://localhost/api/db/hello

# Напрямую к backend, минуя Caddy:
curl -sS -F 'file=@./clip.mp4;type=video/mp4' http://localhost:3000/media
curl -sS 'http://localhost:3000/media?limit=10'
curl -OJ http://localhost:3000/media/<id>
curl -sS http://localhost:3000/db/hello
```
