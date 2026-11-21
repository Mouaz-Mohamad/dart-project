# Dashboard item batching and Arabic direction

Implemented sequentially: (1) multi-code inventory editor, verified with an isolated DOM/API fixture; (2) RTL dashboard layout.

- The + button adds required unique-code fields; remove buttons discard extra fields. All rows share the selected model/color/size. Editing an existing item remains single-item only.
- The existing authorized PATCH /api/v1/admin/catalog-state accepts the complete batch in its PostgreSQL transaction, with current catalog/record versions. No endpoint or migration added. No production data used for testing.
- Successful saves require acknowledgement and authoritative hydration. Failed/uncertain saves stay open, rehydrate, and never automatically replay. Duplicate submission is blocked.
- Dashboard HTML now declares RTL. Directional spacing, borders, alignment and anchors use CSS logical properties across all dashboard styles. The sidebar and mobile drawer follow the reading edge. Centered dialog transforms remain physical; map/chart coordinates and code/phone/email fields retain their intended direction.
- The item batch helper is dashboard-only and capped at 4 KiB, keeping Home and core JavaScript budgets unchanged.

## Validation

- Passed: 67 frontend static suites, source/generated-runtime checks, CSS cascade audit, database-authoritative storage contract, performance budgets and two inventory acknowledgement contract tests.
- Passed: synthetic DOM exercise of production editor and batch adapter: add/remove fields, duplicate codes, three shared-variant units in one request, repeated submit, acknowledgement and failed save.
- Added to browser CI: item-batch-browser.cjs and dashboard-rtl-browser.cjs. RTL checks cover 370, 480, 767, 768, 1024 and 1440px, desktop/collapsed sidebar, mobile drawer, centered dialog and LTR code input.
- Local Chromium launch is blocked by the executor's socket permissions; the separate preview browser cannot reach the local server. Browser suites and visual layouts are not claimed as locally verified.

## Quality review

| Section | Result |
| --- | --- |
| 1. Empty/loading/error | Pass: required codes, busy guard, visible failure |
| 2. Server authority | Pass: existing catalog transaction and rehydration |
| 3. Concurrency | Pass: existing record versions and transaction lock retained |
| 4. Validation/authorization | Pass: duplicate/variant checks; existing server permissions retained |
| 5. Idempotency | Pass: duplicate-submit block, unique codes, no uncertain-write replay |
| 6. Audit | Pass: existing server audit; each acknowledged piece recorded in UI audit |
| 7. Provider cost | N/A: no messaging or paid provider action |
| 8. Regression | Static checks pass; browser CI/visual verification remains outstanding |
| 9. Tests | Pass for DOM/static/contract checks; browser suites added, not run locally |
| 10. Secrets | Pass: no credentials introduced |

Manual verification: Items → Add → choose model/color/size → enter a code → + twice → enter two more distinct codes → Save. Confirm all three pieces persist after reload. Reopen an existing piece and confirm + is hidden. Check Arabic navigation, records, filters, Settings and dialogs on desktop/mobile; open/close the right-side drawer and collapse the desktop sidebar.
