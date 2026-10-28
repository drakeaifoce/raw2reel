# syntax=docker/dockerfile:1

# node:24, а не 20 — package.json требует engines.node >=22.12, .nvmrc пинит 24.
FROM node:24-bookworm-slim AS build
WORKDIR /app
# pnpm берётся из поля packageManager через corepack, чтобы версия совпадала с локальной
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Caddy, а не nginx: на хосте уже Caddy, незачем держать два веб-сервера
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY caddy/Caddyfile /etc/caddy/Caddyfile
# Проверка на этапе сборки: ошибка в Caddyfile иначе всплывёт только как
# крэш-луп контейнера во время деплоя, когда заглушка уже снята.
RUN caddy validate --config /etc/caddy/Caddyfile
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/health || exit 1
