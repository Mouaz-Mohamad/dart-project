# GitHub + Vercel publishing

Publish the approved, tested task on `main` without a required number of changes, a batch number, or commit-message markers. Do not edit marker files to make a release deployable.

1. Finish the authorized task and run its relevant checks.
2. Publish one coherent commit and update `main` once.
3. Vercel evaluates changes since each project's previous deployment: storefront changes build the storefront, backend changes build the API, and mixed changes build both. Documentation-only changes can skip both.
4. Initial deployments, repeated deployments of the same commit and unavailable comparison history build conservatively.
5. Verify CI, deployment status and production aliases before calling the release live. Never force-push published history.

The project Ignored Build Step commands remain `bash scripts/vercel-ignore-frontend.sh` at the repository root and `bash scripts/vercel-ignore-backend.sh` inside `backend`. These scripts inspect changed paths only. They never require `[batch:7]`, `[deploy]`, or another commit-message marker.

## Backend cron guard

`backend/scripts/check-vercel-config.mjs` keeps Vercel cron schedules Hobby-compatible. Database migrations remain an explicit operational step and never run inside the Vercel build.
