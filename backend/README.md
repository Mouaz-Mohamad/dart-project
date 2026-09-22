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

Vercel detects `src/server.ts` as the Express entrypoint and captures its HTTP listener as one Vercel Function. Keep the Vercel project Root Directory set to `backend`; do not set a custom Build Command or Output Directory. The complete production checklist and required environment variables are in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).

Database migrations are deliberate deployment operations. Dart Eye Staff identity now uses Google through Supabase Auth, while Dart PostgreSQL and the existing session/permission engine remain authoritative.

## Protected Owner and Staff Google login

Migration `0024_staff_google_identity.sql` guarantees a pending Owner Google allowlist entry for `midomoaaz3@gmail.com` when no Owner exists. The first successful Google sign-in links the Supabase user ID and immutable Google provider subject to that Owner inside a transaction, assigns the existing Owner role and creates the normal secure Dart session. No Staff password, Dart OTP or app-level TOTP is required for the Google path.

The normal Dart Eye flow is:

```text
Continue with Google
  -> Google Identity Services
  -> Supabase Auth (identity proof only)
  -> POST /api/v1/admin/auth/google/exchange
  -> PostgreSQL Staff allowlist/status/subject binding
  -> Dart Secure HttpOnly session + existing API permissions
```

Customer and representative authentication are unchanged.

Phase 1 keeps the old Staff password/onboarding/TOTP routes behind `STAFF_LEGACY_AUTH_ENABLED=true` for rollback. Their UI stays hidden unless `STAFF_LEGACY_AUTH_UI_ENABLED=true`. After the real Owner Google login has been tested and approved, Phase 2 sets the legacy flag to false, returns `410 Gone` from those Staff-only routes, then removes their dead code in a later cleanup migration.

### Owner break-glass recovery

If the Owner loses access to the linked Google account, run this only from an authorized server/administrative environment:

```bash
npm run admin:recover-owner-google -- --email replacement-owner@gmail.com --reason "Google account recovery"
```

This is not a public endpoint, contains no fixed recovery password, cannot create a second Owner, revokes Owner sessions, clears the previous Google identity binding and writes attempted/succeeded/failed audit events. Do not put secrets or recovery credentials in the command, Git, logs or chat.

## Identity/Auth behavior

- Google and Supabase prove Dart Eye identity only. Dart PostgreSQL remains the authority for Staff allowlist, Active/Disabled state and permissions.
- The browser Supabase client uses `persistSession:false` and `autoRefreshToken:false`. A Supabase access token is sent only to the exchange endpoint and is never returned after the Dart session is created.
- The backend accepts Staff Google identity only from the configured Dart Supabase project and requires a verified Google-only identity. Provider-subject conflicts are rejected and audited.
- Customer registration still queues a six-digit Email OTP in the transactional outbox. Customer/representative password behavior is unchanged.
- Server sessions are hashed, rotating, revocable per device, transported in HttpOnly cookies and protected by CSRF on state-changing authenticated requests.
- Disabling Staff or changing Staff permissions increments `session_version` and revokes active sessions so the next API request cannot retain stale access.
- Customer, Staff and Representative remain separate account realms.
- Representative registration continues to validate JPG/PNG/WebP magic bytes and store accepted verification documents encrypted in PostgreSQL.

## Development seed

Synthetic data is disabled by default and forbidden in Production. To run the current foundation seed, set `ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed:dev`. The seed is idempotent and clearly marks its records as synthetic. Business-domain seed data will be added only alongside the matching domain tables.

## Migrations

- Apply all pending migrations: `npm run db:migrate`.
- Apply exactly the next pending migration: `npm run db:migrate:one -- 0002_identity_auth`.

Applied migration checksums are recorded in `dart_schema_migrations`. Editing an already-applied migration is rejected; add a new migration instead.

## Current scope and boundaries

Return creation locks the shared return domain inside the PostgreSQL transaction. Exchange-chain identity is resolved server-side across replacement Item Codes, and courier-fee policy is snapshotted when the request is created.

Identity/Auth, Google-first Dart Eye Staff login, secure Dart sessions, deny-by-default permissions, customer Email OTP, representative encrypted documents, catalogue/inventory, orders, finance and database-backed dashboard state are present. The main remaining architecture hardening is to normalize high-value JSONB dashboard domains (especially returns/damage/finance operations), complete external notification providers, and keep expanding real-browser/load/restore verification.


## Transactional outbox retries on Vercel Hobby

The API keeps immediate event dispatch for normal transactional flows. The Vercel Cron entry is only a daily safety retry because the Hobby plan accepts schedules that run at most once per day. Faster retry cadence must come from an external scheduler such as the existing n8n automation layer calling the protected outbox processor endpoint.

The protected processor is `POST /api/v1/internal/outbox/process` with `Authorization: Bearer <OUTBOX_CRON_SECRET>`. Keep that secret server-side only. Failed outbox rows keep their own retry timing and are safe to claim concurrently through PostgreSQL locking.


## Email and Staff access

Staff Google access no longer depends on SMTP, OTP or a password. SMTP remains in place for customer verification and customer/order notifications. WhatsApp remains optional and is not required for Owner or Staff sign-in. Configure only the notification email variables documented in `VERCEL_DEPLOYMENT.md`.

Dashboard server polling starts only after authentication. Public site-settings checks are conditional with ETag and are throttled to at least 60 seconds while the tab is visible.
