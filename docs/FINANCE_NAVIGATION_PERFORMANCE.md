# Finance and storefront performance

Reviewed: 2026-10-13. Seven approved changes, one production batch. No database migrations, production-row edits or service-plan changes.

| Change | Main implementation | Manual check |
| --- | --- | --- |
| 1. Consistent archives | `backend/src/modules/finance/finance.service.ts` | Select October 2026. The already archived 100 EGP expense contributes neither operating cost nor paid cash out. Restore/archive a disposable test expense in a test environment and compare Expenses, P&L and Cash Flow. |
| 2. Bounded finance retries and chart reuse | `Eye/dart-finance.js` | Fail a finance GET: one error, increasing retry delay and a working Retry button. An unchanged refresh retains chart instances; changed data updates their data and tooltips. |
| 3. One authorized report snapshot | Finance service/routes, `backend/openapi.yaml` | Inspect `/admin/finance/report`: one request includes current, previous and up to twelve periods. A cost-only Staff account receives no revenue/profit/cash-flow fields. |
| 4. Visible dashboard rendering | `Eye/dart.js` | Rapid data events schedule one frame; open Orders, Models and Brand in turn. Only the active section redraws. Hidden-tab changes reconcile when it becomes visible. |
| 5. Early shared shell | `scripts/stage-vercel-public.cjs`, UI delivery runtimes | View production HTML with JavaScript disabled: navigation/footer already exist. Network has no additional Nav-Bar/footer fragment requests. |
| 6. Automatic background preparation | `Js/dart-navigation.js`, Home/UI/News runtimes | After critical content, remaining sections, reviews/News and six public documents prepare without scrolling. Static page/asset preparation has at most two active downloads; Save-Data/2G skips document speculation. HTML revalidates and CSS/JS URLs carry content hashes. |
| 7. Native page restoration and fresh commerce | Navigation/platform/Sets runtimes | Home → Products → Home → Products using site links; verify the same document, filters and scroll in supported browsers. Back/Forward and product/Set modal history still work. Change/expire a cart on another page, return, and verify API rehydration. Logout never restores a cached customer profile. |

`node scripts/build-home-runtime.cjs` compiles the curated Home source, the exact platform derivative and public navigation with pinned Terser 5.44.0. Home uses the same static-section loader as the full UI. `node scripts/stage-vercel-public.cjs` inlines public shared shell fragments and versions assets. Public HTML uses `no-cache, must-revalidate`; private documents, retirement Service Worker and business APIs retain `no-store`.

Native restoration and prerendering depend on browser support, memory and eligibility. A discarded document uses a normal fresh navigation; no application can require the browser to retain it indefinitely. Public document history is reused through Navigation API entries rather than DOM replacement, so page globals, event listeners, modal history, title, canonical metadata and CSP keep their existing document boundaries. Prerendering defers account/cart initialization and visit analytics until activation. Failed/aborted background requests never replace actual navigation error states.

Customer profiles, carts, Set groups, finance rows and public business settings remain API-backed memory projections. Browser persistence is limited to existing preferences and ephemeral identifiers. No cart/profile snapshot is introduced by preloading. A restored page clears its account/cart projection, probes the session and fetches the current catalog/cart; it does not claim stale local cart lines.

## Automated verification

- `cd backend && npm run check` and `npm run build`: lint, typecheck and all available unit/HTTP/integration checks. Local results: 340 passed, 35 external-PostgreSQL cases skipped; GitHub CI supplies PostgreSQL 17 for those cases.
- Embedded PostgreSQL finance integration: real SQL, Cairo midnight boundaries, independent period costs/revenue, archived paid and inventory expenses, nine SELECTs, one read-only transaction, rollback/release on SQL failure, unchanged stored records. Neon test-branch creation was rejected with INVALID_ARGUMENT, so no production data was used for fixture writes.
- Finance UI runtime: one report HTTP call, permanent failure without request loop, identical-markup recovery, stale response exclusion, unchanged charts, changed callback refresh, legacy deployment fallback, failed legacy buckets, pending request after Logout, twelve tabs, six forms and failed/successful persistence.
- Dashboard runtime: burst coalescing, one state read, visible-section rendering, switching and hidden-tab reconciliation.
- Thirty frontend static suites; nine browser suites are wired to Frontend CI. Browser coverage includes purchase double-click guards, Set discount/group identity and reload recovery, filters, menus, shared sections, auth surfaces, product/Set deep links, News retry and native navigation.
- Local headless-shell disables BFCache in its browser delegate. The local navigation test explicitly reports this native-retention skip; full Chromium CI requires native document/filter restoration. Production Chrome is checked after deployment as well.

## Quality review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. Empty/loading/error states | Pass | Existing empty states remain; finance shows loading/error/Retry and recovery removes the error even when markup matches a previous report. |
| 2. Server authority | Pass | Calculations still use integer minor amounts on the server; carts/discounts/stock/checkout remain server validated. |
| 3. Concurrency/races | Pass | One repeatable-read snapshot, coalesced reads/render frames, revision checks, pending-response invalidation and cart projection order. No new concurrent writer. |
| 4. Validation/authorization | Pass | Central Staff/MFA/view permissions before SQL; valid ordered dates, bucket count and bounded union span; granular fields tested. |
| 5. Idempotency | Pass / no new mutation | New endpoint and preloads are reads. Existing settlement/purchase protections stay intact; retry never resubmits a mutation. |
| 6. Audit/observability | Pass / no new sensitive action | Existing expense and settlement audit flows remain; this batch adds no sensitive mutation requiring another audit record. No sensitive row payload is logged. |
| 7. External cost | Not applicable | No WhatsApp/message sends or new paid-service usage. No Neon/Vercel plan upgrade. |
| 8. Regression safety | Pass | Existing customer/admin pages, permissions, modal/history, cart/Set, finance/export and API compatibility checks; old report routes retained. |
| 9. Critical-path tests | Pass, with stated local skip | SQL/HTTP/VM/browser cases above. Native browser retention requires full Chromium, not local headless-shell. |
| 10. Secrets | Pass | No real credentials or tokens in changed source, fixtures or the report. Fixtures use synthetic identities only. |
