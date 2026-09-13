# V9 verification — 2026-09-11

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
