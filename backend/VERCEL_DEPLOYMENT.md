# Dart API — Vercel deployment

The backend project root is `backend/` and production runs on Node 24.

## Production build

`backend/vercel.json` runs database migrations during the production build and then builds TypeScript. Runtime cold starts do **not** run migrations.

Required deployment checks:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run check:env` with the production environment loaded
6. `npm run db:migrate` against the target Neon database when not using the Vercel production build hook

Never edit an already-applied migration. Add a new migration with the next numeric prefix.

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
- `OUTBOX_CRON_SECRET` or `CRON_SECRET`
- `OUTBOX_BATCH_SIZE`

## Dart Eye Staff access

Dart Eye does **not** require Google OAuth or Supabase Auth.

The Owner manually allows a dashboard email and chooses `Owner` or `Staff`. Staff permissions are stored in Dart PostgreSQL. On first access, and whenever a valid session is not present, the allowed email receives a six-digit verification code. A successful verification creates the normal secure Dart HttpOnly session.

The protected first Owner email is seeded by the database migrations. Customer and representative authentication are separate and unchanged.

Email delivery is therefore required for Dart Eye Staff verification in production:

- `EMAIL_PROVIDER=smtp`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME` (default: `Dart | for you`)

For Gmail SMTP, use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, and a Google App Password. Keep the App Password only in Vercel/server environment variables. Never put it in Git, frontend JavaScript, logs or support/chat messages.

WhatsApp remains optional for approved notification flows:
- `WHATSAPP_CLOUD_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_OWNER_PHONE`
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_TEMPLATE_LANGUAGE`

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

If the Vercel plan cannot schedule the needed retry frequency, call this endpoint from a trusted external scheduler. Never expose the cron secret to browser JavaScript.
