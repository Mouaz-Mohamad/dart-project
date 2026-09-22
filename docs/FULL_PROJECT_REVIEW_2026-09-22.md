# Dart | Full Project Review — 2026-09-22

> Scope: `full-code-cleanup` after the cleanup, Arabic code-guide pass, PostgreSQL concurrency fix, and customer-password hardening.

## Executive result

The implemented codebase is currently regression-clean on the reviewed branch:

- Backend CI: **PASS** — production dependency audit, ESLint, TypeScript typecheck, unit tests, PostgreSQL integration tests, browser-JavaScript syntax.
- Frontend CI: **PASS** — static contracts and full Chromium storefront + Dart Eye smoke.
- Public production site: **HTTP 200**.
- Production API health/live and health/ready: **HTTP 200**, PostgreSQL **up**.
- The latest reviewed cleanup branch is **not the same revision currently deployed to Vercel**, so production cannot be claimed to contain the latest fixes until a later explicit deployment.
- One production `pg` warning was traced to concurrent queries on a single PoolClient. The cleanup branch now executes those reads sequentially and contains a regression test.

## Code readability work

A concise Arabic `DART CODE GUIDE` header was added to source/config files that safely support comments. The generated reference `docs/CODE_GUIDE_AR.md` maps the entire repository, including formats that cannot safely contain comments such as JSON and binary/image assets.

The generator is `scripts/add-arabic-code-comments.mjs`.

## Fixed during this review

1. **PostgreSQL shared-client concurrency**
   - Removed `Promise.all` for two queries using one `PoolClient`.
   - Added a contract test so the pattern cannot silently return.

2. **Customer password floor**
   - New customer passwords now require at least 8 characters.
   - Argon2id hashing remains unchanged.
   - Route validation, service policy, integration tests and security tests agree.

3. **Documentation drift**
   - Corrected the storefront CSS comment to point at `CSS/responsive.css`.
   - Added concise Arabic responsibility comments across the source tree and GitHub workflows.

## Server-authority review

### PASS — Authentication and permissions

- Server session validation is central.
- HttpOnly session cookie is used.
- CSRF is checked for authenticated mutations.
- Account-type and permission middleware live in the backend.
- Staff permissions are enforced by API routes rather than only hiding buttons.
- Production environment rejects development auth/MFA secrets.

### PASS — Catalog, inventory reservation and checkout foundation

- PostgreSQL is the business source of truth.
- Browser state is an in-memory projection; legacy LocalStorage business keys are purged.
- Cart reservations are checked for ownership and expiry.
- Checkout locks inventory rows and recomputes current price/discount server-side.
- Checkout uses an idempotency key.
- Old order prices/costs are retained as snapshots.
- Inventory mutation and order creation are transaction-bound.

### PASS — Birthday reward integrity foundation

- Annual reward identity is based on customer code + current reward year.
- Reward is reserved at checkout.
- Delivered marks the reward Used.
- Cancelled/Refused releases it only while still valid.
- Changing a birthday date does not create a second reward identity for the same customer/year.

## Approved Phase-1 / Launch-Gate gaps found

These are specification gaps, not failed tests in already-implemented code.

### BLOCKER — COD Risk & Verification (v2.1 §6)

The approved plan makes this P0 before an order may be prepared. The current branch has COD accounting/settlement logic, but no implemented customer/order `Risk Level` or `Verification Status` policy.

Missing foundation includes:

- Low / Medium / High / Restricted risk state.
- verified-phone / refusal-history / rapid-repeat / order-value signals.
- first-order verification gate.
- refusal escalation (one refusal -> stronger verification; two in 90 days -> manual review).
- configurable thresholds with versioning/audit.
- a server-side guard that prevents `Preparing` before required verification succeeds.

### BLOCKER — Minimal WhatsApp order lifecycle notifications

The generic outbox and direct Meta Cloud API sender exist, but the approved Phase-1 order events are not wired:

- `ORDER_PLACED`
- `ORDER_OUT_FOR_DELIVERY`
- `ORDER_DELIVERED`

The current `order.created` outbox event is an internal event and does not contain the WhatsApp channel/template/recipient payload needed by the publisher.

### BLOCKER — WhatsApp Order Confirmation Dialogue (Section 45)

Not yet implemented:

- `Confirmation Pending` before `Preparing`.
- `orders.confirmation_status`, sent/responded timestamps.
- `order_confirmation_events`.
- `ORDER_CONFIRMATION_REQUEST`.
- Meta Quick Reply Confirm/Cancel webhook.
- `X-Hub-Signature-256` verification.
- idempotent reply handling and optimistic-conflict handling.
- four-hour expiry + one reminder at two hours.
- feeding decline/no-response signals into the existing COD Risk profile.

### GAP — Restock Reservation & Waitlist (Section 44)

The approved Phase-1 implementation sequence includes this feature, but no `stock_interest` / `reservation_events` / waitlist APIs or storefront Notify-Me flow exist on the reviewed branch.

The final spec requires FIFO, exact-color priority, alternative-color offer, four-hour hold, existing cart reservation reuse, WhatsApp notification and demand analytics.

## Explicitly post-launch

The v2.2 prioritization says the large Section 37–43 additions other than the small launch items are not all launch blockers. For example, the full Live Operations Map is a post-launch investment. Its absence should not be confused with a broken current implementation.

## Production note

The currently live Vercel deployments predate the newest cleanup branch. Therefore:

- Production health is green.
- Production does **not** yet prove the latest branch fixes/comments are deployed.
- The PostgreSQL shared-client warning may remain visible in the older production revision until a new deployment uses the fixed branch.

## Quality checklist

| # | Area | Review result | Notes |
|---|---|---|---|
| 1 | State coverage | PASS for reviewed implemented flows | Browser smoke + route tests pass; future waitlist/confirmation states do not exist yet. |
| 2 | Server authority | PASS for implemented commerce/auth | Browser is not the business authority. |
| 3 | Concurrency | PASS for reviewed implemented flows | Shared-client query bug fixed; checkout locks inventory and uses optimistic/version controls. |
| 4 | Validation & authorization | PASS | Central auth/permission middleware and Zod validation are present. |
| 5 | Idempotency | PASS for checkout/outbox | Section-45 inbound webhook is not implemented yet. |
| 6 | Audit & observability | PASS for implemented sensitive flows | New future COD/confirmation operations still need their own audit events when built. |
| 7 | External-service awareness | PARTIAL | Direct WhatsApp sender/retry exists; approved order notification and confirmation workflows are missing. |
| 8 | Regression safety | PASS | Backend CI + full Chromium smoke succeeded. |
| 9 | Tests | PASS for reviewed changes | Concurrency/password regression tests added; final CI green. |
| 10 | Secrets | PASS | No new token/key was committed; production secrets remain environment-driven. |

## Bottom line

**The code that exists is currently passing its automated regression suite, but Dart is not yet feature-complete against the approved Phase-1 specification.** The remaining critical build work is COD Risk & Verification, Section-45 order confirmation, the minimal WhatsApp lifecycle events, and the Section-44 waitlist.

Do not describe the project as fully launch-ready until those Phase-1 gates are implemented, tested, and then deployed.
