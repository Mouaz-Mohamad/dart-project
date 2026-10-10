# Scoped Order Refresh And Load Checks

Reviewed: 2026-10-10. This is a seven-change, backward-compatible batch. No database migrations, production data repairs, subscription upgrades, or business-rule changes are included.

## Seven Completed Changes

| Change | Main files | End-to-end check |
| --- | --- | --- |
| 1. Scoped server snapshot | `backend/src/modules/commerce/commerce.service.ts` | Change a test order; inspect its server-calculated status, amounts, inventory and affected-customer orders. |
| 2. Optional compact command replies | `backend/src/modules/commerce/commerce.routes.ts`, `backend/openapi.yaml`, `docs/API_CONTRACT.md` | Compare commands with and without `responseMode=delta`; legacy callers still receive a full snapshot. |
| 3. Version-safe browser merge | `Eye/dart-orders-api.js` | Change two orders concurrently; reverse response arrival; neither confirmed change nor an unrelated row/selection is lost. |
| 4. Coalesced related reads and recovery | `Eye/dart-orders-api.js`, `Eye/dart.js` | Fail a secondary GET after a successful command; one warning appears and only reads retry, never the POST. |
| 5. Catalog version-first refresh | `Js/dart-catalog.js` | An unchanged version causes no catalog-state GET; changed inventory refreshes without saving unrelated local edits. |
| 6. Domain version-first refresh | `Eye/dart-domain-state.js` | Only changed permitted domains are fetched; local edits and newer snapshots survive late responses and logout. |
| 7. Bounded measurement and regression coverage | `scripts/load-store.mjs`, `backend/scripts/benchmark-order-refresh.ts`, `backend/tests/*`, `tests/full-site-browser.js`, `tests/performance-budget.cjs`, `AGENTS.md` | Run the local-only synthetic benchmark, safety tests, backend checks and existing frontend CI inventory. |

## API Compatibility

The existing single-command routes accept optional `?responseMode=delta&baseVersion=<confirmed version>`:

- `POST /api/v1/admin/orders`
- `PATCH /api/v1/admin/orders/{orderRef}`
- `POST /api/v1/admin/orders/{orderRef}/workflow`
- `POST /api/v1/admin/orders/{orderRef}/cod-verification`
- `POST /api/v1/admin/orders/{orderRef}/state`

No new business endpoint is added. Default and bulk responses remain full snapshots. Authentication, central permissions, MFA, CSRF, integer minor-unit accounting, row locks and audit transactions remain intact.

A delta includes the changed order and all orders for affected customers, including the old customer when an order is reassigned. This preserves shared COD-risk and refusal-history fields. A customer with many orders can still produce a large response: correctness takes priority over a fixed row cap.

The command transaction releases its connection before the response read. A delta's rows and version are read in the same repeatable-read snapshot. An intervening writer, version gap, failed response read or invalid browser delta triggers full read recovery. A committed command stays successful and is not automatically repeated. Failed transport remains uncertain and is reconciled by reading, not by resending the mutation.

## Local Measurements

One isolated PostgreSQL run used 1,000 synthetic orders, a pool of 10 connections and 10 full/delta command pairs. The comparison includes command execution plus response construction; it excludes network transfer and actual customer notification delivery.

| Response | Mean time | Mean JSON bytes | Returned orders |
| --- | ---: | ---: | ---: |
| Legacy full snapshot | 44.70 ms | 1,206,260 | 1,000 |
| Version-guarded delta | 8.91 ms | 1,584 | 1 |

The compact reply was approximately 99.87% smaller in this fixture. Timing is indicative, not a production guarantee.

| Simulated concurrent workers | Requests | Errors | Mixed admin-read p95 |
| --- | ---: | ---: | ---: |
| 10 | 250 | 0 | 61.66 ms |
| 25 | 250 | 0 | 99.09 ms |
| 50 | 250 | 0 | 288.74 ms |

These stages stop at three seconds or 250 requests, whichever comes first. They use real Express routes, permissions, services and PostgreSQL, but a synthetic authenticated identity. Peak pool waiters reached 17. This is a short local smoke test, **not proof that production supports 50 active shoppers**, and not a sustained-load or write-contention benchmark. Real authentication cost, cold starts, Neon/Vercel limits, network latency, checkout contention and external services require separate staging measurements.

## Reproduce Safely

From `backend/`, against an already running local API:

