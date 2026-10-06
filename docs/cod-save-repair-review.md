# COD Save Record repair — 2026-10-06

Status: implemented and tested locally; not published.

The browser normalized a receipt as a complete domain record, including status,
createdAt, updatedAt and archivedAt. It then sent that record unchanged to
POST /api/v1/admin/finance/settlements. The endpoint uses a strict command schema
and rejects those extra fields with 422 VALIDATION_ERROR before recording cash.

The browser adapter now sends only id, orderId, settlementDate, amountReceived,
fee, reference and notes. Server validation, authorization, money calculations,
transactions and audit logging are unchanged. The receipt id is retained on
retry. The dashboard script URL was versioned to fetch the corrected adapter.
No database migrations or API runtime changes are required.

The latest main branch also contained a CSS source edit whose generated home
bundle was stale. CSS/home.css and CSS/home.min.css were regenerated with the
existing build command; no CSS source was edited for this repair.

## Verification

- 27 frontend regression scripts passed, including Finance state/UI runtime,
  database-authoritative storage and performance budgets.
- 15 tests passed across cod-browser-command, finance and finance-routes.
- Backend TypeScript and ESLint for the new test passed; git diff --check passed.
- Browser command test runs the real normalization and state adapter against the
  actual Express Finance route and authentication/CSRF middleware with synthetic
  identity and service fixtures. No production cash movements were created.
- Scenarios: old full record rejects with 422 without calling the service;
  corrected command succeeds; retries retain the same receipt id; failed refresh
  preserves the confirmed receipt without duplicates; missing permission rejects
  with 403; invalid fee and missing CSRF remain blocked.
- A successful production COD save has not yet been verified. Previously reported
  homepage browser/Lighthouse failures are outside this local repair verification.

## Dart Quality Review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. State coverage | Pass | Existing loading/error handling retained; confirmed POST survives refresh failure. |
| 2. Server authority | Pass | Command-only payload; eligibility, balances and minor-unit accounting remain server-owned. |
| 3. Concurrency | Pass | Existing transaction, advisory lock and order row lock retained; no whole-array receipt write. |
| 4. Validation and authorization | Pass | Real strict route, permission and CSRF tests; no security middleware changed. |
| 5. Idempotency | Pass | Stable receipt id reaches service on retries; existing service deduplication remains intact. |
| 6. Audit | Pass | Existing transactional COD_SETTLEMENT_RECEIVED audit retained; no new persistence path. |
| 7. External-service cost | N/A | No messaging, paid integration or additional recurring calls introduced. |
| 8. Regression safety | Pass | Narrow adapter change and cache version; generated CSS only follows existing source. |
| 9. Tests | Pass | Critical browser/API contract covered, plus finance/service and frontend regressions. |
| 10. Secrets | Pass | Synthetic test values only; no credentials or request headers added to production code/logs. |

After deployment: refresh the dashboard, open Finance → COD → Record receipt for
a delivered order with an outstanding amount, enter an actual receipt, then
Save Record. Confirm Remaining and Received, and reload to verify persistence.
Do not record fictional receipts against production orders solely for testing.
