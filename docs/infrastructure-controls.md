# Database and hosting controls

Prepared on 2026-11-26. This change is committed on `work/database-hosting-controls`, with automatic Vercel deployments disabled for that exact branch in both project configurations. It is **not an operational release**. No production environment variables, database records, subscriptions, or active schedulers are changed by this commit.

## Database settings

Settings → **قاعدة البيانات** contains:

- Background outbox enable/manual-only switch, interval in multiples of five minutes (5–1440), and configurable quiet hours in `Africa/Cairo` (DST-aware). Defaults: 15 minutes, quiet from 01:00 inclusive to 12:00 exclusive.
- An audited, permission/CSRF-protected manual action processing at most five existing events. It bypasses quiet hours but preserves the durable outbox's existing deduplication, consent and channel rules. It does not enqueue new messages. The normal immediate dispatch triggered by customer/admin actions is unchanged.
- A calculator for 30 days, CU size, unit price, free allowance and free/paid plan. CU and plan inputs are **assumptions**, never provider plan changes. Paid estimates charge the complete estimated consumption, without subtracting the free-plan allowance.
- An on-demand read of Neon compute usage and period. Missing provider access is shown as unavailable, never zero. Free remaining quota is explicitly relative to the allowance the admin entered.

At default settings the scheduled worker makes approximately 52 runs/day (13 active hours × four/hour). Assuming a short query and five-minute idle timeout, its compute-only estimate is 32.5 CU-hours/30 days, or $3.445 at $0.106/CU-hour. This excludes visits, long queries, open dashboards, storage, backups, retries, multiple worker batches and provider charges. It is not a bill or cap.

## Hosting settings

Settings → **الاستضافة** reads deployment counts with bounded pagination for the configured projects, project request counts through Observability, and posted **team** billing charges using the FOCUS JSONL endpoint. It shows read time and incomplete/unavailable status independently of restricted billing access.

The comparison budget is admin-entered, not provider credit or a hard spending cap. A calendar-month projection extrapolates posted team charges and is not a final invoice. Team charges can include Neon Marketplace purchases; do not add Neon a second time. No invented deployment allowance, remaining provider credit, or flat per-deploy price is shown.

## Persistence and execution

PostgreSQL remains authoritative: `site_settings.data.infrastructure` plus `infrastructureRevision`, with row locking, an expected revision and audit records. Existing unrelated settings are preserved. No migration is necessary. Infrastructure state is excluded from ordinary site-settings forms and the public settings object. Only the non-secret background schedule is returned alongside the site settings as a read-only projection.

The schedule is mirrored to the GitHub repository variable `DART_BACKGROUND_POLICY` (`{revision,schedule}`), not code or an environment variable requiring a redeploy. The backend publishes it while serializing writers; a failed publication rolls back the database update. The worker sends its revision, and the API refuses processing on revision mismatch. If publication succeeds but the database commit/reply fails, reload and save again to reconcile; no stale projection is allowed to dispatch messages.

GitHub's scheduler wakes every five minutes, reads that variable, and checks Cairo quiet hours and the selected interval **before contacting the API**. Skipped runs contact neither the Dart API nor Neon. Actual GitHub start times can be delayed; this is not an exact-minute delivery SLA. Once allowed, the existing bounded drain and its backlog/maintenance alerts remain in place. Backups check the same quiet window before any production database step; manual backups remain available. Backup checks ignore the outbox manual-only switch, because disabling messages must not silently disable all backups.

The duplicate native Vercel outbox cron is removed in this future configuration. The existing authenticated endpoint remains for compatibility but also checks the saved schedule/revision. Routine browser timers (catalog/settings/reviews/customer snapshots, dashboard fallbacks, finance and live tracking/representative updates) pause in quiet hours using an in-memory local clock. The SSE stream closes and resumes without reading the database to determine the time. Direct page hydration, focus-driven refresh, saves, checkout, login and explicit user actions remain available. Cart-expiry cleanup is preserved to protect stock consistency. Quiet hours do not promise zero database activity when customers or admins actively use the site.

Opening Settings does not start provider polling. Usage reads occur only when requested, coalesce within an instance, and cache for one minute. Tokens never enter the browser or settings payload.

## Server configuration for a later approved release

All names are documented in `backend/.env.example`; actual credentials must be installed server-side, not committed:

| Variables | Purpose |
| --- | --- |
| `DART_SCHEDULER_GITHUB_TOKEN`, `DART_SCHEDULER_REPOSITORY` | A fine-grained token restricted to the Dart repository's Actions **Variables** read/write permission. No code write or workflow permission is needed. Schedule saves remain disabled until configured. |
| `DART_NEON_READ_TOKEN`, `DART_NEON_PROJECT_ID` | Read Neon project consumption independently of the SQL connection. |
| `DART_VERCEL_READ_TOKEN`, `DART_VERCEL_TEAM_ID`, `DART_VERCEL_PROJECT_IDS` | Read deployment/request/billing data; entitlement/role restrictions may still make individual values unavailable. |
| GitHub secret `DART_OUTBOX_CRON_SECRET` | Existing worker credential; must match the API's configured outbox secret. |