```sh
npm run test:load -- --base http://127.0.0.1:4000 --users 10 --duration 10
```

For synthetic order comparisons, set `TEST_DATABASE_URL` to a dedicated local test database, then run:

```sh
npm run bench:orders
```

The benchmark refuses non-local database hosts and database names without `test`. It creates a uniquely named schema, uses synthetic records, runs the comparison and removes the schema in `finally`. It never falls back to `DATABASE_URL`. `BENCH_ORDER_COUNT` is bounded to 100-5,000.

The standalone runner sends fixed GET-only API paths and follows no redirects. Its limits are 50 workers, 120 seconds and 2,000 total requests. Remote HTTPS requires explicit `--allow-remote`, with at least one second between each worker's reads. It stops issuing requests on HTTP 429 or more than 5% errors after 20 samples; requests already in flight may finish. Its provisional pass criteria are at most 1% errors and p95 below two seconds. Reports contain aggregate statuses/timings/bytes, never bodies, cookies or personal records.

The optional `--profile admin` uses `DART_LOAD_COOKIE` from a test staff session, supplied through the environment, never a CLI argument or committed file. Prefer local/staging runs. No pressure test or synthetic write was run against production for this batch.

## Verification

- `cd backend && npm run check`: lint, TypeScript, deployment-config check and 365 tests passed with a local `TEST_DATABASE_URL`; all integration cases ran.
- `cd backend && npm run build`: passed. The benchmark script separately passed ESLint and strict TypeScript with the project's Express type augmentation.
- All 29 static frontend CI checks and all eight Chromium browser CI tests passed. JavaScript syntax checks passed.
- OpenAPI YAML parsed and all 169 local references resolved. `git diff --check` passed.
- New paths cover contiguous/no-op/legacy responses, stale-base recovery, a writer between commit and response read, same-customer COD history, manual create/edit/customer reassignment/COD/archive/restore/delete, full and compact replies with a one-connection pool, out-of-order browser responses, malformed delta recovery, related-read failures, dirty edits, overlapping version checks, logout and late private reads.
- HTTP command tests retain forbidden-field, permission, MFA and CSRF checks and reject invalid compact-response versions before mutation.
- The aggregate browser-source ceiling changed from 904 to 912 KiB to account for approximately 7 KiB of version/session/recovery guards. This is a repository-source ceiling, not page download size. The 225 KiB homepage-direct, 260 KiB per-file and 431 KiB lazy-source limits remain unchanged; all pass. The measured homepage direct JavaScript is 229,155 bytes.

## Quality Review

| Section | Result | Evidence / scope |
| --- | --- | --- |
| 1. States | Pass | Empty/full snapshots remain supported; existing busy states retained; secondary refresh failure has one visible warning and read recovery. |
| 2. Server authority | Pass | No price, discount, stock, COD or status rule moved to the browser; existing authority tests and real database assertions pass. |
| 3. Concurrency | Pass | Repeatable-read scoped snapshots, contiguous versions, full recovery, per-order busy guards, local-edit revisions and session invalidation are tested. |
| 4. Validation / authorization | Pass | Optional query is range-validated; existing central permission, MFA and CSRF boundaries retained and tested. |
| 5. Idempotency | Pass for this scope | No new write flow or automatic write retry; same-status workflow no-op remains safe. Generic create retries are not claimed to be idempotent. |
| 6. Audit | Pass | Existing sensitive commands still commit their audit in the transaction; audit refresh remains included. |
| 7. Cost / external services | Pass / N/A | No new paid API sends or WhatsApp changes; local-only fixture and bounded read runner avoid uncontrolled production pressure. One build per affected project is the release policy. |
| 8. Regression | Pass | Legacy/default and bulk contracts preserved; storefront, dashboard, settings, finance, Sets and News regression suites pass. |
| 9. Tests | Pass | Critical scenarios above run automatically in existing backend/frontend checks; no production business-data mutation was needed for validation. |
| 10. Secrets | Pass | No new credentials or tokens; fixture identities are synthetic and load cookies are environment-only and excluded from reports. |

## Capacity Decision

Keep current subscriptions for this change. Next, run a longer staging test with realistic browsing/checkout mix and test-only notifications; compare API p95, errors, database query times, pool waiting, CPU and provider limits. Optimize the measured bottleneck before upgrading. This batch reduces per-command snapshot work; it does not provide a new overall store-readiness percentage.
