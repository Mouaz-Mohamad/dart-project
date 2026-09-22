# Dart Eye Google/Supabase Staff Auth — Dart Quality Review

Review date: 2026-09-22  
Scope: Owner/Admin/Staff authentication for Dart Eye only. Customer and Representative authentication remain unchanged.

| # | Review area | Result | Evidence |
|---|---|---|---|
| 1 | State coverage | PASS | Google loading state is explicit; Staff/Pending access lists have empty states; provider/network/authorization errors are generic and non-leaking; the dashboard stays locked when the API is unavailable, incompatible, or required hydration fails. |
| 2 | Server authority | PASS | Google/Supabase prove identity only. Dart PostgreSQL remains authoritative for Staff allowlist, Active/Disabled status, Owner protection, permissions and the Dart session. Frontend permission rendering is not authorization. |
| 3 | Concurrency & races | PASS | First Google link uses PostgreSQL advisory locks for normalized email and provider subject plus row locks and unique constraints. Pending allowance creation uses an email lock and idempotent retry. Permission mutation is serialized per Staff account. Access/relink operations lock target rows. |
| 4 | Validation & authorization | PASS | Routes use server-side Zod validation, existing authenticated-session middleware, CSRF, account-type checks and permission middleware. Sensitive Staff management additionally verifies the protected Owner server-side. Disable requires a reason; Gmail relink requires an explicit 8–500 character reason. Unauthorized Google identities get the same non-enumerating 403 message. |
| 5 | Idempotency | PASS | Concurrent first login resolves to one Staff row. Repeating an identical pending Gmail allowance returns the same allowance. Repeating the same permission set or the same Active/Disabled state is a no-op and does not revoke a valid session unnecessarily. Session revocation is safe to repeat. |
| 6 | Audit & observability | PASS | Allowlist changes, unauthorized attempts, identity linking/conflicts, Google login, permissions, status, session revocation, relink and Owner break-glass are audited. State transitions use append-only `audit_logs.old_values/new_values`; sensitive emails are represented by keyed hashes, not raw addresses. Session revocation records the number of sessions revoked. |
| 7 | Cost & external-service awareness | N/A / PASS | This change introduces no WhatsApp or paid transactional-message send. Google/Supabase are used only for identity verification at sign-in, not on every Dart API request. Provider subscription/usage limits remain an external account concern; no per-message commerce cost is introduced. |
| 8 | Regression safety | PASS | Customer and Representative auth contracts are untouched. Legacy Staff auth remains hidden behind Phase-1 rollback flags. Backend CI, frontend regression contracts and full Chromium storefront/dashboard smoke pass on the final branch. |
| 9 | Tests | PASS | Google verifier: valid identity, wrong project, expired/wrong audience, non-OAuth, anonymous, unverified email, non-Google/mixed provider, subject/email mismatch, invalid signature and provider outage. PostgreSQL integration: Owner seed/link/re-login, unauthorized Gmail, concurrent first login, subject conflict, permission update + idempotent retry, disable/reactivate + idempotent retry, session revoke/logout and DB-level Owner protection. Route tests: Google config fail-closed, legacy 410, public Supabase key cannot act as Dart session. Frontend tests: token non-persistence, CSP/security boundaries, auth contract, storage authority and Chromium smoke. |
| 10 | Secrets | PASS | No Google Client Secret, Supabase service-role key, access token, refresh token, private key or Dart session token is committed. Supabase tokens are not persisted in browser storage. Request-body token fields are explicitly redacted from logs. A compare-level secret-pattern scan found no introduced secret material. |

## Final verification evidence

Final feature-branch head before this review: `2d843cf50dc2f1f721e780dfdee0e9e29dd4e17b`.

- Backend CI (pull request): **PASS** — PostgreSQL 17, production dependency audit, ESLint, TypeScript `tsc --noEmit`, Vitest integration/unit suite and browser-JavaScript syntax.
- Backend CI (branch push): **PASS**.
- Frontend CI: **PASS** — static regression/security/performance contracts and full Chromium storefront/dashboard smoke.
- Production dependency audit reported **0 vulnerabilities**.
- Live-Supabase integration is intentionally conditional and is skipped when real test-project credentials are not supplied to CI. It is documented as part of the manual E2E gate before production activation.

## Release gate

Phase 1 code is repository-ready. Production activation still requires the external Google OAuth + Supabase Auth configuration and a real Owner E2E login with `midomoaaz3@gmail.com`.

Do not begin Phase 2 deletion of legacy Staff password/OTP/TOTP code until the real Owner login, logout/re-login, unauthorized-account rejection, Staff disable/permission invalidation and rollback path have been exercised successfully.
