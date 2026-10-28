#!/usr/bin/env bash
# Определяет, какие проекты затронуты изменениями, и печатает в формате
# GITHUB_OUTPUT. Умышленно без сторонних actions: меньше зависимостей и
# не нужен прокси к github.com.
#
# Использование: changed.sh [base-ref]
#   без аргумента сравнивается с предыдущим состоянием ветки
set -euo pipefail

base="${1:-}"

if [[ -z "$base" ]]; then
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    # pull request: сравниваем с точкой ветвления от целевой ветки
    git fetch --quiet origin "$GITHUB_BASE_REF"
    base="$(git merge-base HEAD "origin/$GITHUB_BASE_REF")"
  elif [[ -n "${GITHUB_EVENT_BEFORE:-}" && ! "$GITHUB_EVENT_BEFORE" =~ ^0+$ ]]; then
    base="$GITHUB_EVENT_BEFORE"
  fi
fi

# Нет базы (первый пуш, новая ветка, пересозданная история) — считаем,
# что затронуто всё: ложно собрать лишнее дешевле, чем пропустить сборку.
if [[ -z "$base" ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "frontend=true"
  echo "backend=true"
  echo "ai=true"
  echo "reason=no-base"
  exit 0
fi

files="$(git diff --name-only "$base" HEAD)"

changed() {
  local path="$1"
  if grep -qE "^$path/" <<<"$files"; then echo true; else echo false; fi
}

# Правка инфраструктуры или workflow затрагивает все три приложения:
# меняется способ сборки и развёртывания.
if grep -qE '^(infra/|\.gitea/)' <<<"$files"; then
  echo "frontend=true"
  echo "backend=true"
  echo "ai=true"
  echo "reason=infra"
  exit 0
fi

echo "frontend=$(changed frontend)"
echo "backend=$(changed backend)"
echo "ai=$(changed ai)"
echo "reason=diff"
