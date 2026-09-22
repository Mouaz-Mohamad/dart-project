# Dart Eye Staff Google Auth — Security Design

## Scope

This document covers Owner/Admin/Staff authentication for Dart Eye only.

Customer authentication, representative authentication, commerce, catalogue, inventory, finance and customer/order notification transport are outside this migration and retain their existing contracts.

## Trust boundaries

1. **Google Identity Services** proves control of a Google account to the browser.
2. **Supabase Auth** validates the Google ID token and issues a short-lived Supabase session for identity exchange only.
3. **Dart API** verifies that Supabase session against the one configured Dart Supabase project and extracts the verified Google identity.
4. **Dart PostgreSQL** decides whether the normalized email is allowed, whether the Staff account is Active, which immutable provider subject is linked, and which permissions are effective.
5. **Dart secure session** is the only session used for normal dashboard API traffic after exchange.

Google email, Supabase user metadata and frontend state are never authorization sources.

## Protected Owner

The initial protected Owner allowlist entry is:

```text
midomoaaz3@gmail.com
```

The brand sender address `dart.official.eg@gmail.com` is not an Owner account.

Migration 0024 rejects a conflicting existing active Owner during rollout rather than silently replacing it. The existing single-Owner unique index remains in force, and additional triggers prevent deleting, disabling or demoting the protected active Owner.

Owner Gmail recovery is not exposed through a browser route. It is an audited server-side operation only.

## Token verification

`POST /api/v1/admin/auth/google/exchange`:

- rate-limits authentication attempts;
- accepts only one short-lived Supabase access token;
- rejects tokens with the wrong issuer/project, audience, expiry, subject, email, anonymous state or OAuth authentication method;
- asks the configured Supabase Auth project to validate the presented bearer token and return the canonical Auth user;
- requires a confirmed email;
- requires Google to be the only Auth provider for this dashboard identity;
- requires Supabase user ID and email returned by Auth to match the token;
- obtains the stable Google provider subject from the verified Supabase identity;
- never logs the access token;
- never returns the Supabase access or refresh token after the Dart session is created.

No `SUPABASE_SERVICE_ROLE_KEY` is required for this flow.

## First-link concurrency and identity conflicts

First login runs inside a PostgreSQL transaction and takes advisory locks for both normalized email and provider subject.

Rules:

- a normalized email can map to only one active Staff account in the Staff realm;
- a Supabase user ID can link to only one Staff row;
- a Google provider subject can link to only one Staff row;
- if an already-linked email appears with a different subject, login is rejected;
- if the same subject is already linked to another Staff row, login is rejected;
- concurrent first logins serialize and cannot create duplicate Staff/Owner rows;
- once linked, email alone is not sufficient identity.

Conflict and unauthorized attempts are audited. Raw unauthorized email is not written into audit metadata; a keyed hash derived with the Dart auth pepper is used.

## Dart sessions

After successful exchange:

- the existing Dart session service issues the session;
- the session token is stored only in an HttpOnly cookie;
- production cookies remain Secure;
- SameSite follows the existing deployment architecture;
- CSRF protection remains required for mutations;
- session rotation/revocation remains unchanged;
- API requests do not call Supabase again;
- a disabled Staff status causes the next API authentication check to fail;
- `session_version` invalidates stale sessions;
- permission changes revoke existing sessions so the next sign-in loads the new effective permission set.

The browser Supabase client is intentionally ephemeral:

```text
persistSession: false
autoRefreshToken: false
detectSessionInUrl: false
```

Supabase access/refresh tokens must not be persisted in localStorage or sessionStorage.

## Authorization

Authentication and authorization are deliberately separate.

Supabase/Google:
- prove identity only.

Dart Backend/PostgreSQL:
- Staff allowlist;
- Active/Disabled state;
- Owner protection;
- effective roles and permissions;
- deny-by-default API authorization;
- session lifecycle and CSRF;
- audit.

Frontend role/permission rendering is cosmetic. Editing DOM or JavaScript values cannot grant server access.

## Staff lifecycle

Owner-managed Staff access supports:

- add Gmail allowance without OTP/password;
- set permissions;
- remove allowance before first login;
- inspect Google Linked / Not linked;
- inspect last Google login;
- Active/Disabled;
- revoke all Dart sessions;
- explicit non-Owner Gmail change/relink.

Gmail relink:
1. requires Owner + `staff.manage`;
2. updates the normalized allowed email;
3. clears old Supabase/Google subject binding;
4. increments session version;
5. revokes active sessions;
6. writes an audit event;
7. requires a fresh Google login with the new Gmail.

Owner relink is intentionally unavailable from the dashboard and requires break-glass recovery.

## Audit events

Phase 1 adds or uses events for:

- `OWNER_GOOGLE_ALLOWLIST_READY`
- `STAFF_EMAIL_ALLOWED`
- `STAFF_EMAIL_REMOVED`
- `STAFF_ACCOUNT_ACTIVATED`
- `STAFF_ACCOUNT_DISABLED`
- `STAFF_GOOGLE_IDENTITY_LINKED`
- `OWNER_GOOGLE_IDENTITY_LINKED`
- `STAFF_GOOGLE_IDENTITY_LINK_REJECTED`
- `UNAUTHORIZED_GOOGLE_DASHBOARD_ATTEMPT`
- `GOOGLE_LOGIN_SUCCEEDED`
- `STAFF_PERMISSIONS_UPDATED`
- `STAFF_SESSIONS_REVOKED`
- `STAFF_GOOGLE_RELINK_ALLOWED`
- `OWNER_BREAK_GLASS_ATTEMPTED`
- `OWNER_BREAK_GLASS_SUCCEEDED`
- `OWNER_BREAK_GLASS_FAILED`

Never audit raw access tokens, refresh tokens, Google credentials, Supabase secrets, Dart session tokens or historical raw OTP values.

## CSP and browser surface

The dashboard keeps strict CSP. Phase 1 adds only the origins required for Google identity and Supabase Auth:

- Google Identity script/frame/connection origin;
- HTTPS Supabase project hosts for Auth exchange;
- the already-allowed jsDelivr origin for the pinned Supabase JS build.

No `unsafe-inline` script permission is introduced.

The Supabase SDK is loaded only from Dart Eye, never from public storefront pages.

## Phase 1 rollback

Legacy Staff password/OTP/TOTP routes stay available only when:

```text
STAFF_LEGACY_AUTH_ENABLED=true
```

Their browser UI stays hidden unless an authorized deployment explicitly sets:

```text
STAFF_LEGACY_AUTH_UI_ENABLED=true
```

This rollback path is temporary and does not change customer/representative auth.

## Phase 2

Only after the real Owner Google flow, unauthorized-account rejection, logout/re-login and rollback procedure are verified and the Owner explicitly approves Phase 2:

- set `STAFF_LEGACY_AUTH_ENABLED=false`;
- legacy Staff login/onboarding/MFA endpoints return `410 Gone`;
- remove legacy Staff UI and Staff-only OTP/password/TOTP code;
- remove Staff-only delivery templates/env values no longer used;
- keep customer/representative/shared auth primitives;
- defer destructive schema cleanup to a separate migration after the rollback window.
