# CI regression correction — 2026-09-21

- Frontend CI exposed two test assumptions after cleanup: a stale source assertion for removed browser-side Dart Card awarding, and a Playwright visibility timeout on an off-viewport Brand year button.
- The finance contract now verifies server-backed eligibility updates and explicitly rejects browser-authoritative winner awards.
- Browser smoke invokes the same external click listener through DOM `click()`, testing behavior without requiring the control to be in the current mobile viewport.

# Strict CSP verification — 2026-09-21

- All executable inline JavaScript and known inline event handlers were moved to external runtime listeners before tightening CSP.
- `script-src` no longer contains `unsafe-inline`; the seven static JSON-LD blocks are allowed only by exact SHA-256 hashes and `script-src-attr` is `none`.
- SEO CI recalculates those hashes from the HTML source, while auth/static checks reject reintroduced inline executable scripts and event attributes.
- Existing browser smoke covers the migrated signup toggle and receipt rendering; dashboard smoke now exercises year navigation through external listeners.

# CSS/browser compatibility verification — 2026-09-21

- Dashboard CSS no longer relies on nested `&::-webkit-scrollbar` syntax and no longer contains an external `@import` dependency in the render path.
- Mobile size-chart `dvh` declarations are preceded by equivalent `vh` fallbacks.
- CSS architecture tests enforce both compatibility rules; Chromium smoke verifies dashboard navigation remains scrollable after the selector rewrite.

# Runtime cleanup verification — 2026-09-21

- Whole-project reference checks confirmed the removed helpers were not referenced by HTML inline handlers, sibling runtime files or public adapters.
- Deleted helpers covered obsolete browser migrations, local-demo reset shims, unused leaderboard/customer formatters and abandoned UI helpers.
- A server-authority regression contract now fails if any of the removed legacy helper names return to the four affected runtimes.

# Relational duplicate regression fix — 2026-09-21

- Root cause of the latest PostgreSQL CI failure was confirmed in migration 0019: it redefined the authoritative trigger without the duplicate-safe SELECT introduced in 0018.
- 0019 now deduplicates every critical domain before UPSERT and deterministically keeps the last legacy occurrence.
- Integration coverage verifies one relational row remains and that its payload is the last duplicate state.

# Vercel production environment hardening — 2026-09-21

- Verified from Vercel runtime logs that the previous cold start failed only because automation secrets were absent.
- Core API startup now permits automation to be fully disabled; partial automation credentials remain invalid.
- The Outbox service already returns `configured:false` without claiming or publishing events when disabled, and the cron route remains unauthorized without a strong secret.

# Vercel runtime migration hardening — 2026-09-21

- Removed database migration execution from the Vercel build command so production builds do not depend on database reachability during the build sandbox phase.
- Vercel cold starts now run the checksum-protected migration runner under its PostgreSQL advisory lock before serving the API.
- The backend Vercel function bundle explicitly includes `migrations/**`; local/non-Vercel runtime behavior remains unchanged.

# Relational domain migration verification — 2026-09-21

- Migration 0018 is production-safe for legacy duplicates: duplicate record IDs are collapsed deterministically and non-empty legacy business-code indexes remain searchable without imposing a migration-time uniqueness assumption.

- Migration 0018 creates row-level PostgreSQL tables for Returns, Damage, Promotions, Loyalty/Birthday rewards, Notifications/Messaging and Finance.
- Existing arrays are backfilled preserving record order and IDs. Migration 0019 then clears the duplicated critical arrays from `dashboard_domain_state`; future compatibility writes are relationalized by a BEFORE trigger and the envelope persists only `[]` plus its version metadata.
- Dashboard, Finance, customer-return validation and Commerce read those critical domains from relational tables.
- Integration coverage checks the tables exist and verifies a compatibility-envelope update is mirrored transactionally into `return_requests`.
- Static contracts reject regressions where Commerce reads Returns, Cards, Damage, Promotions or Birthday rewards directly from `dashboard_domain_state.data`. Customer snapshot coverage separately verifies profile history is loaded from the relational tables.
- Real PostgreSQL migration tests passed for migration 0018 and its row-level mirror trigger before the final mock-fixture cleanup.

# Recovery and readiness hardening — 2026-09-21

- Added an automated PostgreSQL restore-drill command for verified custom-format backups.
- Restore verification is fail-safe: it refuses the production database, requires an explicitly named recovery/test target, never issues DROP/CLEAN/CREATE, and restores inside a single transaction with exit-on-error.
- Health liveness now reports process uptime; readiness reports PostgreSQL latency without exposing database errors or credentials.
- Tests permanently enforce the non-destructive recovery boundary and readiness response contract.

# Production hardening verification — 2026-09-21

