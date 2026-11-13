# Domain history and production hardening — 2026-11-14

## Scope

- Migration 0089 replaces delete/reinsert adapters with changed-row upserts. Existing identifiers, foreign keys, campaign creation dates and versions survive.
- Financial row mutations append a transactionally committed audit event. Existing financial events cannot be updated or deleted. The generic finance audit writer is read-only.
- Dashboard actions explicitly name affected resources. Product editing cannot schedule unrelated customer, feedback, finance or return snapshots.
- The generic promotion writer is disabled in favor of validated campaign commands. Compatibility card/reward payloads reject impossible usage/percentage values.
- Money validation rejects sub-piastre values in finance editors and settlement requests while preserving the existing pounds API.
- Image redirects and matching ETags omit binary bytes in the database query. Valid image bodies and URLs remain compatible.
- Lighthouse waits for the expected production SHA and verifies it again after measurement; `/release.json` contains only the public SHA and is not cached.
- Verified encrypted backups are scheduled every six hours instead of once daily. GitHub scheduling is best effort, not a guaranteed RPO.

## Operations

Migration 0089 was applied transactionally, after the existing migration lock was acquired. Count/content fingerprints for financial records and feedback remained identical immediately before/after DDL. No business-row backfill is performed.

The `dart_app_runtime` role is separate from the schema owner, with no superuser, BYPASSRLS, CREATE ROLE, CREATE DATABASE, schema ownership, migration DML or audit UPDATE/DELETE privileges. Its explicit RLS policy permits the trusted backend to operate on rows; API authentication, ownership and staff permissions remain the per-user boundary. Never give this role to a browser or Data API. After later schema migrations, rerun `backend/scripts/provision-runtime-grants.sql` using the owner so new tables/functions have the required grants/policies. Backups/migrations retain separate owner credentials.

Customer identifier-only login is deliberately unchanged because it is an explicit existing product policy; its impersonation risk remains unresolved. Neon Time Travel retention remains six hours; increasing it can require a plan/cost decision. Do not claim that scheduled backups eliminate that limit.

SSE distributed capacity and splitting large business services remain measurement/refactoring work, rather than proven current production failures. This repair does not add a paid service or change discount priority, Sute exchange policy, courier navigation or store design.

## Verification

- Full backend checks: lint, types and unit/embedded-database suites.
- Maintained frontend source/freshness checks plus all 60 static contracts.
- New embedded PostgreSQL cases: campaign version 7 becomes 8; unchanged campaigns retain metadata; referenced records remain intact; incomplete snapshots fail; financial audit is append-only; writes to another domain do not touch reviews/campaigns; conditional images omit bytes.
- Restricted-role case: business operations and server audit succeed; schema alteration, migration changes, privilege escalation and old central-audit edits fail.
- Money/benefit and release-wait failure cases are included.
- Local Chromium could not start because this execution environment forbids a required socket operation. Browser acceptance runs in the existing GitHub Frontend CI before production release; no browser result is claimed locally.

## Manual acceptance

1. Edit one model; verify only catalogue and display-audit requests, then reload another tab.
2. Verify all existing reviews, expenses, customer records and returns remain present and unchanged.
3. Edit a campaign; verify its creation date stays fixed, version increases and stale submissions return 409.
4. Create/edit/archive a finance record; verify the financial history records the server actor and old/new values and cannot be rewritten.
5. Submit 0.001 EGP; expect 422. Submit 0.01 EGP; expect one piastre.
6. Verify production `release.json` equals the deployed main SHA and API readiness returns 200 using the limited role.

## Rollback

The database change is backward-compatible with existing domain envelopes. Prefer reverting application code via a reviewed main commit without replacing the database function with the previous destructive adapter. Preserve immutable financial history. The previous Vercel deployment and separate owner connection permit operational recovery if a missing runtime grant is discovered; fix the grant before switching back to the limited role. Never restore the entire database merely to revert application code.

## Quality review

| Area | Assessment |
|---|---|
| Empty/error/loading | Existing states retained; explicit rejection codes added |
| Server authority | Financial history and validation enforced on server/database |
| Concurrency | Existing version locks retained; row versions stay monotonic |
| Authorization | Existing CSRF/MFA/permissions retained; runtime DB privileges reduced |
| Idempotency | Unchanged payloads do not emit duplicate financial events |
| Audit | Sensitive financial mutations preserve before/after/actor/request context |
| External cost | No test messages or new paid provider; backup frequency increased |
| Regression | Relevant static/backend checks and existing browser CI required |
| Tests | Meaningful database, validation, restricted-role and release cases added |
| Secrets | No credential values committed or included in documentation |
