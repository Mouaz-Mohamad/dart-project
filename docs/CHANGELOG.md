# Dart Project changelog

## Production activation — 2026-09-22

- Activate the simplified Dart Eye Staff email-verification flow after SMTP production configuration was completed.
- This deployment applies pending database migrations through the API production build and publishes the matching storefront/dashboard assets.

## Simplified Dart Eye Staff Email Access — 2026-09-22

- Replaced the unlaunched Google/Supabase Staff sign-in path with an Owner-managed email allowlist and six-digit one-time email verification.
- Removed active Staff password, TOTP, Google exchange and Supabase verification endpoints from the runtime surface.
- Added migration 0025 for email access challenges and conversion of the protected pending Owner entry to `email_otp`.
- Kept Dart PostgreSQL/Neon authoritative for Owner/Staff roles, Active/Disabled state, granular permissions, sessions and audit.
- Added immediate session revocation on Staff disable or permission changes and kept unknown-email responses generic to prevent allowlist enumeration.
- Removed obsolete Google/Supabase browser CSP origins, runtime config, verifier code, live tests and recovery command.
- Customer and Representative authentication remain unchanged.

## Dart Eye Google/Supabase Staff Auth Phase 1 — 2026-09-21 (superseded before production)

- Replaced the primary Owner/Admin/Staff dashboard sign-in UX with Google Identity Services + Supabase Auth while retaining Dart PostgreSQL, RBAC and HttpOnly sessions as the authorization/session authority.
- Added migration 0024 for Google provider binding, Supabase user IDs, provider subjects, linked/last-login timestamps, Staff disable metadata, protected Owner constraints and the permanent first Owner allowlist entry for `midomoaaz3@gmail.com`.
- Added `POST /api/v1/admin/auth/google/exchange` with Dart-project issuer/audience/expiry/subject/email checks plus Supabase Auth verification and Google-only provider enforcement.
- Added transactional first-login subject binding, concurrency locks, conflict auditing, disabled-account rejection and no-password Staff rows for the new path.
- Added Owner-managed Gmail allowlist, Active/Disabled controls, permission updates, session revocation and explicit non-Owner Google relink actions.
- Added a server-only audited Owner break-glass recovery command. It cannot create a second Owner and does not use a fixed recovery password.
- Kept Staff legacy password/OTP/TOTP routes behind Phase-1 feature flags for rollback; customers, representatives and SMTP customer/order notifications are unchanged.
- Kept Supabase sessions ephemeral in Dart Eye with `persistSession:false`; the access token is exchanged once and never persisted as the dashboard session.
- Expanded CSP only for the pinned Supabase JS CDN path already allowed by jsDelivr, Google Identity Services and Supabase API connections.
- Added unit, PostgreSQL integration, optional live-Supabase, browser auth-contract and security-boundary regression coverage.


## Fine-grained permission CI cleanup — 2026-09-21

- Removed the obsolete catalog `requirePermission` import after migrating the routes to `requireAnyPermission`.
- Simplified the permission unit-test mock typing so lint/typecheck validate the actual middleware rather than test-cast noise.
- Moved dashboard chart listener verification to the static contract; Chromium now verifies the controls exist without executing CDN-dependent chart work in the isolated smoke environment.

## Draw-authority and smoke-test correction — 2026-09-21

- Removed a stale static contract that expected browser-side Dart Card winner selection; eligibility remains server-backed and audited, while winner awarding is explicitly reserved for a future server transaction.
- Changed dashboard Chromium year-navigation smoke to trigger the real external event listener programmatically, avoiding false timeouts when the Brand control is outside the mobile viewport.
- Added a regression guard preventing browser-authoritative monthly Dart Card awarding from returning.

## Strict script CSP hardening — 2026-09-21

- Removed executable inline scripts and inline event handlers from storefront, account, receipt and dashboard surfaces.
- Replaced `script-src 'unsafe-inline'` with static SHA-256 allowlists for the seven JSON-LD data blocks and blocked script attributes with `script-src-attr 'none'`.
- Added `frame-src 'none'` on top of the existing frame-ancestor protection.
- Added CI checks that recalculate every JSON-LD CSP hash from source and reject future executable inline JavaScript or event attributes.

## CSS compatibility and render-path cleanup — 2026-09-21

- Flattened dashboard scrollbar CSS nesting into standard selectors for wider browser compatibility.
- Removed the render-delaying Boxicons `@import` from dashboard CSS; the dashboard already loads Boxicons from its document head.
- Added `vh` fallbacks before `dvh` mobile size-chart rules so older mobile browsers retain usable modal heights.
- Bumped the storefront static cache and added static/Chromium regressions for the cleaned CSS behavior.

## Browser compatibility pass — 2026-09-21

