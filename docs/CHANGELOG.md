# Dart Project changelog

## Identity/Auth V0.2.1 — 2026-09-20

- Documented the zero-configuration Vercel Express deployment and the exact production environment contract without storing secret values.
- Added an explicit `SESSION_COOKIE_SAME_SITE` policy so separate HTTPS frontend/API projects can use `SameSite=None; Secure`, while the safer `Strict` behavior remains the default.
- Added regression tests for both the default cookie policy and the cross-site Vercel deployment policy.

## Identity/Auth V0.2 — 2026-09-20

- Added PostgreSQL identity tables for separate Customer, Staff and Representative realms, normalized phone uniqueness, customer/staff/representative profiles, rotating sessions, Email challenges, password-reset requests/history, MFA recovery-code storage and deny-by-default role/permission foundations.
- Added Argon2id password hashing, a 12-character policy, hashed session and CSRF tokens, session-family reuse detection, device revocation, lockout/rate limits and append-only security audit events.
- Added six-digit customer Email OTP registration and Email-change verification through encrypted transactional-outbox payloads; no OTP or temporary password is written to logs.
- Added protected one-time Owner bootstrap, Staff dashboard login and Authenticator App TOTP setup. Owner-only representative decisions and temporary-password assignment require MFA and explicit permissions.
- Connected the existing customer forms/profile and representative login to `/api/v1` when configured. HTTPS production auth fails closed if the secure API is missing; local prototype behavior remains available only for development.
- Kept representative registration closed in API mode until encrypted private document storage, MIME inspection and malware scanning exist; incomplete applications are never saved.
- Expanded OpenAPI, backend/frontend documentation and automated security/route tests.

## Backend Foundation V0.1 — 2026-09-19

- Added the provider-neutral `backend/` modular-monolith foundation using Node.js, Express, TypeScript and PostgreSQL.
- Added validated environment configuration, structured request IDs/logging, secure defaults, CORS allowlisting, rate limiting, consistent error responses and graceful shutdown.
- Added liveness/readiness endpoints under `/api/v1/health` and an initial OpenAPI document.
- Added checksum-protected ordered SQL migrations with a PostgreSQL advisory lock and a single-next-migration command.
- Added append-only audit storage, transactional outbox storage and hashed idempotency-key storage.
- Added explicitly enabled, production-blocked synthetic seed infrastructure.
- Recorded the approved channel split: Email/Web Push/in-site for routine order states; WhatsApp only for interactive confirmation, birthday and post-delivery review requests.
- Kept every storefront and Dart Eye runtime file unchanged; API migration remains incremental and requires approval per domain.

## V11 site control, grouping and tracking — 2026-09-14

- Added complete site-control settings with audited, backend-ready records and future-only commercial defaults.
- Added exact pre-assignment grouping for matching customer/address orders and returns, plus selected-row return assignment.
- Added multi-order/multi-return tracking cards, persistent serial-result skeleton, same-model exchange options and completed-return hiding.
- Fixed the Brand customer count and converted the original chart to real Total Sales values.
- Updated Brand Total Cost to the owner's all-physical-items liability formula while retaining conventional matched COGS in P&L.

## Returns, exchanges and accounting completion — 2026-09-13

- Added `In Stock Cost Value` beside `In Stock Selling Value`; every Brand KPI and calculation now reads the unified reporting range and previous-period comparison.
- Locked physical item cost at stock entry and preserved immutable order price/cost snapshots when the model price changes later.
- Added the complete return/exchange workflow: fresh map/manual pickup address, admin approval/rejection and representative assignment, representative pickup with live location, automatic three-stage customer tracking and post-pickup Good/Damaged inspection.
- Enforced per-item exchange chains and courier fees: first completed exchange is 50 EGP paid by Dart, later exchanges are 50 EGP paid directly by the customer, and refunds are 100 EGP paid directly by the customer.
- Completed refunds reduce sales by the original proportional net item amount. Exchanges preserve the original transaction value. Customer-paid courier fees are excluded from Dart revenue and Cash Flow.
- Kept all new repeating card/table structures in static HTML templates and filled them from JavaScript by stable selectors.

- Routed Contact Us messages into the Review dashboard inbox and added a source filter.
- Restored the complete return decision and inspection controls.
- Kept the destination map visible under a 20% waiting layer and tied live tracking to the representative's Start Delivery action for each order.
- Added monthly/annual Top Clients filters, delivered-order-first ranking, refund-aware spending, customer ages and purchase trends.
- Fixed the map initialization race that removed the newly created Leaflet map.
- Bumped the public static cache name so browsers fetch the corrected assets.
- Corrected the public Leaderboard to subtract completed returned Item Codes from `PIC` while leaving pending and rejected return requests uncounted.

Implementation notes and backend boundaries are in `README.md` and `API_CONTRACT.md`. Verification evidence is in `VERIFICATION_REPORT.md`.

## Clean structure update

