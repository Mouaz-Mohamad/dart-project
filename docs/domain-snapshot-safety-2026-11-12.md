# Authoritative snapshot safety

The legacy dashboard adapter replaces a whole collection after an optimistic version check. A current version does not establish that a browser has loaded every record. Relational domains also keep an empty JSON array as their version envelope, so replaying that envelope through an `UPDATE OF data` trigger can erase authoritative rows.

## Changes

- Normal domain writes reject omitted existing records with `DOMAIN_SNAPSHOT_INCOMPLETE` and retain before/after values in the append-only audit log.
- Explicit one-record deletion uses `DELETE /api/v1/admin/domain-state/:domain/:recordId`, the existing domain permission, staff MFA, CSRF, and an expected version. Supported domains are cards, damage, notifications and return presentation metadata. Account/workflow commands remain required for other operational records. Returns retain their operational history.
- The frontend uses explicit record deletion; reading a notification and archiving one section persist only that section. The adapter reports incomplete-list conflicts and reloads the authoritative state.
- Migration 0088 checks relational snapshots before the destructive adapter trigger, including direct SQL writes. Explicit deletion authorizes only its requested record ID within the transaction.
- The migration runner suspends only the relational adapter trigger while executing historical migration 0085, inside its existing transaction and migration lock. The original migration and its checksum remain unchanged. Migration 0088 canonicalizes customer aliases directly in authoritative row tables.
- Full catalogue replacement rejects omitted active records; explicit archive flags and the existing per-record PATCH remain available.
- Partial settings saves retain omitted fields and record complete before/after settings.
- Finance display/audit handling no longer truncates durable history to a browser-side limit.
- Manual-discount retry comparisons read SQL DATE values as date strings, preserving idempotency across server time zones.
- Order workflow tests include the configured once-per-order shipping charge after both creation and edits.

## Recovery procedure

Capture historical source records and the current production state in protected audit entries before recovery. Restore only source rows whose IDs are absent, in one locked transaction; retain current rows and their values. Update only domain versions after direct row restoration, never replay empty envelopes. Keep source capture and recovery audits for verification and repeatability. Do not recreate records from counts or inferred amounts.

## Validation

The snapshot safety suite exercises incomplete current-version expense saves, preserved before/after audit values, direct SQL envelope replay, historical migration protection, explicit single-record and final-record deletion, stale retries, partial settings saves and empty catalogue replacement. Route tests cover domain permission, CSRF and expected-version validation. The real PostgreSQL integration contract now requires incomplete snapshots to fail while retaining the original records.

## Quality review

| Area | Result |
| --- | --- |
| Empty/loading/error | Empty saves are distinguished from explicit deletion; conflict reload and existing Finance error/retry remain available. |
| Server authority | Persistence and money/stock decisions remain server-side. |
| Concurrency | Domain locks, version checks, catalogue locking and transaction-local deletion authorization remain in force. |
| Validation/authorization | Existing per-domain permissions, staff MFA, CSRF and version validation protect the new route. |
| Idempotency | Stale delete retries cannot delete another record; manual-discount retries retain date-only semantics. Recovery inserts preserve existing IDs. |
| Audit | Domain/settings writes retain before and after values; recovery sources and applied restorations are separately recorded. |
| External services | No WhatsApp, email or push sending policy changes. |
| Regression scope | No pricing policy or visual redesign; workflow, Finance, shipping and feedback checks retained. |
| Tests | New integration and HTTP permission cases plus existing full backend and relevant frontend suites. |
| Secrets | No credentials or recovered customer/financial payloads are included in this commit. |

## Manual verification

1. Reload the dashboard and confirm Expenses, Budgets, Goals, Invoices, Marketing, COD and Reviews load from their respective server domains.
2. Edit and archive a single expense, reload, then restore it. Other rows and sections must remain unchanged.
3. On an isolated test account, reject a current-version empty list for a nonempty domain; retain the original rows and version.
4. Delete one eligible unlinked record through the existing UI. Repeating a stale request must not affect a different record.
5. Change shipping in Settings and reload; confirm unrelated images, discounts and delivery policies remain.
6. Confirm the encrypted backup workflow uploads an archive and validates a complete restore against the current migration history.
