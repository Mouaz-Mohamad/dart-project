# Dart Code Map

## Backend entry and wiring

- `backend/src/app.ts` — creates runtime services and PostgreSQL-backed modules.
- `backend/src/application.ts` — mounts middleware and `/api/v1` routers.
- `backend/src/database/migrate.ts` — ordered immutable migration runner.
- `backend/openapi.yaml` — declared HTTP contract.

## Identity / Security

- `backend/src/modules/identity/identity.routes.ts` — customer/representative/admin identity HTTP boundaries; new Customer signup requires Birthday.
- `backend/src/modules/identity/identity.service.ts` — identity/session/account business logic.
- `backend/src/modules/identity/social-auth.routes.ts` — Google/Facebook customer OAuth start/callback/challenge/completion boundaries.
- `backend/src/modules/identity/social-auth.service.ts` — server-side provider exchange, hashed one-time social capabilities and Customer account linking.
- `backend/src/security/password.ts` — Customer 6+ any-character policy, Representative strong 12+ policy, and Argon2id helpers.
- `backend/src/middleware/authentication.ts` — sessions, CSRF, MFA/permission gates.
- `backend/migrations/0038_customer_social_auth_and_multi_winner_draw.sql` — Social identity/challenge persistence, new-Customer Birthday guard and multi-winner draw history.

## Commerce

- `backend/src/modules/commerce/commerce.routes.ts` — cart/order/returns/customer commerce routes.
- `backend/src/modules/commerce/commerce.service.ts` — authoritative inventory reservation, checkout, pricing, reward priority and order transitions.
- `backend/src/modules/commerce/commerce.types.ts` — shared input, item and order projection types; existing service type exports remain compatible.
- `backend/src/modules/commerce/commerce.pricing.ts` / `commerce.rewards.ts` / `commerce.routing.ts` — extracted pure calculations and route ordering, with their original behavior.
- `backend/src/modules/commerce/commerce.customer-queries.ts` — public leaderboard and private customer snapshot/live tracking reads.
- `backend/src/modules/commerce/commerce.operations-queries.ts` — live operations and assigned representative work reads.
- `backend/src/modules/commerce/commerce.order-queries.ts` — versioned read-only order snapshots.
- `backend/src/modules/commerce/cod-risk.ts` — COD risk decision engine.

## Birthday integrity

- `backend/migrations/0034_rewards_promotions_draw_integrity.sql`
  - `birthday_discount_usage` unique customer/year ledger.
  - final use only on Delivered.
  - release on Cancelled/Refused.
  - birthday edit cleanup/lock behavior + audit.
- `backend/migrations/0037_reward_reservation_after_order_insert.sql`
  - reserves Birthday/Promotion usage only after the Order row exists while remaining inside the same transaction.
- `backend/migrations/0038_customer_social_auth_and_multi_winner_draw.sql`
  - prevents insertion of a new Customer without Birthday while preserving legacy existing rows.
- Existing `birthday_rewards` remains the UI/business projection consumed by Commerce/Storefront.

## Promotions

- `backend/src/modules/promotions/promotion.service.ts` — dynamic eligibility rules, cart scope, usage checks, admin writes and analytics.
- `backend/src/modules/promotions/promotion.routes.ts` — checkout preflight + admin/analytics contracts.
- `promotion_records` — campaign definitions/projection.
- `promotion_usages` — reservation/use/release ledger.
- `0035_reward_history_reference_compatibility.sql` — keeps usage identifiers durable across legacy projection rebuilds.

## Dart Card

- `backend/src/modules/loyalty/dart-card-draw.service.ts` — monthly ranking: pieces DESC, net spending DESC; exact top ties produce up to 3 winners, with random selection of 3 only when 4+ customers tie exactly.
- `backend/src/modules/loyalty/dart-card-draw.routes.ts` — preview/run/history + scheduler-neutral internal endpoint.
- `dart_card_draws` / `dart_card_draw_events` — idempotent period result and audit trail; legacy first-winner fields remain for compatibility.
- `dart_card_draw_winners` — immutable one-to-many winner history with 1–3 winners per completed draw.
- `loyalty_cards` — active Dart Card projection used by Commerce/UI.
- `0036_dart_card_active_concurrency_lock.sql` — per-customer advisory lock that closes concurrent duplicate-card races.

## Settings

- `backend/src/modules/settings/site-settings.schema.ts` — strict known Settings schema + explicit public allowlist.
- `backend/src/modules/settings/site-settings.routes.ts` — public/admin Settings API.
- `backend/src/modules/settings/site-settings.service.ts` — versioned audited PostgreSQL updates.

## Regression tests

- `backend/tests/rewards-promotions-settings.contract.test.ts`
- `backend/tests/reward-integrity-migrations.contract.test.ts`
- `backend/tests/social-auth-and-draw.contract.test.ts`
- `backend/tests/openapi-current-contract.test.ts`
- `tests/auth-contract.js`
- `tests/full-site-browser.js`

## Frontend compatibility

- `src/runtime-layout.json` — ordered sources for `Eye/dart.js` and `Js/dart-platform.js`. Edit the source units, then run `npm run build:js`; their existing URLs, scopes and startup sequence are preserved.
- `src/README.md` — source ownership and generated-runtime map.
- `scripts/build-source-runtime.cjs` — deterministic composition and syntax validation before the existing Home minification build.

- `Js/dart-platform.js` — API-backed storefront/customer projections, including Birthday UI state.
- `Js/dart-auth-social.js` — Customer Google/Facebook UI completion; no provider secret/token persistence.
- `Js/dart-password-visibility.js` — accessible password visibility plus Customer 6+ UI normalization for signup/change/reset/social forms.
- `Js/dart-site-settings.js` — Settings normalization/cache for the Vanilla frontend.

## Dashboard groups and private content

- `Eye/dart.js` — compact date/location order groups; authorized Sets preparation after dashboard hydration.
- `Eye/dart-inventory.js` / `Eye/dart-inventory.css` — Model/Color/Size group cards with a label beside every lifecycle count.
- `Eye/dart-waiting.js` — Queue/Demand rows own their field labels; neither needs a `thead`.
- `src/dashboard/dashboard-ui.js` → `Eye/dart-dashboard-ui.js` — record summaries/details, owning-panel labels and Waiting layout.
- `src/dashboard/news-admin.js` → `Eye/dart-news-admin.js` — authenticated in-memory News projection, query/pagination and stale-response protection.
- `src/dashboard/sets-admin.js` → `Eye/dart-sets-admin.js` — authenticated in-memory Sets projection and the existing editors/actions.
- Build these delivery modules with `node scripts/build-home-runtime.cjs`. Edit the readable sources; generated `Eye` files carry their source SHA256.
- `tests/dashboard-groups-browser.cjs` — production renderers with isolated fixtures: responsive groups, Waiting details/actions, private prefetch, retries, concurrent reads and logout.

Business decisions must remain in the backend/DB. Frontend code may display state and send intents, but cannot manufacture inventory availability, discounts, rewards, permissions or financial truth.
