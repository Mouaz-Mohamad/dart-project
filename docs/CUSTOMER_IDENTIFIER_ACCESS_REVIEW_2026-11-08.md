# Customer access without passwords — 2026-11-08

Customers can register with name, primary Egyptian phone and birthday, and log in using a registered email or phone only. Google continues through server-verified OAuth, with no Dart password prompt when linking old accounts. Phone-only accounts can link Google without creating a duplicate customer. Profile edits and checkout support an absent email.

The owner explicitly chose identifier-only customer access after its consequence was explained: anyone who knows an identifier can enter that customer's account. This policy does not prove customer ownership. It is confined to the customer realm; Staff email codes, Representative password checks, session cookies, CSRF, ownership checks on authenticated operations, suspension/deletion and role permissions remain enforced.

## Implementation and API

- `Sign Up modern.html`, `profile.html`, maintained `src/storefront/platform/` sources and generated delivery files remove customer passwords, temporary/change-password prompts and customer recovery links. The shared reset dialog remains for Representatives, with the strong policy intact.
- Dashboard customer rows/actions no longer offer password resets; Representative resets remain available. Password visibility controls no longer override the Representative reset policy with the retired customer minimum.
- `POST /api/v1/auth/register`: name, phone1 and birthday; email/phone2 remain optional for compatibility with older clients and internal social registration. The browser sends exactly the three visible registration fields. Passwords are not stored for new customers.
- `POST /api/v1/auth/login`: `{ identifier }`, matching only registered customer emails/phones. Names and public account codes are rejected.
- `PATCH /api/v1/me` and the administrative customer editor allow an empty email. Customer contact changes do not queue verification or revoke the current session.
- Social completion accepts no Dart password. It preserves the existing customer ID and saved birthday, and adds Google email to a phone-only account when linked.
- Customer verify-email, resend-verification and change-password HTTP routes are retired. Shared forgot/reset/temporary-password and administrative reset operations are restricted to Representatives. Legacy internal verification helpers remain only for historical challenge handling/regression coverage.
- `backend/openapi.yaml` and `docs/API_CONTRACT.md` describe the new contract.

## Database

Migration `0078_customer_identifier_access.sql` permits NULL email pairs for customers, retains mandatory email for privileged realms and mandatory password hashes for Representatives, clears retired customer password/verification gates and cancels pending customer recovery challenges. Existing hashes and business history are retained. No orders, rewards or financial records are changed.

Applied to the production Neon main branch with the same migration advisory lock and a checked 0077 baseline. Migration history checksum: `b961bd0363354493470865459b3874b057ec96e484ec4f0c5ea668a651f6a8e1`.

## Validation

- `npm run check --prefix backend`: 819 passed, 66 skipped; includes lint, TypeScript, HTTP boundaries and isolated PostgreSQL/PGlite tests. Environment-dependent real PostgreSQL cases remain skipped locally and are covered by configured CI.
- `npm run build --prefix backend`: passed.
- `npm run build`, `npm run check`: passed; 51 maintained Frontend checks, including database-authoritative storage, cart recovery and Representative password-reset UI.
- `tests/customer-identifier-access.test.ts`: phone-only registration, no fake email/hash, normalized phone/email login, old password flags, blocked/deleted customers, privileged-realm separation, optional email edits, duplicate phone rejection, retired recovery, existing/new Google accounts and phone-account linking, one-time social capability, email-free checkout.
- `tests/customer-notifications-browser.cjs`: passed in local Chromium against isolated API fixtures, including exact three-field signup and identifier-only login payloads, removed customer password controls, cookies, logout, private-route redirects, history navigation, five widths and outage/retry behavior. A compatible installed Chromium was used because the runtime's default browser download was unavailable.
- OpenAPI YAML parses successfully. The unrelated upstream birthday presentation edit was preserved before publication.
- Live Google consent was not exercised with a personal account; server-side provider settings are preserved and social completion is exercised with synthetic verified-provider challenges.

## Quality review

| Area | Result | Evidence / applicability |
| --- | --- | --- |
| 1. Empty/loading/error states | Pass | Invalid/unknown identifiers, pending form submissions, API failures and retry states retained; repeated submit is blocked. |
| 2. Server authority | Pass | Sessions and customer identities are resolved by API/PostgreSQL; no browser credential or business-data fallback. |
| 3. Concurrency | Pass | Customer login locks the user through session issuance; phone/email uniqueness constraints remain; social capability locks remain. |
| 4. Validation/authorization | Pass within explicit policy | Customer access deliberately uses identifiers only. Privileged realms, blocked accounts, session/CSRF and resource permissions remain separate and tested. |
| 5. Idempotency | Pass | Duplicate registration fails transactionally; one-time social completion cannot replay; repeated form submits are blocked. |
| 6. Audit/observability | Pass | Customer registration/login use existing audit logs with `customer_identifier` method; profile mutations remain audited. |
| 7. External cost | N/A | No new paid service or message category; signup/profile do not send confirmation messages. |
| 8. Regression scope | Pass | Cart claim, profile navigation and Representative reset flows tested; unrelated upstream change preserved. |
| 9. Automated tests | Pass | Database, HTTP, static/runtime and real-browser fixture coverage listed above. |
| 10. Secrets | Pass | No credentials or provider secrets added to sources or logs. |

## Manual acceptance

1. Open `Sign Up modern.html` in a signed-out browser. Registration asks only for name, phone and birthday. Google appears on both forms.
2. Register a new phone, then log out. Log in using that phone, with no password or confirmation step.
3. Add an email from Profile, save, log out and sign in using the email. Save a profile with no email and verify checkout works without one.
4. Use Google for an existing account or supply a phone already registered without an email: the same customer and history should be retained.
5. Confirm Staff still require email access codes and Representatives require their passwords. Suspended/deleted customers cannot log in.

Rollback must account for customers created without passwords: reverting to password-based login requires a separate enrollment/recovery plan for those accounts. Retained historical hashes help existing-account recovery but cannot create credentials for new phone-only customers.
