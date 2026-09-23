# Dart backend

`backend/` is the server-authoritative Node.js/Express/TypeScript API for Dart | for you. PostgreSQL is the source of truth for Identity/Auth, catalogue, inventory, cart reservations, orders, returns, customer rewards, Promotions, Dart Card draws, Settings, finance, permissions and transactional outbox delivery. Browser storage is UI/cache only and must never decide stock, discounts, permissions or financial state.

## Local setup

1. Copy `.env.example` to `.env` and keep it uncommitted.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Apply migrations: `npm run db:migrate`.
5. Start the API: `npm run dev`.

The API listens on `http://localhost:4000` by default. Use `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for PostgreSQL readiness.

## Identity and access

Customer registration creates the account/session directly and requires Birthday. Signup is **not** gated by a customer Email OTP. Email OTP remains available for explicit verification/password-recovery flows.

Password policies are intentionally different by account type:

- Customer: minimum **6 characters**. Any character composition is accepted, including letters, numbers, symbols, spaces and non-Latin text.
- Representative: minimum 12 characters containing lowercase, uppercase and a digit.
- Staff: passwordless; allowed Email + one-time Email code.

### Google and Facebook customer sign-in

Customer social sign-in is implemented as server-side OAuth authorization-code flow. Provider client secrets stay in backend environment variables and provider access/refresh tokens are not persisted.

Required environment fields are documented in `.env.example`:

- `API_PUBLIC_ORIGIN`
- `CUSTOMER_APP_ORIGIN`
- `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`
- `FACEBOOK_OAUTH_APP_ID` + `FACEBOOK_OAUTH_APP_SECRET`
- optional `FACEBOOK_GRAPH_API_VERSION`
- optional `SOCIAL_AUTH_TTL_MINUTES`

If a provider ID/secret pair is absent, that provider is safely reported as unavailable; a partial pair is treated as backend misconfiguration.

Every social completion requires **Dart Password + Confirm Password + Birthday**. A new Dart customer also provides Full Name + Primary Phone (Phone 2 optional). Returning customers must confirm their existing Dart password. Their saved Birthday is not silently replaced during login; the submitted Birthday only fills a legacy missing value. The secure Customer session is the same HttpOnly/CSRF session used by normal login.

Dart Eye Staff access remains separate:

```text
Owner allows Email + Role (+ permissions)
  -> Employee requests a six-digit email code
  -> Server verifies the one-time code
  -> Secure HttpOnly Staff session is issued
  -> PostgreSQL permissions authorize each dashboard/API action
```

There is no active Staff Google OAuth, Staff password or Staff TOTP flow. Staff email challenges are hashed, limited-attempt, expiring and audited. Permission changes/access disabling revoke sessions.

## Birthday reward integrity

Birthday reward authority is PostgreSQL, not the navbar/card/countdown UI.

- Birthday is required for every newly inserted Customer from migration `0038` onward.
- A customer can **use** the Birthday discount only once per Cairo Birthday year/occurrence.
- The usage row is unique by customer + reward year.
- The reservation is created atomically after the order row exists and becomes `Used` only when the order is `Delivered`.
- `Cancelled`/`Refused` releases the reservation while the Birthday window is still valid.
- Changing Birthday after that year's reward was used cannot create a second reward/message/countdown in the same reward year.
- Changing Birthday before using that year's reward clears the unused current-year projection; the new date can still receive that year's reward when its window arrives.
- The last successful use is recorded on the customer and in `birthday_discount_usage`.

## Promotions Engine

`PromotionService` evaluates eligibility server-side at Checkout. Campaign input is strictly validated and supports nested `AND`/`OR` rules over delivered order count, delivered/non-returned piece count, net delivered spending, days since last delivered order, selected Customer ID/client code, account age and Birthday day.

Campaigns also support start/end dates, automatic/code campaigns, priority, minimum order value, minimum quantity, category/model/product scope, total usage limit and per-customer usage limit. `promotion_usages` reserves usage atomically with order creation and finalizes it on `Delivered`; `Cancelled`/`Refused` releases it. Analytics are derived from the usage ledger and real orders.

Because the existing Commerce checkout applies one promotion percentage per order, a scoped campaign is eligible only when every cart line is inside its configured scope. This prevents accidental discounting of out-of-scope lines until line-level mixed-cart promotion allocation is introduced deliberately.

Admin contracts:

- `GET /api/v1/admin/promotions`
- `POST /api/v1/admin/promotions`
- `PUT /api/v1/admin/promotions/:id`
- `GET /api/v1/admin/promotions/:id/analytics`

## Dart Card monthly draw

The monthly draw is server-authoritative and idempotent per `YYYY-MM` period.

Ranking is exactly:

1. highest delivered/non-returned purchased piece count;
2. if piece count ties, highest net delivered spending;
3. if the top group is exactly tied on both values: one person wins alone, two both win, three all win, and if four or more tie exactly then three distinct customers are selected randomly from that exact-tie group.

Every selected winner receives an independent 40% Dart Card for up to 10 pieces or one year. `dart_card_draw_winners` records all winners while legacy first-winner fields remain on `dart_card_draws` for backward compatibility. Customers with `dart_card_draw_eligible=false` or an active, unexpired Dart Card with remaining piece capacity are excluded. Duplicate active cards are serialized and rejected at the database boundary.

Admin contracts:

- `GET /api/v1/admin/dart-card/draws/:period/preview`
- `POST /api/v1/admin/dart-card/draws/:period/run`
- `GET /api/v1/admin/dart-card/draws`

Scheduler-neutral automation endpoint:

- `POST /api/v1/internal/dart-card/monthly-draw`
- `Authorization: Bearer <OUTBOX_CRON_SECRET>`

It executes the previous Cairo month and is safe to retry because `dart_card_draws.period_key` is unique and the transaction uses an advisory lock.

## Settings contract

`PUT /api/v1/admin/site-settings` uses the central strict Zod schema in `site-settings.schema.ts`; unknown root keys are rejected. The public endpoint returns an explicit allowlist and never exposes the private `codRisk` policy. Writes remain optimistic-concurrency controlled through `expectedVersion` and audited.

## Migrations

- Apply all pending migrations: `npm run db:migrate`.
- Apply exactly the next pending migration: `npm run db:migrate:one -- <migration-name>`.

Applied migration checksums are recorded in `dart_schema_migrations`. Never edit or rename an applied migration; add a new unique four-digit migration. Historical duplicate prefixes `0013`, `0014` and `0015` are grandfathered only.

Current reward/social/draw integrity requires migrations `0034` through `0038`. Migration `0038` adds Social OAuth challenges/identity links, required-Birthday insertion guard and the one-to-many Dart Card draw winners table.

## Operational monitoring and internal jobs

Dart uses structured Pino logging, request IDs, secret redaction, centralized error responses, liveness/readiness checks and the transactional outbox. `MONITORING_ALERT_EMAIL` can receive sanitized owner-facing backend alerts.

The outbox retry endpoint remains `POST /api/v1/internal/outbox/process` with `Authorization: Bearer <OUTBOX_CRON_SECRET>`. The same server-only secret protects the scheduler-neutral Dart Card monthly draw endpoint. Never expose this secret or OAuth client secrets to storefront/dashboard JavaScript.

## Deployment note

Deployment is a separate operational action. Pushing application code or migrations does not mean production PostgreSQL has been migrated, OAuth providers configured, or an internal scheduler configured. Run migrations `0034`–`0038` through the existing migration runner and configure the provider callback/environment values in the target environment before enabling the new contracts.
