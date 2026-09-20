# GitHub + Vercel deployment batching

Dart uses a seven-change production batch to prevent one small edit from creating another GitHub commit and another pair of Vercel builds.

## Normal flow

1. Complete seven logical changes locally/in the working environment without moving the remote `main` ref.
2. Run the relevant frontend checks and `cd backend && npm run check` when backend code changed.
3. Publish the seven changes in one atomic commit.
4. The commit message must contain `[batch:7]` and `[deploy]`.
5. Push/update `main` once.
6. Vercel's Ignored Build Step evaluates the batch. The storefront builds only when storefront/runtime files changed. The API builds only when backend files changed.
7. Verify the resulting production aliases before calling the batch live.

## Why this exists

The previous workflow produced many tiny commits and therefore many automatic Vercel build attempts. The live storefront fell behind `main` after the account hit a build-rate limit. Batching reduces build pressure and keeps GitHub history easier to review.

## Safety rules

- Do not rewrite or force-squash old `main` history just to make it look cleaner.
- Do not create routine remote staging commits that can trigger Preview deployments.
- A commit without both required markers is intentionally skipped by Vercel.
- Documentation-only and policy-only changes do not rebuild the storefront or API.
- If a batch changes both frontend and backend, each affected Vercel project builds at most once for that batch.


## Backend cron guard

The API project is currently constrained by Vercel Hobby cron scheduling. Its built-in Vercel Cron is a once-daily safety net, and `backend/scripts/check-vercel-config.mjs` rejects a more frequent schedule before a batch is considered healthy. Faster transactional retries can be driven by n8n through the protected outbox processor without creating additional Vercel deployments.
