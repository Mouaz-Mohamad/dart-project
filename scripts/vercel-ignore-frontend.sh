#!/usr/bin/env bash
set -euo pipefail

commit_message="$(git log -1 --pretty=%B)"

if [[ "$commit_message" != *"[deploy]"* || ! "$commit_message" =~ \[batch:[0-9]+\] ]]; then
  echo "Skipping frontend build: commit is not an approved numbered deploy batch."
  exit 0
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

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
