# Transactional outbox operations

Dart uses PostgreSQL `outbox_events` as the durable source of truth for automation delivery. API writes create events transactionally; delivery to the automation webhook is signed and retried without moving business state into n8n.

## Normal delivery

Business flows should attempt immediate dispatch after the transaction commits. A failed webhook call leaves the event in the outbox with a future `available_at` and exponential backoff.

## Retry endpoint

Use:

`POST /api/v1/internal/outbox/process`

with:

`Authorization: Bearer <CRON_SECRET>`

The secret must be at least 32 characters and must never be exposed in storefront or dashboard JavaScript. `OUTBOX_CRON_SECRET` remains accepted for non-Vercel schedulers, while `CRON_SECRET` matches Vercel's automatic Cron authorization header.

## Scheduling

Vercel Hobby allows Cron Jobs at most once per day, so `backend/vercel.json` keeps a daily safety run at 03:17 UTC. For near-real-time retry behavior, configure n8n to call the protected endpoint every 5 minutes. The database claim uses row locking and event status, so overlapping workers do not publish the same claimed row concurrently.

## Failure handling

- A failed webhook is kept for retry.
- Attempts are capped by the outbox service.
- Stuck `processing` rows become reclaimable after the lock timeout.
- The webhook receives `X-Dart-Event-Id`, `X-Dart-Event-Type`, and an HMAC signature.