- Removed recursively copied projects from `CSS`, `Icons` and `sections`.
- Kept one root copy of every standalone page, including `policies.html` and `pdf.html`.
- Kept one root copy of `manifest.json`, `sw.js`, `sitemap.xml` and `robots.txt`.
- Kept `sections/leaderboard-card.html` as the only Leaderboard fragment.
- Consolidated historical change, code-map and verification documents into current files under `docs`.
- Removed duplicate stylesheet/script imports from reusable fragments and normalized their shared asset paths.
- Added one full-site smoke test for shared sections, menus, filters, authentication switches, receipt rendering, tracking, every dashboard navigation target and root PWA/SEO files.
- Added automated SEO/structure checks for metadata, JSON-LD, sitemap membership, noindex pages, unique canonical files, explicit button types and safe external links.
- Improved public metadata, social previews, structured data and heading semantics; added private-page indexing headers for Vercel.

## V9 birthday rewards and Dart Card experience

- Added the Cairo-time birthday send queue to the Brand dashboard. It opens at 8:00 PM for the next day's birthdays and removes each selected customer immediately after the message is queued.
- Added the seven-day 30% Birthday reward lifecycle, one-use reservation at checkout, Delivered confirmation and Cancelled/Refused restoration while still valid.
- Made Birthday discount automatically override every other promotion without stacking or consuming Dart Card pieces.
- Added the full-screen birthday card using the supplied Dart artwork as a background, with a 60px Days/Hours/Minutes countdown inside its blank top area, balloons/confetti and a session-only Close action.
- Added the vertical under-nav ticker for Welcome and the active Birthday reward while keeping the shopping icon fixed.
- Expanded sold-item authenticity results with product image/name, Item Code, size, color and the owner's first two names.
- Redesigned the public Leaderboard for at most three candidates with gold/burgundy, silver and bronze ranks and three-part names.
- Simplified the customer return/exchange form to Item Code only; Model Code is derived from the immutable order snapshot or inventory record.
- Rebuilt the profile Dart Card from the supplied reference with the white logo and dynamic customer/card values; inactive history remains visible.
- Restored prepared Instagram, Facebook, TikTok, YouTube and WhatsApp placeholders to the side menu and footer without publishing placeholder destinations.
- Removed Delivered orders from the active tracking page while retaining them in customer history.
- Added a per-delete modal offering record-only or linked-data cascade deletion, plus Cancel.
- Added the Dart Card `Additional Benefit` action for manual grants with customer autofill, fixed 40%/10-piece rules and editable issue/expiry dates.
- Added automated V9 feature-contract checks and bumped the static cache to `dart-static-v9`.

## V9.2 delivery, birthday queue and account corrections

- Kept Leaderboard scoring tied to `Delivered` physical items only and added live refresh when delivery or completed-return data changes.
- Kept the birthday-message batch visible all day, added immediate inclusion of newly created matching customers and retained the 20:00 Cairo rollover.
- Preserved birthday Close state during internal browsing/reload while clearing it on a new site entry.
- Remembered customer login until explicit logout, routed My Account directly to the profile and returned checkout-triggered authentication to the cart.
- Blocked guest order creation and preserved separate customer/representative accounts, allowing the same contact details across those two roles.
- Bumped the public static cache to `dart-static-v9-2`.

## Finance V1 dashboard

- Recalculated Brand Sales, Total Cost and Profit by one shared reporting period and added safe previous-period comparisons, including a non-infinite `New` state when the previous base is zero.
- Added Returning Customers, Goals and Financial Analysis charts without replacing the original Brand chart or the Customer, Orders, Rating, Stock and Sold Items cards.
- Added flexible goal, expense, budget, invoice, marketing and COD receipt management with empty initial collections and append-only audit records.
- Added P&L, Cash Flow, COD reconciliation and model-profitability reports plus CSV export and record-driven operational/financial alerts.
- Added per-customer Dart Card draw eligibility control and an eligibility history. Excluded customers are removed from the monthly winner candidate set without cancelling an already-earned active benefit.
- Added Finance backend contracts and isolated calculation/contract tests. No public-site runtime file was changed for this dashboard release.

## Finance V1.1 layout correction

- Moved the fixed Finance navigation, unified-period controls, Business Insights cards and Finance editor forms into `Eye/Dart Eye.html`, with stable IDs used by JavaScript.
- Fixed the Brand flow and chart-frame heights so Business Insights reserves its own space and cannot overlap the analytics cards or following widgets.
- Kept the existing Expenses tab and its edit/delete table; the proposed duplicate expense box was removed.

## Settings V1

- Added a responsive dashboard-only Settings section as a stable place for future preferences.
- Added a guarded “Reset All Dart Data” action with a detailed destructive warning, typed `DELETE DART` confirmation, acknowledgement checkbox and final browser confirmation.
- Reset removes only Dart-owned local/session storage plus saved catalogue images in IndexedDB; unrelated origin storage is preserved and no public-site interface file was changed.