- GitHub Backend CI now provisions PostgreSQL 17 and runs the full Vitest suite with `TEST_DATABASE_URL`; current migrations are applied into isolated schemas rather than being skipped.
- The real database run exposed and fixed the partial-index outbox conflict target. Backend CI subsequently passed against PostgreSQL 17.
- Database integration coverage now verifies every migration filename is recorded, production-critical tables exist, audit rows are append-only, and outbox/idempotency deduplication is enforced by PostgreSQL.
- Frontend CI now includes Chromium smoke coverage plus permanent database-authority and performance-budget checks.
- Runtime favicons and dashboard/representative logos no longer download multi-megabyte logo sources where the existing 192px asset is sufficient; product cards lazy-load and decode images asynchronously.
- Representative verification uploads now verify PNG/JPEG/WebP magic bytes against the declared MIME type before encryption or database persistence. A dedicated regression test rejects arbitrary bytes and MIME-disguised image signatures.

- Cross-layer security contract coverage now prevents Service Worker API caching, accidental caching of private account/dashboard pages, browser embedding of server secret configuration, and removal of dashboard CSRF/cookie boundaries.
- Return policy tests now cover ITEM-OLD → ITEM-NEW → ITEM-NEW-2 chain continuity, completed-exchange counting, and exclusion of pending/rejected requests from the free-exchange quota.
- Server/browser return courier-policy parity is regression-tested for configurable refund fees, configurable repeat-exchange fees, zero-valued settings, the fixed first Dart-paid exchange, and exchange-chain continuity after Item Code replacement.

# V9 verification — 2026-09-11

## Identity/Auth V0.2 verification — 2026-09-20

- Backend production build, ESLint and strict TypeScript checks passed. The suite reports 24 passing tests across environment hardening, security primitives, HTTP cookie/CSRF boundaries, health/error behavior and migration ordering; five PostgreSQL-dependent scenarios remain automatically skipped without `TEST_DATABASE_URL`.
- Verified Argon2id hashing, Egyptian phone normalization, AES-256-GCM secret encryption, session-token parsing, no-session-before-OTP behavior, HttpOnly session cookies, separate CSRF cookies, CSRF rejection, successful logout, MFA enforcement and fail-closed representative registration.
- Existing platform, representative, tracking, Cairo/Giza address, dashboard, finance, settings, static accessibility/assets/integer-money and SEO checks all passed after the auth adapters and dashboard gate were added.
- JavaScript syntax passed for customer auth, representative auth and the new Dart Eye admin gate. OpenAPI YAML parses and includes the implemented Identity/Auth paths.
- Common private-key/API-token patterns were not found in project source. OTPs, temporary passwords, session secrets, National IDs and TOTP secrets are not logged.
- The real PostgreSQL migration could not be applied in this environment because neither Docker nor PostgreSQL executables are installed. The isolated integration suite is included and must run in CI/staging with `TEST_DATABASE_URL` before deployment.
- Playwright Chromium is not installed, so the browser visual suite stopped with its explicit dependency message. No visual pass is claimed for the new login overlays.
- The existing user-owned `manifest.json` line-ending modification remains untouched and is the only source of `git diff --check` whitespace warnings.

## Backend Foundation V0.1 verification — 2026-09-19

- Backend lint, TypeScript type checking and production build passed.
- 13 backend tests passed for environment validation, production seed blocking, liveness, PostgreSQL-down readiness, CORS rejection, structured 404/invalid-JSON responses, migration ordering/checksums and seed opt-in. Three real-PostgreSQL assertions are included but skipped automatically when `TEST_DATABASE_URL` is absent.
- A built server smoke test returned `200` for `/api/v1/health/live` and a non-leaking `503` for `/api/v1/health/ready` while PostgreSQL was intentionally unavailable.
- Production dependency audit reported zero known vulnerabilities.
- Existing non-browser platform, representative, tracking, address, dashboard, finance, settings, accounting, CSS and SEO tests passed. Static HTML/assets/accessibility/integer-money and JavaScript syntax checks also passed.
- Chromium-only catalogue/browser tests could not run because this environment has no Chromium executable. Docker/PostgreSQL are also unavailable here, so the isolated migration integration suite remains for a local or CI run with `TEST_DATABASE_URL`.
- No storefront or Dart Eye runtime file was changed. The existing `manifest.json` line-ending-only modification was present before this backend work and remains untouched.

## Clean structure and SEO

