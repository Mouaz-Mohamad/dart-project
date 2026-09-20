# Dart backend foundation and Identity/Auth

This folder is the server-authoritative Node.js/Express/TypeScript backend. The platform foundation and Identity/Auth slice are implemented. The existing Vanilla storefront, representative portal and Dart Eye login gate use `/api/v1` when `window.DART_API_BASE_URL` is configured; unrelated business flows remain on their documented prototype adapters until their own phase is approved.

## Local setup

1. Copy `.env.example` to `.env` and keep the file uncommitted.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Apply migrations: `npm run db:migrate`.
5. Start the API: `npm run dev`.

The API listens on `http://localhost:4000` by default. Check `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for PostgreSQL readiness.

## Vercel deployment

Vercel detects `src/server.ts` as the Express entrypoint and captures its HTTP listener as one Vercel Function. Keep the Vercel project Root Directory set to `backend`; do not set a custom Build Command or Output Directory. The complete production checklist and required environment variables are in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).

Database migrations and the first Owner bootstrap are deliberate one-time operations. They are never run automatically during a Vercel build or Function startup.

## Create the protected Owner account

After migrations, set `DART_OWNER_NAME`, `DART_OWNER_EMAIL`, `DART_OWNER_PHONE` and a strong `DART_OWNER_PASSWORD` in the local environment, then run:

```bash
npm run admin:bootstrap-owner
```

The command refuses to create a second Owner. Remove `DART_OWNER_PASSWORD` from `.env` after it succeeds. The first dashboard login requires Google Authenticator or Microsoft Authenticator setup before protected staff actions are available.

## Identity/Auth behavior

- Customer registration queues a six-digit Email OTP in the transactional outbox. OTP parameters are encrypted at rest; a real Email delivery worker/provider must consume the outbox before production.
- Passwords use Argon2id and a 12-character policy. Staff MFA secrets use AES-256-GCM with `MFA_ENCRYPTION_KEY`.
- Server sessions are hashed, rotating, revocable per device, and transported in HttpOnly cookies. State-changing authenticated requests require the matching CSRF header.
- Customer, Staff and Representative are separate account realms, so the same verified person can use the same contact detail in customer and representative accounts without weakening uniqueness inside either realm.
- Representative registration intentionally returns `503` until encrypted private document storage, MIME inspection and malware scanning are configured. It never saves an incomplete application.

## Development seed

Synthetic data is disabled by default and forbidden in Production. To run the current foundation seed, set `ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed:dev`. The seed is idempotent and clearly marks its records as synthetic. Business-domain seed data will be added only alongside the matching domain tables.

## Migrations

- Apply all pending migrations: `npm run db:migrate`.
- Apply exactly the next pending migration: `npm run db:migrate:one -- 0002_identity_auth`.

Applied migration checksums are recorded in `dart_schema_migrations`. Editing an already-applied migration is rejected; add a new migration instead.

## Current scope and boundaries

Identity/Auth, sessions, basic deny-by-default roles, Owner TOTP, customer Email OTP, reset requests and representative approval boundaries are present. Granular employee permission editing, catalogue, inventory, orders, notifications delivery workers and representative private-document storage remain separate approved increments.


## Transactional outbox retries on Vercel Hobby

The API keeps immediate event dispatch for normal transactional flows. The Vercel Cron entry is only a daily safety retry because the Hobby plan accepts schedules that run at most once per day. Faster retry cadence must come from an external scheduler such as the existing n8n automation layer calling the protected outbox processor endpoint.

The protected processor is `POST /api/v1/internal/outbox/process` with `Authorization: Bearer <OUTBOX_CRON_SECRET>`. Keep that secret server-side only. Failed outbox rows keep their own retry timing and are safe to claim concurrently through PostgreSQL locking.
