# Dart Eye Google/Supabase Staff Auth — manual E2E guide

This guide is for Phase 1 only. It must be completed before disabling the legacy Staff rollback routes.

## Architecture under test

```text
Google Identity Services
  -> Supabase Auth
  -> POST /api/v1/admin/auth/google/exchange
  -> Dart PostgreSQL Staff allowlist + identity binding
  -> Dart Secure HttpOnly session
  -> existing Dart API permission middleware
```

Supabase is identity proof only. Dart PostgreSQL and the existing backend remain authoritative for account state, permissions and sessions.

## Configuration ownership

| Setting | Frontend Vercel | dart-api Vercel | Supabase / Google |
| --- | --- | --- | --- |
| `SUPABASE_URL` | No secret; supplied by Dart API config endpoint | Yes | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | No secret; supplied by Dart API config endpoint | Yes | Public/publishable key |
| `SUPABASE_PROJECT_REF` | No | Yes | Supabase project ref |
| `GOOGLE_CLIENT_ID` | No secret; supplied by Dart API config endpoint | Yes | Same Web Client ID configured in Supabase |
| Google Client Secret | Never | Never | Google + Supabase provider configuration only |
| `SUPABASE_SERVICE_ROLE_KEY` | Never | Not required | Do not add for this flow |
| `STAFF_GOOGLE_AUTH_ENABLED` | No | Yes | — |
| `STAFF_LEGACY_AUTH_ENABLED` | No | Yes | — |
| `STAFF_LEGACY_AUTH_UI_ENABLED` | No | Yes | — |

Do not paste secret values into Git, logs, issue comments or chat.

## Google setup

1. Create/select the Dart Google Cloud project.
2. Configure the OAuth consent/audience appropriate for the Dart admin users.
3. Create a Web application OAuth client.
4. Add the real Dart Eye production origin under Authorized JavaScript origins.
5. Add the local development origin, for example `http://localhost:4173`.
6. Add the Supabase Auth callback URI shown in the Supabase Google provider page to Google's Authorized redirect URIs.
7. Keep the Google Client Secret only in Google/Supabase provider configuration.

## Supabase setup

1. Use one dedicated Supabase project for Dart Auth identity.
2. Enable the Google provider.
3. Configure the same Google Web Client ID and Client Secret.
4. Keep normal Auth signup enabled so an allowlisted Gmail can create its Supabase identity on first Google sign-in.
5. Dart authorization does **not** come from Supabase Auth users or metadata; an unlisted user must still be rejected by the Dart exchange endpoint.
6. Do not move Dart orders/products/customers into Supabase as part of this change.

## dart-api Vercel variables

Configure, without sharing values:

```text
STAFF_GOOGLE_AUTH_ENABLED=true
STAFF_LEGACY_AUTH_ENABLED=true
STAFF_LEGACY_AUTH_UI_ENABLED=false
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_PROJECT_REF
GOOGLE_CLIENT_ID
```

Keep the existing production `DATABASE_URL`, `AUTH_PEPPER`, session, CORS, email and commerce variables unchanged.

For separate frontend/API Vercel projects, keep the current cross-site cookie policy that is already validated by the project and ensure the exact frontend origin remains in `CORS_ORIGINS`.

## Required Owner test

The protected Owner is:

```text
midomoaaz3@gmail.com
```

The brand notification address `dart.official.eg@gmail.com` is not an Owner and must be rejected unless the Owner later adds it explicitly as Staff.

1. Apply migration `0024_staff_google_identity.sql`.
2. Open Dart Eye in a private/incognito window.
3. Confirm the only normal sign-in action is **Continue with Google**.
4. Choose `midomoaaz3@gmail.com`.
5. Confirm the dashboard opens without a Dart password, Dart OTP, Forgot Password flow or app-level TOTP.
6. Confirm `GET /api/v1/me` returns `accountType=staff`.
7. Confirm a secure `dart_session` HttpOnly cookie exists.
8. Confirm there is no Supabase access token or refresh token in Local Storage or Session Storage.
9. Log out.
10. Confirm the Dart session is revoked and the dashboard is locked.
11. Sign in again with the same Google account.
12. Confirm the same Staff/Owner record is reused and no second Owner is created.

## Rejection tests

Run each in a private/incognito window:

- Use a Gmail not in the Dart Staff allowlist. Expect: `This Google account is not authorized to access the Dart dashboard.`
- Close/cancel Google sign-in. The dashboard must remain locked and the Google button must remain usable.
- Disable a Staff account from Dart Eye, then retry an API request from its old browser. The next request must fail.
- Change a Staff permission and verify the old session is revoked; after new Google sign-in the updated permission set must be enforced.
- Attempt to call a protected admin API with the public Supabase key but no Dart session. It must not return protected data.
- Attempt direct browser edits to displayed role/permission values. They must not grant backend access.

## Staff lifecycle test

1. As Owner, open Settings -> Staff Access.
2. Add employee name, allowed Gmail and selected API permissions.
3. Confirm no OTP/password email is sent.
4. Confirm the entry says it is waiting for first Google sign-in.
5. Sign in with that exact Gmail and confirm Google becomes Linked.
6. Confirm Last Google login is populated.
7. Revoke all sessions and verify access ends.
8. Disable Staff and verify both old sessions and a fresh Google exchange are rejected.
9. Reactivate Staff and verify a fresh Google sign-in works.
10. Use Change Gmail / relink with an explicit reason. Confirm old sessions are revoked and the old identity no longer works.
11. Confirm the Owner account has no disable/delete/relink controls.

## Rollback test before Phase 2

During Phase 1:

```text
STAFF_LEGACY_AUTH_ENABLED=true
STAFF_LEGACY_AUTH_UI_ENABLED=false
```

The legacy UI stays invisible during normal operation. If Google/Supabase configuration has a production problem, the server-side legacy path can be deliberately re-exposed by an authorized configuration change while the failure is investigated.

Do not start Phase 2 until:

- real Owner Google sign-in succeeds;
- logout + re-login succeeds;
- unauthorized Gmail rejection succeeds;
- Staff permissions and Disabled behavior are verified;
- rollback behavior is understood and tested.

## Phase 2 approval gate

After explicit Owner approval:

1. set `STAFF_LEGACY_AUTH_ENABLED=false`;
2. verify legacy Staff login/onboarding/MFA routes return `410 Gone`;
3. remove the legacy Staff password/OTP/TOTP UI and server-only dead code;
4. keep customer OTP/password, representative auth and SMTP notification primitives that are still used;
5. keep the old schema non-destructive until the rollback window has passed;
6. perform the separate cleanup migration only after stability is confirmed.

## Emergency Owner recovery

From an authorized server/administrative environment only:

```bash
npm run admin:recover-owner-google -- --email replacement-owner@gmail.com --reason "Google account recovery"
```

The command changes the allowed Gmail for the **single existing Owner**, clears the old Google link, revokes sessions and audits attempted/succeeded/failed recovery. It is not a public endpoint and must never use a fixed recovery password.
