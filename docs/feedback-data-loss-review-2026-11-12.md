# Review data-loss repair — 2026-11-12

## Incident and recovery source

At 2026-11-12 16:02:06 UTC (18:02:06 Africa/Cairo), audit event `f8e750de-312f-4024-bd33-b4808c7ce5bc` recorded a dashboard reviews save from version 186 to 187 with count zero. Adjacent catalog, representative and notification saves are consistent with the shared Save All path. The precise clicked UI action is not recorded, so it is not attributed to a particular button.

The historical reviews state at 16:01:00 UTC was recovered read-only through Neon Time Travel: four original records, two Active and two Pending. Full texts and moderation states were verified. No customer/order records or entire database restore is needed. No review content, phone number, email or database credential is committed here.

Recovery is a narrowly scoped merge by original review ID. Existing current records take precedence, only missing original records are appended, and an audit event records the before/after snapshots and source timestamp in the same transaction. It can be repeated without duplicate records. A new snapshot could not be created because the project's snapshot limit is occupied; the old snapshot was preserved. Time Travel avoids deleting it or changing production connections.

## Repair

- `dartSaveAll` no longer persists reviews or contacts as a side effect of editing inventory, representatives, notifications or another section.
- Review and Contact Us edits, visibility and archive controls explicitly save their own domain and wait for acknowledgement. Failures are visible; duplicate editor submissions are blocked.
- Versioned feedback writes validate identifiers and reject any snapshot omitting an existing record, including a current-version empty array. This protects already-open old clients as well as the fixed dashboard.
- Explicit deletion uses `DELETE /api/v1/admin/feedback/:domain/:recordId`, requires CSRF, staff authentication/MFA, the correct reviews.manage or contacts.manage permission and an observed version. It cannot remove unrelated reviews or private contact records.
- Every feedback save/deletion retains complete previous/new domain snapshots in the permission-scoped audit trail. Existing public moderation and contact/review separation are retained.
- No schema migration, new credential, message, customer account, product price or order mutation is introduced.

## Verification

- Backend TypeScript and ESLint checks passed.
- Six focused backend suites cover 57 passing cases (one real-PostgreSQL concurrency case skipped without TEST_DATABASE_URL). Critical cases include empty/partial/stale arrays, invalid/duplicate IDs, review/contact separation, moderation/create/archive, explicit single-record deletion, replay safety, before/after audit content and HTTP permission/CSRF/version checks. Existing checkout and shipping suites are included.
- Runtime tests cover an unrelated Save All with review data present, independent review/contact edits, visible failed-save recovery and a real adapter single-record DELETE request.
- Source/runtime freshness, database-authoritative storage, dashboard refresh, existing browser runtime contracts and public-feedback contracts passed. Production build/staging passed.
- Previously documented unrelated frontend baseline failures remain outside this incident repair.

## Quality review

| Area | Result |
| --- | --- |
| 1 State coverage | Pass — explicit save failures, editor saving state, reload on incomplete snapshot |
| 2 Server authority | Pass — server checks all stored IDs; full-list replacement cannot implicitly delete |
| 3 Concurrency | Pass — locked feedback rows, observed versions, serialized browser feedback requests |
| 4 Validation/auth | Pass — unique stable IDs, specific domain permissions, CSRF, staff/MFA |
| 5 Idempotency | Pass — stale repeated deletion rejects without another mutation; recovery merges by ID |
| 6 Audit | Pass — complete previous/new values retained for feedback writes and recovery |
| 7 External cost | Pass — no outbound messages; temporary read-only Time Travel compute expires automatically |
| 8 Regression | Pass — moderation, archive, individual deletion, contacts and checkout retained |
| 9 Tests | Pass — critical server, HTTP and browser adapter paths covered |
| 10 Secrets | Pass — credentials held only in session memory and passed through hidden stdin |
