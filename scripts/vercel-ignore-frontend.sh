#!/usr/bin/env bash
# DART CODE GUIDE | scripts/vercel-ignore-frontend.sh
# الغرض: سكريبت Shell مساعد للتشغيل أو النشر.
set -euo pipefail

head_sha="$(git rev-parse HEAD)"
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

# Initial builds, explicit redeploys and unavailable history must build safely.
if [[ -z "$base" || "$base" == "$head_sha" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Building frontend: initial/repeated deployment or unavailable comparison history."
  exit 1
fi

if git diff --quiet "$base" HEAD -- . \
  ':(exclude)backend/**' \
  ':(exclude)tests/**' \
  ':(exclude)docs/**' \
  ':(exclude).github/**' \
  ':(exclude)scripts/vercel-ignore-frontend.sh' \
  ':(exclude)AGENTS.md'; then
  echo "Skipping frontend build: no frontend/runtime changes."
  exit 0
fi

echo "Frontend changes detected; continuing Vercel build."
exit 1
