# Deploy the Dart API on Vercel

This backend is an Express/TypeScript application. Vercel recognizes `src/server.ts` and deploys it as one Node.js Function. No adapter, custom build command, output directory, or `vercel.json` is required.

## Project settings

- Project name: `dart-api`
- Git branch: `main`
- Root Directory: `backend`
- Framework Preset: Express (automatic detection)
- Build Command: leave empty/default
- Output Directory: leave empty/default
- Install Command: leave empty/default (`npm install` uses `package-lock.json`)
- Node.js: 24.x, matching `package.json`

## Required Production environment variables

Add these in Vercel. Never paste their values into chat, source code, screenshots, or Git history.

| Key | Production value or rule |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Injected by the Neon integration connected to the `dart-api` project |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `3` initially to limit connections per Function instance |
| `CORS_ORIGINS` | `https://dart-project-psi.vercel.app` initially; comma-separate future approved origins |
| `TRUST_PROXY_HOPS` | `1` |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `RATE_LIMIT_MAX` | `120` |
| `LOG_LEVEL` | `info` |
| `ALLOW_DEVELOPMENT_SEED` | `false` |
| `AUTH_PEPPER` | A new cryptographically random secret of at least 32 characters |
| `MFA_ENCRYPTION_KEY` | Exactly 32 random bytes encoded as Base64 |
| `SESSION_COOKIE_NAME` | `dart_session` |
| `SESSION_COOKIE_SAME_SITE` | `none` while the storefront and API use separate `*.vercel.app` hostnames |
| `SESSION_TTL_DAYS` | `30` |
| `EMAIL_OTP_TTL_MINUTES` | `10` |

Use `SESSION_COOKIE_SAME_SITE=strict` after the storefront and API are placed on same-site custom domains such as `www.example.com` and `api.example.com`. Cross-site cookies use `SameSite=None; Secure`; CSRF verification and the exact CORS allowlist remain mandatory.

Do not add `DART_OWNER_PASSWORD` as a permanent Vercel variable. Owner bootstrap is a controlled one-time command, and the password must be removed immediately after it succeeds.

## Deployment order

1. Push the reviewed source to GitHub.
2. Create `dart-api` from the same repository with Root Directory `backend`.
3. Connect the existing Neon database to `dart-api`, producing `DATABASE_URL` there.
4. Add the remaining Production variables above.
5. Deploy and call `/api/v1/health/live`; it must return HTTP 200.
6. Run `npm run db:migrate` once against the production `DATABASE_URL` from a controlled environment.
7. Call `/api/v1/health/ready`; it must return HTTP 200 with the database check up.
8. Run `npm run admin:bootstrap-owner` once, then remove the bootstrap password.
9. Configure the storefront's API base URL and verify login, cookie, CSRF, logout, and MFA end to end.

## Important boundaries

- A successful deployment does not run or prove the database migrations.
- Email OTP is queued in the transactional outbox, but customer delivery still requires the approved email provider/worker.
- Representative registration remains closed until encrypted document storage, MIME inspection, and malware scanning are configured.
- Never enable development seed data in Production.
