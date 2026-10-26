#!/usr/bin/env bash
# DART CODE GUIDE | backend/scripts/vercel-ignore-backend.sh
# الغرض: أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح.
set -euo pipefail

head_sha="$(git rev-parse HEAD)"
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

# Initial builds, explicit redeploys and unavailable history must build safely.
if [[ -z "$base" || "$base" == "$head_sha" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Building API: initial/repeated deployment or unavailable comparison history."
  exit 1
fi

if git diff --quiet "$base" HEAD -- . \
  ':(exclude)tests/**' \
  ':(exclude)scripts/vercel-ignore-backend.sh'; then
  echo "Skipping API build: no backend runtime changes."
  exit 0
fi

echo "Backend changes detected; continuing Vercel build."
exit 1