- Added a shared clone helper that uses native `structuredClone` when available and a JSON-safe fallback for legacy browsers; cart rollback and dashboard price snapshots now use it.
- Added a `crypto.getRandomValues` fallback for catalogue IDs when `crypto.randomUUID` is unavailable.
- Replaced unnecessary `String.prototype.replaceAll` usage in the dashboard with broadly supported global regular-expression replacements.
- Added regression guards so these compatibility fallbacks cannot silently regress.

## Runtime dead-code cleanup — 2026-09-21

- Removed 17 unused legacy helpers/no-op stubs from the storefront, dashboard operations and platform runtimes after whole-project reference verification.
- Removed the obsolete sequential-ID browser migration stub and empty demo reset shim now that durable business state is server-authoritative.
- Added a regression contract preventing those legacy helper names from silently returning.

## Typed Returns / Damage core phase 1 — 2026-09-21

- Added typed PostgreSQL columns and foreign keys for return customer/order/item links, pickup address, exchange-chain data, monetary values and courier fees.
- Added typed Damage links/fields for inventory, damage code, reason, customer and lifecycle state.
- Added compatibility triggers so legacy payload writes keep the typed core synchronized during migration.
- Customer-created returns now insert one authoritative return row directly instead of rewriting the entire Returns domain array.

## Relational duplicate safety follow-up — 2026-09-21

- Fixed the authoritative 0019 BEFORE trigger so duplicate legacy record IDs cannot make PostgreSQL reject a compatibility write with `ON CONFLICT DO UPDATE command cannot affect row a second time`.
- Duplicate IDs are collapsed deterministically and the final legacy array occurrence wins, preserving the most recent state during migration.

## Vercel production bootstrap hardening — 2026-09-21

- Core API startup no longer requires n8n/automation secrets. A fully absent automation configuration disables event delivery safely; a partial configuration still fails closed.
- Removed the Vercel Outbox cron schedule until its production secret is configured, preventing noisy unauthorized cron invocations.
- Kept immediate event-delivery calls optional through the existing Outbox service so commerce/auth continue to operate without silently sending events.

## Relational business domains V0.4 — 2026-09-21

- Hardened migration 0018 for real legacy production data: duplicate record IDs are deterministically deduplicated during backfill, and legacy business-code indexes are non-unique during migration so stale duplicate codes cannot abort deployment.

- Added first-class PostgreSQL row tables for Returns, Damage, Promotions, Dart Card loyalty, Birthday rewards, Notifications/Messaging and Finance records.
- Backfilled existing domain data transactionally and added indexed generated business keys for return codes, Item Codes, customers, orders, representatives, promotion codes and card codes.
- Dashboard, Finance, customer-return rules and Commerce now read critical operational state from relational rows rather than the monolithic dashboard JSONB arrays.
- `dashboard_domain_state` now remains only as a versioned compatibility envelope: migration 0019 clears existing critical arrays and a BEFORE trigger relationalizes incoming bulk writes before forcing the persisted envelope payload back to `[]`.
- Added PostgreSQL integration and static contracts to prevent critical reads from drifting back to the compatibility JSONB envelope.
- Removed the last remaining Commerce reads of card, damage and birthday-reward payloads from the compatibility envelope; all critical operational reads now use relational rows.\n- Moved customer profile snapshots for Returns, Dart Card, Birthday rewards and Birthday messages to the relational read path so clearing the compatibility envelope cannot hide customer history.


## Production hardening V0.3 — 2026-09-21

- Added real PostgreSQL 17 to Backend CI and made current migration/integration checks execute on every backend change.
- Fixed a PostgreSQL partial-unique-index conflict bug discovered only after enabling real database CI.
- Added Chromium storefront/dashboard smoke coverage and permanent browser-storage/performance regression budgets.
- Removed multi-megabyte logo assets from runtime favicon, representative and dashboard surfaces where the existing 192px asset is appropriate.
- Renamed the stale cart persistence helper so its name reflects server reservation persistence rather than LocalStorage.
- Added magic-byte validation for representative PNG/JPEG/WebP verification uploads before encrypted persistence.
- Added a cross-layer security regression contract covering private-cache boundaries, API cache exclusion, CSRF/cookie protection and accidental frontend secret embedding.
- Updated the notification contract to the current policy: Email + Web Push + in-site for routine commerce; WhatsApp only for birthdays and post-delivery review requests.
- Return fees now come from server-side site settings and are snapshotted on creation; completed exchange chains survive physical Item Code replacement so later exchanges are charged under the correct policy.
- Added a dedicated authenticated interaction rate limit for customer review and return submissions.
- Extracted exchange-chain resolution into a typed server rule with replacement-code continuity tests; return creation keeps the domain row locked while the rule is evaluated.

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
