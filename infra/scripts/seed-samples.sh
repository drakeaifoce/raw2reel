#!/usr/bin/env bash
# Засев сэмплов: файлы становятся медиа служебного владельца `samples`, и
# любой пользователь может взять их себе через POST /api/samples/{id}.
#
#   ./infra/scripts/seed-samples.sh track1.mp3 "Artist - Title.mp3"
#
# Запускается с машины, где есть ssh к хосту. Повторный запуск добавляет
# новые записи, а не заменяет старые — удалять лишнее придётся вручную.
#
# Файлы кладутся в контейнер под простыми именами, а настоящие имена едут
# отдельным JSON-ом: в названиях треков бывают пробелы, запятые и скобки, и
# передача их через argv по дороге к docker exec разваливается.
set -euo pipefail

HOST="${HOST:-nik@20.240.128.170}"
CONTAINER="${CONTAINER:-raw2reel-apps-backend-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ $# -gt 0 ]] || { echo "нужен хотя бы один файл" >&2; exit 1; }

list=$(mktemp)
trap 'rm -f "$list"' EXIT
: > "$list"

index=0
for path in "$@"; do
  [[ -f "$path" ]] || { echo "нет файла: $path" >&2; exit 1; }
  remote="seed-$index.bin"
  scp -q "$path" "$HOST:/tmp/$remote"
  ssh "$HOST" "docker cp /tmp/$remote $CONTAINER:/app/$remote >/dev/null && rm -f /tmp/$remote"
  # Имя файла в JSON кладёт python: он же и экранирует кавычки с юникодом.
  python3 -c '
import json, sys
print(json.dumps({"path": "/app/" + sys.argv[1], "name": sys.argv[2]}, ensure_ascii=False))
' "$remote" "$(basename "$path")" >> "$list"
  index=$((index + 1))
done

python3 -c '
import json, sys
print(json.dumps([json.loads(line) for line in sys.stdin if line.strip()], ensure_ascii=False))
' < "$list" > "$list.json"

scp -q "$HERE/seed-samples.ts" "$HOST:/tmp/seed-samples.ts"
ssh "$HOST" "docker cp /tmp/seed-samples.ts $CONTAINER:/app/seed-samples.ts >/dev/null"
ssh "$HOST" "docker exec -i $CONTAINER bun /app/seed-samples.ts" < "$list.json"
rm -f "$list.json"
