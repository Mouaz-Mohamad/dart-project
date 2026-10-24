# Catalog scale foundation

This batch provides bounded APIs, smaller dashboard writes, conservative connection management and durable background processing. It does not certify production capacity for 1,000 simultaneous customers. Existing initial storefront/dashboard hydration still requests the full catalog.

## Seven logical changes

| Change | Main files | Result |
| --- | --- | --- |
| 1. Backup diagnostics | `backend/scripts/encrypted-database-backup.mjs` | Rejects missing/masked/pooled credentials and reports only the failed stage; a verified restore remains required. |
| 2. Paged reads | `catalog.routes.ts`, `catalog.service.ts`, OpenAPI | Optional public paging/filter/sort and independent admin model/item pages with full matching totals. |
| 3. Changed-record writes | `catalog.service.ts`, `src/dashboard/catalog-admin.js`, `Js/dart-catalog.js` | PATCH commits supplied rows, validates stored record versions and keeps omitted rows. The admin baseline is in memory. |
| 4. Lighter reads | `catalog.service.ts` | Public model metadata cache checks PostgreSQL version; fresh stock is read on every request. Cleanup checks for expired reservations first. |
| 5. Shared limits and pool lifecycle | `0060_scale_foundation.sql`, `shared-rate-limit.ts`, `pool.ts` | Optional PostgreSQL HMAC counters for sensitive routes and Vercel pool lifecycle integration. |
| 6. Durable background delivery | `outbox.dispatch.ts`, `outbox.routes.ts`, `.github/workflows/outbox-worker.yml` | Immediate bounded dispatch plus an hourly bounded recovery worker; failures remain visible. |
| 7. Isolated verification and cart lock repair | scale tests, benchmark, `commerce.service.ts`, Sets browser harness | Concurrent cart scans skip locked candidates and avoid a global stock sweep when no waiting entries are due. |

## API and state rules

- `GET /api/v1/catalog` keeps its full legacy response without paging parameters. With `page`/`limit`/`q`/`category`/`sort`, limit is at most 200, text filters are bounded, and `model_id` breaks sort ties. Stock is restricted to selected model IDs; total counts all matching models.
- `GET /api/v1/admin/catalog-state?page=1&limit=50&q=...` pages models/items independently. `pagination.totalModels` and `totalItems` count full matching datasets. Admin `category` and `sort` are rejected. Staff/MFA/permissions still apply; responses are `no-store`.
- `PATCH /api/v1/admin/catalog-state` requires positive `expectedVersion`, nonempty changed rows (at most 500 models/1,000 items) and `recordVersions.models/items`. Zero is only for an absent/new record. A changed existing record must match its stored version; stale changes return 409. Independent records can commit from an older global snapshot.
- A PATCH response contains selected changed rows, `baseVersion`, `committedVersion`, and observed `version`. Dashboard rehydrates on a global gap. Its single-flight dirty loop and session epoch prevent concurrent flushes and post-logout projection writes. Selection flags do not count as durable changes. Only 404/405 or explicit oversized bulk operations use legacy PUT; conflicts/network/500 never trigger full replacement.
- Acquisition costs and protected physical identity/state remain server-authoritative. Changing model variants validates all related units, including omitted units. Sensitive writes retain old/new audit values.
- Public metadata cache is process-local, at most 20 entries, 128 KiB each, 10 seconds, guarded by the database version. No stock, acquisition cost, customer data or purchase eligibility is cached there. Full responses above the size cap bypass it.
- Repeatable-read catalog snapshots retry once for 40001/40P01. Expired cleanup uses an existence check and a try-advisory lock. Some reads can release expired reservations; do not describe all reads as read-only.

## Limits, connections and release flags

Migration `0060_scale_foundation.sql` adds `api_rate_limits` with HMAC keys, atomic PostgreSQL-time UPSERT counters, expiry index and RLS. `RATE_LIMIT_STORE=memory` remains the default. After migration verification, `postgres` enables the scoped authentication/cart/waiting/upload stores; generic browsing/analytics limits remain process-local. Pruning removes at most 1,000 records expired over an hour.

`DART_APPLY_SCALE_FOUNDATION_MIGRATION=0060_scale_foundation` permits only this fixed additive migration at API startup. It uses a migration advisory lock and checksum; preceding migration 0059 must already be present. It is not a general migration runner. Clear the operator flag after verifying the release. Do not modify applied migration bytes.

The pool retains existing maximum size and strict TLS settings, adds a 5-second idle timeout/300-second maximum lifetime, and calls `attachDatabasePool` only in Vercel. Pool size is not a promise of aggregate database capacity across server instances.

## Delivery and operating cost

In Vercel, committed mutations register an immediate `waitUntil` dispatch of at most ten events; delivery failure does not roll back committed business work. Standalone dispatch awaits completion. Targeted staff email access challenges retain their awaited path.

The recovery workflow runs hourly at minute 7. It drains at most 12 batches of five within 90 seconds, with each HTTP call capped at 50 seconds or remaining time. It stops when empty and fails on provider/network failure. The authenticated internal POST accepts limits 1–10 (default 5); GET is unsupported. The hourly recovery choice bounds idle polling and retry volume; live provider cost still depends on actual traffic.

Existing durable claims, retry/backoff, deduplication and channel policy remain in force. SMTP delivery cannot guarantee exactly once if a provider accepts a message and the process dies before the database acknowledgement. No real messages are sent by the isolated tests/benchmark.

## Rollout and manual checks

1. In Neon, copy the direct connection for the actual API production database with pooled connection disabled. Save it as `DART_BACKUP_DATABASE_URL` in GitHub Actions secrets. Do not paste it into chat, docs or source.
2. Run **Encrypted database backup** and verify successful isolated recovery before accepting the backup gate. The archive alone is insufficient. Keep the recovery/encryption key separate and secure.
3. Verify the API database's migration ledger is current through 0059. Apply the reviewed additive 0060 via the fixed operator flag or the normal migration command. Verify checksum/table before enabling `RATE_LIMIT_STORE=postgres`.
4. Publish exactly the reviewed seven logical changes as one atomic `[batch:7] [deploy]` commit and one update of main. Inspect GitHub CI and both existing Vercel aliases. Do not create routine preview branches or duplicate builds.
5. Verify public page boundaries/search/sort/no cost or private physical IDs; verify admin global totals, one-row PATCH, stale same-row 409 and independent-row success. Verify missing CSRF/MFA/permissions fail before writes. Verify another item's version stays unchanged after a single-item edit.
6. Verify last-unit contention yields one reservation and checkout replay yields one order. Verify the worker's empty queue stops and a provider failure remains visible; use isolated fixtures for delivery checks.
7. Convert initial UI hydration to true server paging as a separate reviewed UI change, then measure the production-like path with real authentication, network/TLS/cold starts and agreed concurrent-user targets. Tune the bottleneck before claiming thousands of simultaneous customers.

## Isolated benchmark

Run `cd backend && TEST_DATABASE_URL=<local-test-database-url> npm run bench:scale`. The URL must be localhost and name a test database. The script creates/drops its own schema, seeds 1,000 models/10,000 items/10,000 synthetic customers, measures the one-row edit and HTTP read bursts at 25/100/250/1,000 users with a ten-connection pool, and checks 100 carts plus last-unit contention. An unmet 2-second diagnostic p95 target exits nonzero and remains in the JSON output. This is a diagnostic, not a production capacity test; synthetic identity bypasses login/MFA work and excludes real providers/TLS/CDN/browser rendering.

See `SCALE_QUALITY_2026-10-13_AR.md` for measured evidence and the current outstanding gates.
