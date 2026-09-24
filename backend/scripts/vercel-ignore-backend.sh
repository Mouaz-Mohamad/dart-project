#!/usr/bin/env bash
# DART CODE GUIDE | backend/scripts/vercel-ignore-backend.sh
# الغرض: أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح.
set -euo pipefail

commit_message="$(git log -1 --pretty=%B)"

if [[ "$commit_message" != *"[deploy]"* || ! "$commit_message" =~ \[batch:[0-9]+\] ]]; then
  echo "Skipping API build: commit is not an approved numbered deploy batch."
  exit 0
fi

head_sha="$(git rev-parse HEAD)"
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

# Avoid silently skipping a valid backend batch when Vercel reports HEAD as
# the previous SHA or when its previous commit is absent from a shallow clone.
if [[ -z "$base" || "$base" == "$head_sha" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base="HEAD^"
fi

if git diff --quiet "$base" HEAD -- .; then
  echo "Skipping API build: no backend changes in this batch."
  exit 0
fi

echo "Approved backend changes detected; continuing Vercel build."
exit 1
