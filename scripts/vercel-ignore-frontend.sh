#!/usr/bin/env bash
# DART CODE GUIDE | scripts/vercel-ignore-frontend.sh
# الغرض: سكريبت Shell مساعد للتشغيل أو النشر.
set -euo pipefail

commit_message="$(git log -1 --pretty=%B)"

if [[ "$commit_message" != *"[deploy]"* || ! "$commit_message" =~ \[batch:[0-9]+\] ]]; then
  echo "Skipping frontend build: commit is not an approved numbered deploy batch."
  exit 0
fi

head_sha="$(git rev-parse HEAD)"
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

# Vercel can occasionally expose the current commit as the previous SHA, or a
# commit that is unavailable in a shallow checkout. In either case, compare
# against the local parent instead of incorrectly treating the batch as empty.
if [[ -z "$base" || "$base" == "$head_sha" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  base="HEAD^"
fi

if git diff --quiet "$base" HEAD -- . \
  ':(exclude)backend/**' \
  ':(exclude)docs/**' \
  ':(exclude).github/**' \
  ':(exclude)AGENTS.md'; then
  echo "Skipping frontend build: no frontend/runtime changes in this batch."
  exit 0
fi

echo "Approved frontend changes detected; continuing Vercel build."
exit 1
