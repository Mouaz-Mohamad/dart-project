# Account navigation and persistent customer sessions — 2026-11-02

## Result

| Window | URL |
| --- | --- |
| My Account | `/profile.html` |
| Profile | `/profile.html?view=profile` |
| Orders | `/profile.html?view=orders` |
| Waiting | `/profile.html?view=waiting` |
| Returns and exchanges | `/profile.html?view=returns` |

The existing windows support direct links, reload, Back/Forward, keyboard close and horizontal swipe. Profile, tracking and return-request documents remain hidden until the server verifies the customer. Guests go to sign-in and return to the requested window/order afterwards. Facebook sign-in retains only an allowlisted navigation target across its redirect.

The WhatsApp preference form is removed from Profile. Existing message dispatch/consent records are not rewritten. Notifications now renders only its bell and heading; it performs no notification/push requests and presents no subscription controls.

Customer sessions use a persistent HttpOnly cookie with a rolling lifetime of at least 365 days. `/api/v1/me` validates and renews the same session, returns its CSRF token and repairs the helper cookie. Parallel tabs do not rotate/revoke each other's tokens. Staff/courier lifetimes retain the configured policy. Expired/revoked sessions and suspended accounts cannot be revived. Clearing cookies still requires signing in again.

All pages check server identity without relying on a readable CSRF cookie. Temporary connectivity failure is a retryable state, not logout. Authentication checks are coalesced, late responses cannot restore a cleared identity, and restored documents wait for verification before revealing customer content. Failed logout preserves the current identity for retry.

## Files and API

- `profile.html`, `track.html`, `form-return.html`, `CSS/main.css`, `CSS/customer-notifications.css`: private access state and requested UI simplification.
- `src/storefront/platform/account-navigation.js`: account URL/history/access controller; registered in `src/runtime-layout.json`.
- Platform state, customer-state, lifecycle, birthday-ui, authentication, api-client and public-api sources: server session hydration, safe return destinations and logout. `Js/dart-ui.js` relinquishes duplicate modal ownership; delivery bundles rebuilt.
- `Js/dart-auth-social.js`: allowlisted navigation continuation only; no OAuth/session capability is persisted.
- `backend/src/modules/identity/identity.service.ts` and `identity.routes.ts`: customer issuance and authenticated, nonrotating renewal in existing `GET /api/v1/me`.
- No new endpoints or database migrations. No production customer/business records were modified for testing.
- Focused runtime, browser and PostgreSQL regressions are wired into existing CI. Existing fixtures now supply the added session state/renewal contract.

## Verification

- `npm run build`, `npm run check`: passed, 40 frontend static checks.
- Backend `npm run check`: lint/typecheck passed; 628 tests passed, 53 integration tests skipped because no external `TEST_DATABASE_URL` was configured. New session SQL tests run against the isolated embedded PostgreSQL production schema.
- Backend `npm run build`: passed.
- Chromium account test: passed; real form login/logout against isolated API fixtures, private-route redirects, URL reload/back/forward, five viewport widths (370/480/767/768/1440), cookie-only context reopening, missing CSRF helper, outage/retry, restored-document session verification and compact Notifications.
- Full-site browser smoke: passed.
- Staged navigation: passed in the local headless shell; native BFCache retention is unsupported by this binary and remains required by the full Chromium CI job. The same limitation reproduced on the original revision.
- `node tests/database-authoritative-storage.cjs` and `git diff --check`: passed.
- Visual inspection: account notification heading/bell and mobile layout checked from an isolated fixture screenshot. External font icons were unavailable in this fixture; new bell/Back icons are local SVGs.

## Dart quality review

| # | Concern | Result |
| --- | --- | --- |
| 1 | Empty/loading/error states | PASS — pending access, explicit retry, existing commerce empty/error states |
| 2 | Server authority | PASS — session validity/expiry/renewal checked in PostgreSQL; no money or stock calculation changed |
| 3 | Concurrency | PASS — stable per-session CSRF, no customer token rotation, generation guard and coalesced checks |
| 4 | Validation/authorization | PASS — existing central authentication; renewal checks token, owner, realm, account status, session version, expiry and revocation |
| 5 | Idempotency | PASS — repeated renewal extends the same session; no message or commerce side effect |
| 6 | Audit | PASS — existing login/logout audit remains; routine session renewal changes no business records |
| 7 | External cost | N/A — no WhatsApp sends or paid-service calls added; no implicit push permission request |
| 8 | Regression | PASS — existing architecture and unrelated features preserved; user footer/image updates retained when rebasing |
| 9 | Tests | PASS — real SQL revocation/expiry/version guards, parallel renewal, missing helper, stale responses, routes and UI tested |
| 10 | Secrets | PASS — session stays HttpOnly; no auth/provider token or customer snapshot persisted in frontend storage |

## Manual acceptance

1. Open an Orders/Waiting/Profile/Returns link while signed out: sign-in appears and successful login restores that exact window.
2. Reload a window; use browser Back/Forward and its Back button.
3. Close/reopen the browser and enter through Home, Products or About; My Account remains authenticated while its cookie/session is valid.
4. Verify the Profile WhatsApp preference form is absent and Notifications contains only its heading/bell.
5. Log out, then reopen a private link: sign-in is required. If connection fails, retry restores the account without pretending logout succeeded.