- Removed the recursively duplicated project copies from `CSS/`, `Icons/`, `sections/` and `sections/sections`.
- Kept one canonical copy of every page, runtime file and reusable fragment. A whole-project SHA-256 scan found no duplicate runtime files.
- Kept dashboard HTML, styles, scripts and private images together under `Eye/`; reusable page fragments remain under `sections/`.
- Consolidated historical reports into one current changelog, code map and verification report under `docs/`.
- Verified all local HTML/CSS/JavaScript/image references and all static buttons. Buttons now declare an explicit type, external new-tab links use `noopener`, and reusable fragments do not reload scripts or styles.
- Added page-specific titles, descriptions, canonicals, robots directives, Open Graph, Twitter cards, headings and valid JSON-LD to every public indexable page.
- Kept only public pages in `sitemap.xml`. Account, checkout, profile, tracking, representative, receipt and dashboard pages are excluded from the sitemap and carry `noindex` in HTML and Vercel headers.
- Added the verified Instagram profile to the Organization structured data and removed placeholder social destinations.

## Passed behavior

- A real Contact Us form submission was stored in the dashboard Review inbox with source, customer contact details and message. Status, stars and title rendered as `-`; Contact Us and Review filters returned only their matching rows.
- Return requests now follow review, approval/rejection, representative assignment, pickup completion and final Good/Damaged inspection. Good restores the physical item to stock; Damaged creates one deduplicated Damage record.
- The tracking module created one map and kept it alive through DOM initialization. The destination marker appeared before representative assignment. The waiting layer computed to 20% black. Assignment alone kept the layer and hid courier location; `deliveryStartedAt` removed it and displayed the courier marker.
- Top Clients defaulted to This Month/None, ranked two orders above one even when the one-order customer spent more, subtracted refunds, switched exclusively to annual mode, and returned to This Month when both filters were cleared.
- Age appeared in Top Clients, Birthday and Client rows. Client History reported separate order and spending changes using the last two complete months.
- Previous V7 browser scenarios still passed: catalogue, shared images, groups, purchase selection, reservations, checkout snapshots, Sold Out and archive behavior.
- Platform, Cairo/Giza address, representative, tracking resolution, syntax, HTML/assets/accessibility and integer-money tests passed.

## Test boundaries

The acceptance tests use isolated local records and a Leaflet-compatible map stub so they can verify application state, marker activation and lifecycle without depending on public tile/router uptime. Live tile delivery, OSRM response time, real GPS permissions and cross-device updates require staging tests after the backend is connected.

The V8 browser suites passed before the structure cleanup. After cleanup, unit, structure, accessibility, asset and SEO suites passed again. A final Chromium rerun could not be completed in this environment because the browser binary was unavailable and its download timed out; `tests/full-site-browser.js` remains in the package for the next local or CI run and now covers every dashboard navigation target.

This package is still a browser-local prototype. The production backend requirements are documented in `API_CONTRACT.md`.

## Requested V9 additions verified

- Birthday reward unit scenarios passed for a Cairo birthday window, automatic 30% priority over an active 40% Dart Card, no Dart Card quota consumption, reservation at order creation, use at Delivered and restoration after cancellation while valid.
- Isolated dashboard data tests passed for the 8:00 PM Cairo tomorrow-birthday queue, day-month-year birthday values, per-customer removal after queueing, record-only deletion and linked-data cascade deletion.
- Source-contract checks passed for the seven-day countdown fields, 10px insets/60px height, supplied background image, balloons/confetti and session-only Close behavior.
- Source-contract checks passed for the vertical ticker, two-name authenticity owner, three-name/top-three Leaderboard, Item-Code-only return form with automatic model lookup, persistent profile card, five empty social destinations, Delivered tracking exclusion, both permanent-delete choices and manual Additional Benefit grants.
- JavaScript syntax, platform, representative, tracking, Cairo/Giza, static HTML/assets/accessibility, integer-money and SEO suites all passed after the V9 changes.

The environment still has no installed Chromium binary, so the included browser suites were not rerun here. They remain available for a visual interaction pass on a development machine or CI runner with Playwright/Chromium.

## V9.2 focused verification

- Confirmed that a `New` order contributes zero Leaderboard pieces and the same order contributes its physical pieces immediately after becoming `Delivered`; completed returns still reduce the score.
- Confirmed that the birthday list remains available before 20:00 Cairo, rolls to tomorrow at 20:00, includes newly added matching customers immediately and continues hiding customers after their message is queued.
- Confirmed that customer sessions persist until explicit logout, My Account resolves directly to the profile, and checkout rejects a guest before creating any customer or order.
- Confirmed that customer and representative sessions remain separate and representative registration permits contact details already used by that person's customer account while retaining representative-to-representative duplicate checks.
- JavaScript syntax, platform, dashboard, representative, tracking, Cairo/Giza, feature-contract, static structure and SEO checks passed. Chromium-only suites remain pending because no browser binary is installed in this environment.

## Finance V1 verification — 2026-09-13

