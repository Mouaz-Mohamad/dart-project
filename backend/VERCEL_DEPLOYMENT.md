# Dart API — Vercel deployment

The backend project root is `backend/` and production runs on Node 24.

## Production build

`backend/vercel.json` runs database migrations during the production build and then builds TypeScript. Runtime cold starts do **not** run migrations. This prevents a missing `/var/task/migrations` directory from crashing every API route.

Required deployment checks:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run check:env` with the production environment loaded
6. `npm run db:migrate` against the target Neon database when not using the Vercel production build hook

Never edit an already-applied migration. New migrations start at `0023_*` or above and use a new prefix.

## Environment variable names

Core:
- `NODE_ENV`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_POOL_MAX`
- `CORS_ORIGINS`
- `AUTH_PEPPER`
- `MFA_ENCRYPTION_KEY`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SAME_SITE`
- `SESSION_TTL_DAYS`
- `EMAIL_OTP_TTL_MINUTES`
- `STAFF_INVITE_OTP_TTL_HOURS`
- `STAFF_GOOGLE_AUTH_ENABLED`
- `STAFF_LEGACY_AUTH_ENABLED` (keep `true` only during Phase 1 rollback testing)
- `STAFF_LEGACY_AUTH_UI_ENABLED` (normally `false`)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_AUTH_TIMEOUT_MS`
- `GOOGLE_CLIENT_ID`
- `OUTBOX_CRON_SECRET` or `CRON_SECRET`
- `OUTBOX_BATCH_SIZE`

Dart Eye Google/Supabase identity:

- Configure the Google OAuth Web Client ID/Secret in Google + Supabase. The Google Client Secret stays there and is never a frontend or Git variable.
- Add the production storefront origin and localhost development origin to Google Authorized JavaScript origins.
- Enable Google in Supabase Auth. Dart Eye uses Supabase Auth only to prove identity.
- The frontend receives only public values from `GET /api/v1/admin/auth/google/config`; no Vercel frontend secret is required.
- Do **not** add `SUPABASE_SERVICE_ROLE_KEY` for this login flow. The backend verifies the presented session through Supabase Auth and then creates the normal Dart session.
- Keep the protected Owner allowlist at `midomoaaz3@gmail.com` for first production sign-in. `dart.official.eg@gmail.com` remains the notification sender and is not a dashboard Owner unless explicitly added later.

Email:
- `EMAIL_PROVIDER=smtp`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME` (default: `Dart | for you`)

WhatsApp remains optional for approved notification flows:
- `WHATSAPP_CLOUD_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_OWNER_PHONE`
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_TEMPLATE_LANGUAGE`

Do not store or document environment values in Git. Never put a Google Client Secret, Supabase service-role key, access token, refresh token or Dart session token in frontend code, logs, commits or support/chat messages.

## Health

- `GET /api/v1/health/live` returns 200 for a correctly configured process.
- Invalid production configuration returns 503 with only `{"status":"misconfigured"}`; invalid field names are written only to server logs.
- `GET /api/v1/health/ready` returns 200 only when PostgreSQL responds.

## Outbox retry processor

Immediate delivery is attempted after the database transaction commits. Failed email/WhatsApp events remain in `outbox_events` with exponential backoff.

Safety-net endpoint:

`GET|POST /api/v1/internal/outbox/process`

Authorization:

`Authorization: Bearer <OUTBOX_CRON_SECRET>`

If the Vercel plan cannot schedule the needed retry frequency, call this endpoint every five minutes from a trusted external scheduler. Never expose the cron secret to browser JavaScript.