Before a future release removes the native cron, verify the GitHub worker is enabled, its secret is available, and its schedule projection is synchronized. GitHub scheduled workflows run from the default branch: publishing this review branch alone does not replace the running worker. Do not merge or deploy these changes as part of the commit-only request. A later approved release must coordinate the API, frontend and default-branch scheduler; an old API does not enforce the new revision guard.

Neon's current quota exhaustion prevents a real production save/read test. This work does not reset consumed quota or purchase a plan. Provider integration tests use synthetic responses and PostgreSQL tests use an isolated PGlite database.

## API surface

All admin endpoints require a staff session, satisfied MFA when applicable and `settings.manage`. Writes require CSRF.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/admin/infrastructure` | Current settings, revision, scheduler configuration availability, server estimate |
| `PUT /api/v1/admin/infrastructure` | `{expectedRevision,settings}`, validated optimistic save and schedule synchronization |
| `GET /api/v1/admin/infrastructure/usage/database` | Filtered Neon usage or explicit unavailability |
| `GET /api/v1/admin/infrastructure/usage/hosting` | Deployment/request/team-charge summary or explicit unavailability |
| `POST /api/v1/admin/infrastructure/process` | Audited bounded manual processing; intentionally bypasses the automatic quiet-hour gate |

## Review

| Review area | Result |
| --- | --- |
| State coverage | Loading, empty queue, missing provider credentials, errors, stale edits and logout handled |
| Server authority | PostgreSQL settings/revisions; estimates are labelled and never provider configuration writes |
| Concurrency | Row lock, optimistic revision, worker revision check, provider-read coalescing, disabled repeat submissions |
| Validation/access | Strict bounded schemas, central permissions, staff/MFA and CSRF; provider URLs fixed server-side |
| Idempotency | Existing outbox deduplication and bounded SKIP LOCKED processing retained; cancelled manual confirmation sends nothing |
| Audit | Settings old/new values and staff manual-processing requests recorded |
| External costs | No live WhatsApp send, new subscription or deployment used as a test; posted charges distinguished from forecasts |
| Regression | Immediate customer actions and reservation expiry preserved; new infrastructure module is Settings-only |
| Tests | Isolated SQL persistence/rollback, denied access/CSRF, quiet hours/DST, worker bounds, provider fixtures, UI runtime and existing checks |
| Secrets | Server-only environment placeholders; provider responses filtered; no real credentials added |

Visual inspection through the connected browser could not reach the isolated executor's local preview port. UI runtime checks cover behavior; responsive screenshots still need review before a future deployment.

## References

- [Vercel branch deployment control](https://vercel.com/docs/project-configuration/git-configuration)
- [GitHub repository Actions variables](https://docs.github.com/en/rest/actions/variables)
- [Vercel billing charges JSONL](https://vercel.com/changelog/access-billing-usage-cost-data-api)
- [Neon pricing](https://neon.com/pricing)

## Release verification update

The first production attempt correctly stopped on the legacy CSS equivalence test: it applied old styles to the newly added infrastructure cards. The equivalence fixture now removes only the two new cards and their new navigation buttons from both phases, following the existing merchandising/checkout fixture pattern. All legacy elements retain their full computed-style, geometry and pixel comparisons.

`infrastructure-settings-browser.cjs` independently exercises the real delivered dashboard markup, stylesheet cascade and infrastructure runtime at 370, 480, 767, 768 and 1440 pixels. It checks card/content overflow, black/burgundy text, default and editable intervals/quiet hours, acknowledged saves, on-demand provider reads and denied access. It uses only synthetic local API responses. It is wired into the maintained browser inventory and the same required Frontend CI gate.

## Account dashboard revision (unpublished)

- Verified Neon plan: Launch, managed by the Dart Vercel team. Use v2 project consumption; legacy project counters returned zero while v2 returned real consumption.
- Compact account and usage tiles precede timing controls. Calculator is collapsed and paid by default. Current compute start time is separate from monthly CU-hours. Select production compute by explicit endpoint ID or backend database hostname.
- Provider reads occur on tab opening or manual refresh, with no new background polling. No fabricated balance or free quota.
- All three provider/scheduler token variables are present as Production/Sensitive; identifiers are configured. Runtime validity must still be checked after deployment.
- Checks: 69 frontend checks, 14 isolated infrastructure backend tests and backend typecheck pass. Browser layout verification remains pending; the executor blocks Chromium startup.

| Review | Status |
| --- | --- |
| 1. Loading/empty/error states | Pass; unavailable values stay separate from zero |
| 2. Server authority | Pass; provider identities/usage and PostgreSQL revisions |
| 3. Concurrency | Pass; existing serialization/coalescing preserved |
| 4. Validation/access | Pass; staff permission/MFA/CSRF unchanged |
| 5. Idempotency | Pass; existing manual outbox path unchanged |
| 6. Audit | Pass; existing audited save/manual operations preserved |
| 7. Costs | Pass; no paid messages/new subscriptions used as tests; no polling added |
| 8. Regression | Static checks pass; browser verification pending executor limitation |
| 9. Tests | 69 frontend checks and 14 backend tests pass; browser gate still required |
| 10. Secrets | Pass; server-only Sensitive token, no values read or logged |

The existing `work/database-hosting-controls` branch has Vercel deployment disabled in both projects. Frontend CI now runs there, so the redesigned surfaces can pass browser checks before moving the approved commit to main without a preview deployment.