- Isolated finance tests passed for empty-start behavior, delivered revenue, detailed-refund deduplication, Good-return COGS reversal, Damaged-return non-duplication, accrual expenses, paid-expense Cash Flow, COD receipts/fees, repeat-customer rate, budgets, goals and model profitability.
- Source-contract checks confirmed the unified period comparison, three new chart mounts, all Finance reports, separate backend-ready storage boundaries and the audited per-customer Dart Card draw control.
- The original `myChart`, Latest Updates, Birthday, Top Clients and visitor/sales chart IDs remain singular and intact. The finance module never addresses or replaces `myChart`.
- Every file outside `Eye/`, `docs/` and `tests/` was byte-compared with the supplied archive and matched, confirming that no public-site file was changed.
- Platform, representative, tracking, address, V9 dashboard, V9 requested-feature, static HTML/assets/accessibility, SEO and JavaScript syntax checks passed after the Finance changes.
- A Chromium interaction run was attempted, but the cached executable advertised by Playwright was not present. The existing full-site browser suite remains available for CI/staging.

## Finance V1.1 layout verification — 2026-09-13

- Confirmed that the Brand period control, original chart, analytics grid and Business Insights appear in a stable source order before the unchanged Latest Updates, Birthday, Top Clients and visitor/sales chart.
- Confirmed that all three new chart frames have bounded heights, their panels participate in normal document flow, and mobile collapses the grid to one column.
- Confirmed that the Finance shell and editor forms now exist in HTML with unique IDs; JavaScript no longer injects those structures.
- Kept the original Expenses tab table as requested and removed the duplicate management box.
- Finance calculation tests, source-contract tests, JavaScript syntax checks and a 334-ID uniqueness check passed. Chromium remains unavailable in this environment.

## Settings V1 verification — 2026-09-13

- Confirmed that Settings is reachable from desktop and mobile dashboard navigation and that its section, warning modal and confirmation controls live in HTML with unique IDs.
- Confirmed that the destructive action stays disabled until `DELETE DART` is typed and the irreversible-action checkbox is selected, followed by one final native confirmation.
- Confirmed that the reset targets `dart_*`, the two documented legacy Dart keys and the catalogue image store, while preserving unrelated origin storage.
- Added and passed an isolated reset-scope test. Production backend reset must require authenticated admin re-verification and server-side protected audit logging.

## Accounting and Returns V10 verification — 2026-09-13

- Verified the accounting example: a piece with EGP 400 immutable cost, EGP 600 selling price and a 30% order discount contributes EGP 420 to Total Selling, EGP 400 to Total Cost and EGP 20 to Total Profit.
- Verified historical snapshots: sales of the same model at EGP 100 and later EGP 120 aggregate to EGP 220 without rewriting the earlier sale. Newly added pieces of the same model inside an existing order inherit that order's original snapshot.
- Verified `In Stock Cost Value` beside `In Stock Selling Value`, period-aware Brand cards, completed-refund subtraction, first-exchange EGP 50 Dart expense, and exclusion of customer-paid return/exchange courier fees from Dart revenue and Cash Flow.
- Verified that a damaged physical item contributes its cost once, including an exchanged item whose damaged original is no longer present on the order line.
- Verified the return/exchange flow across the customer form, public tracking, dashboard approval/assignment, representative pickup and post-pickup inspection. Exchange replacements retain the exact original net price and chain history.
- All JavaScript syntax, accounting, return-policy, representative, tracking, dashboard-contract, Settings, platform, Cairo/Giza address, static HTML/assets/accessibility and SEO checks passed. Chromium is not installed in this environment, so the included browser-only visual suite remains for CI or staging.

## Settings, grouping and tracking V11 verification — 2026-09-14

- Fixed the Brand customer count to recognize the customer `registeredAt` field and added an isolated regression assertion.
- Added dashboard settings for day/night hero media, founder media, scheduled announcements, editable hero typing scenes, model-card color visibility, future-model markup, non-stacking site-wide discounts, configurable Birthday/Dart Card percentages and configurable customer return/exchange fees. Configuration changes are audit logged.
- Preserved old commercial records: model/order/discount/fee snapshots do not change when a future default changes. A configured value of zero is treated as a valid setting rather than falling back to the old default.
- Added deterministic grouping for unassigned orders and returns using the same customer plus country, governorate, area and street. Assignment freezes the shared group ID; selected records and their lines remain independently actionable.
- Rebuilt active tracking to display separate cards for separate groups, one grouped card with dividers for matching records, and no completed-return card. The profile and dashboard retain completed history.
- Replaced the authenticity result modal with a persistent skeleton/result card and retained sold-item validation. Removed the visual return-eligibility blocker while preserving submit-time validation.
- Reworked the original dashboard chart to show period-derived Total Sales only. Verified the owner accounting example: 600 EGP list selling less 30% equals 420 EGP Total Selling; 400 EGP physical cost yields 20 EGP Brand Total Profit.
