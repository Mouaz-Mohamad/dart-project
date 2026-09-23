# Dart Code Map

## Backend entry and wiring

- `backend/src/app.ts` — creates runtime services and PostgreSQL-backed modules.
- `backend/src/application.ts` — mounts middleware and `/api/v1` routers.
- `backend/src/database/migrate.ts` — ordered immutable migration runner.
- `backend/openapi.yaml` — declared HTTP contract.

## Identity / Security

- `backend/src/modules/identity/identity.routes.ts` — customer/representative/admin identity HTTP boundaries.
- `backend/src/modules/identity/identity.service.ts` — identity/session/account business logic.
- `backend/src/security/password.ts` — shared Customer/Representative strong password policy + Argon2id.
- `backend/src/middleware/authentication.ts` — sessions, CSRF, MFA/permission gates.

## Commerce

- `backend/src/modules/commerce/commerce.routes.ts` — cart/order/returns/customer commerce routes.
- `backend/src/modules/commerce/commerce.service.ts` — authoritative inventory reservation, checkout, pricing, reward priority and order transitions.
- `backend/src/modules/commerce/cod-risk.ts` — COD risk decision engine.

## Birthday integrity

- `backend/migrations/0034_rewards_promotions_draw_integrity.sql`
  - `birthday_discount_usage` unique customer/year ledger.
  - final use only on Delivered.
  - release on Cancelled/Refused.
  - birthday edit cleanup/lock behavior + audit.
- `backend/migrations/0037_reward_reservation_after_order_insert.sql`
  - reserves Birthday/Promotion usage only after the Order row exists while remaining inside the same transaction.
- Existing `birthday_rewards` remains the UI/business projection consumed by Commerce/Storefront.

## Promotions

- `backend/src/modules/promotions/promotion.service.ts` — dynamic eligibility rules, cart scope, usage checks, admin writes and analytics.
- `backend/src/modules/promotions/promotion.routes.ts` — checkout preflight + admin/analytics contracts.
- `promotion_records` — campaign definitions/projection.
- `promotion_usages` — reservation/use/release ledger.
- `0035_reward_history_reference_compatibility.sql` — keeps usage identifiers durable across legacy projection rebuilds.

## Dart Card

- `backend/src/modules/loyalty/dart-card-draw.service.ts` — monthly ranking: pieces DESC, net spending DESC, audited random only for exact ties.
- `backend/src/modules/loyalty/dart-card-draw.routes.ts` — preview/run/history + scheduler-neutral internal endpoint.
- `dart_card_draws` / `dart_card_draw_events` — idempotent period result and audit trail.
- `loyalty_cards` — active Dart Card projection used by Commerce/UI.
- `0036_dart_card_active_concurrency_lock.sql` — per-customer advisory lock that closes concurrent duplicate-card races.

## Settings

- `backend/src/modules/settings/site-settings.schema.ts` — strict known Settings schema + explicit public allowlist.
- `backend/src/modules/settings/site-settings.routes.ts` — public/admin Settings API.
- `backend/src/modules/settings/site-settings.service.ts` — versioned audited PostgreSQL updates.

## Regression tests

- `backend/tests/rewards-promotions-settings.contract.test.ts`
- `backend/tests/reward-integrity-migrations.contract.test.ts`
- `backend/tests/openapi-current-contract.test.ts`

## Frontend compatibility

- `Js/dart-platform.js` — API-backed storefront/customer projections, including Birthday UI state.
- `Js/dart-site-settings.js` — Settings normalization/cache for the Vanilla frontend.

Business decisions must remain in the backend/DB. Frontend code may display state and send intents, but cannot manufacture inventory availability, discounts, rewards, permissions or financial truth.
