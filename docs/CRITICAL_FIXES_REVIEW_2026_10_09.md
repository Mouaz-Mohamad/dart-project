# Critical store fixes — 2026-10-09

The requested five priorities are addressed by seven logical implementation/review changes, prepared as one commit under the repository's production batching rule. The owner explicitly approved the push and production publication on 2026-10-09 after the initial automatic approval rejection. Vanilla JavaScript and PostgreSQL server authority remain in place. No migration is added; production already has all 59 migrations, including the Sets RLS migration.

| Change | Result and main files |
| --- | --- |
| 1. Retire snapshot replacement | `commerce.routes.ts` rejects legacy order-state PUT with 405; `commerce.service.ts` removes the whole-order replacement service; `dart-orders-api.js` legacy writes retain checkbox selection only. |
| 2. Enforce the common workflow | Single and bulk workflow routes require `expectedStatus`, reject extra fields and use the same transaction/transition/COD/inventory/reward validation. |
| 3. Make confirmed responses reliable | Consistent repeatable-read order snapshots; release transaction connections before snapshot reads; a committed command reports `refreshRequired` if the subsequent read fails. |
| 4. Protect concurrent dashboard actions | Row-specific pending guards, monotonic snapshot versions, 20-second transport timeout and read reconciliation without automatic mutation retries. |
| 5. Remove command refresh delays | Coalesced background catalog/domain refresh; duplicate immediate renders removed; pending row actions are disabled and restore after completion. Homepage CSS delivery is rebuilt from the existing source. |
| 6. Provide recoverable encrypted backups | Safer production identity guard, private files, authenticated encrypted archive script and a daily workflow that verifies a restore before uploading. Activation is pending GitHub secrets and a successful first dispatch. |
| 7. Verify employee and Sets isolation | Contact/customer/Returns-only route tests and denied private domains; all public production tables have RLS; all 11 Sets tables have RLS and no public/anon/authenticated grants. Existing owner-backed API behavior remains valid. |

## Validation evidence

- Backend `npm run check`: 62 suites / 334 tests passed with real local PostgreSQL, followed by `npm run build`. Additional mutation-503 reconciliation and session-clear/late-response regressions then passed with lint/typecheck, bringing the final tested cases to 336. PostgreSQL 16 is used locally; CI uses 17 and production uses 18.
- All 29 static frontend CI contracts passed, including browser database authority, server authority, security boundaries, latency and the unchanged 904 KB initial/core performance budget. Browser JavaScript and backup scripts pass syntax checks. OpenAPI and workflow YAML parse successfully.
- All eight Chromium CI suites passed: product waiting, Sets admin/home/storefront, home storefront, News, settings and the full site. The full-site suite additionally passed real DOM checks for pending order buttons, independent command completion and an older response arriving after a newer snapshot.
- Real database regressions cover invalid single/bulk status jumps without monetary/inventory changes, two concurrent commands with one winner and one audit, a one-connection pool, committed response-read failure (including preserved bulk partial successes), and snapshot/version consistency across a concurrent writer.
- Encryption tests cover streamed round-trip, private file permissions, incorrect passwords, modified/truncated ciphertext, removal of unverified plaintext and preservation of pre-existing files.
- A populated synthetic database using all 59 migrations was dumped, encrypted, authenticated and restored into a separate empty database. The restored database had 59 migrations, zero public tables without RLS, zero orphan order items, one order/item/inventory item and exactly 60,000 `final_minor`.
- Production's original Neon endpoint/default/branch were verified after the incident described in [DATABASE_RECOVERY.md](DATABASE_RECOVERY.md). Counts remained 16 orders / 21 order items / 21 inventory items / 1,447 audit entries / 1,095,600 `final_minor`; readiness passed. These checks do not establish absence of customer impact during the brief older-snapshot interval.

## Dart Quality Review

| Section | Result | Evidence or scope |
| --- | --- | --- |
| 1. States | Pass | Retain current rows during refresh failure; per-row loading; timeout/error unlock; true empty snapshots still accepted. |
| 2. Server authority | Pass | Retired bulk replacement; server recomputes/validates sensitive order effects; browser saves cannot persist status/price/items. |
| 3. Concurrency | Pass | Required expected status and row locks; monotonic full snapshots; read transaction consistency; no one-connection deadlock. |
| 4. Validation/auth | Pass | Strict single/bulk input, centralized permission gates, CSRF/MFA, denied employee domains; cleared sessions remove cached order rows and reject late responses. |
| 5. Idempotency | Pass | No automatic mutation retry; duplicate pending action refused; existing same-state no-op does not duplicate effects; stale retries rejected. |
| 6. Audit | Pass | Existing transactional status before/after audit preserved; concurrent winner produces exactly one transition audit. |
| 7. External services | Pass / N/A | No new WhatsApp sends or paid plan change. Backup automation is prepared but activation is pending; no claim of active periodic protection. |
| 8. Regression | Pass | Full existing frontend/browser suites and backend tests pass; no new framework, schema or unrelated feature. |
| 9. Tests | Pass | Critical scenarios listed above, including real PostgreSQL and real Chromium DOM checks. |
| 10. Secrets | Pass | No credentials in committed code/logs; backup secrets configured directly by owner; artifacts contain only ciphertext. |

## End-to-end review

1. As an order manager, accept a New order; refresh and confirm the server status persists. Direct New → Delivered must fail without changing inventory or totals. A stale `expectedStatus` must return 409.
2. Submit actions on two different orders. Only each pending row's mutation buttons disable; history remains usable. Repeated action on a pending row must not send another command. Slow/failed secondary catalog refresh must not delay a confirmed command.
3. Bulk transition same-state orders; review each success/failure. Refresh to verify every successful row. A failed member must not undo successful members.
4. With contacts-only, customers-only and Returns-only employee permissions, verify permitted sections load and direct private API calls to other domains return 403.
5. Configure the two backup secrets and run the manual backup workflow. Verify the successful isolated restore and encrypted artifact, then inspect the next scheduled run. Use [DATABASE_RECOVERY.md](DATABASE_RECOVERY.md) for controlled recovery instructions and the full incident account.

## Remaining operational step

Post-publication CI found a stale source-pattern assertion that still named the old hydration helper. The production client behavior remained covered by the passing concurrency/Chromium tests. A test-only follow-up updates the assertion and adds a runtime test for hydration during a mutation and reads initiated before it; it introduces no runtime change and no new production build. The final tested Backend case count is 337.

At the pre-publication review cutoff, remote `main` was unchanged at `b4a68367db349434a1a05e1267a4390779465c68`. The initial push was rejected by automatic review because its deploy marker can trigger production. No workaround was attempted. The owner then explicitly authorized publication; GitHub CI and production alias verification are required after the single push. The final release result is recorded by the platform statuses and the delivery message.

The daily backup workflow is **not verified active**. Configure `DART_BACKUP_DATABASE_URL` and `DART_BACKUP_ENCRYPTION_PASSWORD`, verify protected/reviewed `main`, and complete its first dispatch. The connected GitHub integration could not read branch protection (403). Native Neon backup scheduling is blocked by the current plan; no upgrade was made. Production cutover/recovery is never an automatic step in this workflow.
