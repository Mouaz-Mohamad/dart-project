# Dart backend foundation and Identity/Auth

This folder is the server-authoritative Node.js/Express/TypeScript backend. Identity/Auth, catalogue, inventory, cart reservations, orders, customer commerce, representative workflows, site settings, finance summaries, dashboard domain persistence and transactional outbox delivery are implemented behind `/api/v1`. The Vanilla storefront, representative portal and Dart Eye consume these server contracts while keeping only transient browser UI/session state locally.

## Local setup

1. Copy `.env.example` to `.env` and keep the file uncommitted.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Apply migrations: `npm run db:migrate`.
5. Start the API: `npm run dev`.

The API listens on `http://localhost:4000` by default. Check `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for PostgreSQL readiness.

## Vercel deployment

Vercel detects `src/server.ts` as the Express entrypoint and captures its HTTP listener as one Vercel Function. Keep the Vercel project Root Directory set to `backend`. The complete production checklist and required environment variables are in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).

Dart PostgreSQL/Neon remains authoritative for Staff access, roles, granular permissions and sessions.

## Dart Eye Staff access

The active Staff flow is deliberately simple:

```text
Owner manually allows Email + Role (+ Staff permissions)
  -> Employee enters the allowed email
  -> Dart sends a six-digit email verification code
  -> Dart verifies the one-time code server-side
  -> Dart creates the existing Secure HttpOnly session
  -> PostgreSQL permissions control every dashboard/API action
```

There is no Google OAuth, Supabase Auth, Staff password or Staff TOTP in the active Dart Eye flow.

Migration `0025_staff_simple_email_access.sql` converts the pending protected Owner allowance to `email_otp`, disables Staff MFA requirements for this flow and creates replay-safe one-time Staff email challenges. The protected Owner remains single and cannot be disabled, deleted or demoted.

The Owner manages dashboard access from Settings using:
- allowed email,
- role: `Owner` or `Staff`,
- granular API/action permissions for Staff,
- Active/Disabled state,
- session revocation.

Unknown emails receive the same generic request response as allowed emails. Verification codes expire, have limited attempts, are hashed in the challenge table and are encrypted inside the transactional outbox payload until delivery. Permission changes and access disabling revoke current sessions immediately.

Customer and representative authentication are unchanged.

## Identity/Auth behavior

- Dart PostgreSQL is the authority for Staff allowlist, Active/Disabled state, roles and permissions.
- Server sessions are hashed, rotating, revocable per device, transported in HttpOnly cookies and protected by CSRF on state-changing authenticated requests.
- Customer registration still queues a six-digit Email OTP in the transactional outbox.
- Customer/representative password behavior is unchanged.
- Customer, Staff and Representative remain separate account realms.
- Representative registration continues to validate JPG/PNG/WebP magic bytes and store accepted verification documents encrypted in PostgreSQL.

## Development seed

Synthetic data is disabled by default and forbidden in Production. To run the current foundation seed, set `ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed:dev`.

## Migrations

- Apply all pending migrations: `npm run db:migrate`.
- Apply exactly the next pending migration: `npm run db:migrate:one -- <migration-name>`.

Applied migration checksums are recorded in `dart_schema_migrations`. Editing an already-applied migration is rejected; add a new migration instead.

## Current scope and boundaries

Return creation locks the shared return domain inside the PostgreSQL transaction. Exchange-chain identity is resolved server-side across replacement Item Codes, and courier-fee policy is snapshotted when the request is created.

Identity/Auth, simplified Dart Eye Staff email access, secure Dart sessions, deny-by-default permissions, customer Email OTP, representative encrypted documents, catalogue/inventory, orders, finance and database-backed dashboard state are present.

## Transactional outbox retries

The API keeps immediate event dispatch for normal transactional flows. The Vercel Cron entry is a safety retry. Faster retry cadence can come from a trusted external scheduler calling the protected outbox processor endpoint.

The protected processor is `POST /api/v1/internal/outbox/process` with `Authorization: Bearer <OUTBOX_CRON_SECRET>`. Keep that secret server-side only.

## Email

SMTP is required for Dart Eye Staff verification and customer email verification. Configure the server-only email variables documented in `VERCEL_DEPLOYMENT.md`. WhatsApp remains optional and is not required for Owner or Staff sign-in.

Dashboard server polling starts only after authentication.
