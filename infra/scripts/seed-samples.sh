#!/usr/bin/env bash
# Засев сэмплов: файлы становятся медиа служебного владельца `samples`, и
# любой пользователь может взять их себе через POST /api/samples/{id}.
#
#   ./infra/scripts/seed-samples.sh track1.mp3 track2.mp3
#
# Запускается с машины, где есть ssh к хосту. Повторный запуск добавляет
# новые записи, а не заменяет старые — удалять лишнее придётся вручную.
set -euo pipefail

HOST="${HOST:-nik@20.240.128.170}"
CONTAINER="${CONTAINER:-raw2reel-apps-backend-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ $# -gt 0 ]] || { echo "нужен хотя бы один файл" >&2; exit 1; }

remote=()
for path in "$@"; do
  [[ -f "$path" ]] || { echo "нет файла: $path" >&2; exit 1; }
  name="$(basename "$path")"
  scp -q "$path" "$HOST:/tmp/$name"
  # shellcheck disable=SC2029
  ssh "$HOST" "docker cp '/tmp/$name' '$CONTAINER:/app/$name' >/dev/null && rm -f '/tmp/$name'"
  remote+=("/app/$name")
done

scp -q "$HERE/seed-samples.ts" "$HOST:/tmp/seed-samples.ts"
# shellcheck disable=SC2029
ssh "$HOST" "docker cp /tmp/seed-samples.ts '$CONTAINER:/app/seed-samples.ts' >/dev/null \
  && docker exec '$CONTAINER' bun /app/seed-samples.ts ${remote[*]}"
