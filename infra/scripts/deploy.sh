#!/usr/bin/env bash
# Переключает приложения на новые теги образов, проверяет готовность и при
# неуспехе возвращает прежнее состояние. Образы к моменту вызова уже должны быть
# собраны и помечены — этим занимается workflow, здесь только переключение.
#
# Использование: deploy.sh <sha> [frontend] [backend] [ai]
#   имена проектов в аргументах = те, для которых собран новый образ;
#   остальные остаются на текущих тегах.
#
# Порядок намеренный: маршруты Caddy переключаются последними, когда контейнеры
# уже прошли проверку. Пока они поднимаются, трафик продолжает обслуживать
# предыдущая конфигурация, поэтому простоя нет даже при неудачном деплое.
set -euo pipefail

SHA="${1:?первым аргументом нужен sha коммита}"
shift
REBUILT=("$@")

ROOT="/opt/raw2reel"
APPS_DIR="$ROOT/apps"
STATE="$APPS_DIR/.env"
PREV="$APPS_DIR/.env.prev"
# Каталог только для маршрутов приложений. Блок апекса и маршрут Gitea
# живут в conf.d и деплою не принадлежат.
CONF_D="$ROOT/infra/apps.d"
CONF_BACKUP="$APPS_DIR/apps.d.prev"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=("docker" "compose" "-f" "$REPO/infra/compose/docker-compose.apps.yml" "--env-file" "$STATE")

log() { printf '\n--> %s\n' "$*"; }

mkdir -p "$APPS_DIR" "$CONF_D"
touch "$STATE"

was_rebuilt() {
  local name="$1"
  for item in "${REBUILT[@]:-}"; do [[ "$item" == "$name" ]] && return 0; done
  return 1
}

tag_of() { grep -E "^$1=" "$STATE" 2>/dev/null | cut -d= -f2- || true; }

# Было ли вообще предыдущее развёртывание. От этого зависит, куда откатываться:
# на прежние теги или в состояние «приложений нет, сайт на заглушке».
HAD_PREVIOUS=true
for project in frontend backend ai; do
  [[ -n "$(tag_of "$(tr '[:lower:]' '[:upper:]' <<<"$project")_TAG")" ]] || HAD_PREVIOUS=false
done

# ---------------------------------------------------------------- точки откатa
cp "$STATE" "$PREV"
rm -rf "$CONF_BACKUP"
cp -a "$CONF_D" "$CONF_BACKUP"

restore_routes() {
  # Только содержимое: сам каталог смонтирован в контейнер Caddy, и rm -rf на нём
  # оставляет контейнер с устаревшим mount — он видит пустоту, и сайт отваливается
  # уже на TLS, потому что подходящего блока в конфиге нет.
  find "$CONF_D" -mindepth 1 -delete
  cp -a "$CONF_BACKUP"/. "$CONF_D"/
  docker exec raw2reel-caddy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
}

rollback() {
  if [[ "$HAD_PREVIOUS" == true ]]; then
    log "ОТКАТ на предыдущие теги"
    mv "$PREV" "$STATE"
    sort "$STATE" | sed 's/^/    /'
    "${COMPOSE[@]}" up -d --remove-orphans || true
  else
    log "ОТКАТ: предыдущего развёртывания не было, снимаю приложения"
    # Теги ещё в $STATE — без них compose не сможет разобрать файл и остановить проект
    "${COMPOSE[@]}" down --remove-orphans || true
    : > "$STATE"
    rm -f "$PREV"
  fi
  restore_routes
  exit 1
}

# ---------------------------------------------------------------- теги
for project in frontend backend ai; do
  var="$(tr '[:lower:]' '[:upper:]' <<<"$project")_TAG"
  if was_rebuilt "$project"; then
    new="$SHA"
  else
    new="$(tag_of "$var")"
    if [[ -z "$new" ]]; then
      if docker image inspect "raw2reel/$project:$SHA" >/dev/null 2>&1; then
        new="$SHA"
      else
        echo "нет ни текущего тега, ни образа raw2reel/$project:$SHA" >&2
        exit 1
      fi
    fi
  fi
  grep -vE "^$var=" "$STATE" > "$STATE.tmp" 2>/dev/null || true
  echo "$var=$new" >> "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
done

log "теги"
sort "$STATE" | sed 's/^/    /'

# ---------------------------------------------------------------- подъём
log "подъём"
"${COMPOSE[@]}" up -d --remove-orphans

# ---------------------------------------------------------------- проверка
wait_healthy() {
  local service="$1" deadline=$((SECONDS + 120)) cid status
  cid="$("${COMPOSE[@]}" ps -q "$service")"
  [[ -n "$cid" ]] || { echo "    $service: контейнер не создан" >&2; return 1; }
  while ((SECONDS < deadline)); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
    case "$status" in
      healthy) echo "    $service: healthy"; return 0 ;;
      unhealthy)
        echo "    $service: unhealthy, последние строки лога:" >&2
        docker logs --tail 15 "$cid" 2>&1 | sed 's/^/        /' >&2
        return 1 ;;
      none) echo "    $service: без healthcheck, считаю запущенным"; return 0 ;;
    esac
    sleep 3
  done
  echo "    $service: не стал healthy за 120 с" >&2
  docker logs --tail 15 "$cid" 2>&1 | sed 's/^/        /' >&2
  return 1
}

# Отдельно спрашиваем /ready: healthcheck говорит лишь о живости процесса,
# а готовность зависимостей — другой вопрос.
# Запрос идёт из контейнера Caddy, а не из самого сервиса: в образах приложений
# набор утилит разный (в python:slim, например, нет wget), а Caddy на той же
# сети и его busybox есть всегда.
check_ready() {
  local service="$1" port="$2" body
  if body="$(docker exec raw2reel-caddy-1 wget -qO- --timeout=10 "http://$service:$port/ready" 2>/dev/null)"; then
    echo "    $service: /ready -> $body"
  else
    echo "    $service: /ready не отвечает" >&2
    return 1
  fi
}

log "проверка"
for service in frontend backend ai; do
  wait_healthy "$service" || rollback
done
check_ready backend 3000 || rollback
check_ready ai 8000 || rollback

# ------------------------------------------------- переключение трафика
# Только теперь: контейнеры проверены, можно уводить на них маршруты.
log "маршруты"
install -m 0644 "$REPO/infra/caddy/apps.caddy" "$CONF_D/10-apps.caddy"
rm -f "$CONF_D/00-placeholder.caddy"
if ! docker exec raw2reel-caddy-1 caddy reload --config /etc/caddy/Caddyfile; then
  echo "caddy отверг конфиг, остаётся на прежнем" >&2
  rollback
fi
echo "    переключено на приложения"

# ---------------------------------------------------------------- уборка
# На 30-гигабайтном диске без temp-диска кэш сборки съедает место быстро.
log "уборка"
docker image prune -f --filter 'until=168h' >/dev/null || true
docker builder prune -f --keep-storage 3GB >/dev/null || true
df -h / | tail -1 | sed 's/^/    /'

rm -f "$PREV"
rm -rf "$CONF_BACKUP"
log "развёрнуто $SHA"
