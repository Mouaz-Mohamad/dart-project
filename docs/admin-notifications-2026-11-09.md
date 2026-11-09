# Dart Eye notifications — 9 November 2026

Implemented staff notifications for new committed orders, customer Refund/Exchange requests, verified reviews and public feedback awaiting moderation. Order hooks cover manual and storefront orders. Existing operational Updates remain available. No historical events are backfilled.

## User flow

The bell opens the inbox and device controls. White circles with black digits beside Orders show unread order notifications; Returns and Review have equivalent counters. Reading an individual notification opens its record and clears that account's receipt across devices. “Mark displayed as read” affects only the displayed IDs; later arrivals remain unread. Inbox pagination and native notification links can open older records directly. Optional sound is a browser UI preference.

On each phone, sign in to Dart Eye, open the bell and select **Enable phone notifications**, then allow the browser prompt. Android uses a supported browser; iPhone/iPad requires a supported installed Home Screen web app. Push delivery depends on network/browser/OS settings. Logout, session expiry, opt-out and removal of the relevant permission prevent further delivery. Push payloads contain only the event type and notification UUID, never customer contact details, amounts or addresses.

## Contracts and source ownership

- `GET /api/v1/admin/notifications?limit=50&cursor=...`: keyset pages and account-specific unread totals.
- `GET /api/v1/admin/notifications/:id`: permission-filtered native deep link.
- `POST /api/v1/admin/notifications/read`: explicit UUIDs; CSRF required.
- `GET /api/v1/admin/push/config`, `GET/POST /api/v1/admin/push/subscriptions`, `DELETE /api/v1/admin/push/subscriptions/:id`: encrypted, session-bound staff device enrollment.
- Staff session, MFA and `notifications.read` are required. Event categories additionally require `orders.read`, `returns.read` or `reviews.read`. The existing centralized effective-permission calculation is shared with deferred delivery.
- `0081_admin_notifications.sql`: additive event, read-receipt and staff subscription tables. Event/entity uniqueness and transactional outbox enqueue protect against duplicate submissions. Commit-time version signals update open dashboards through the existing change stream; a once-per-minute recovery check handles unavailable streams.
- `Eye/dart-admin-notifications.js` and `Eye/admin-push-sw.js`: maintained page-specific entry point and push-only worker; no offline cache or browser business storage.
- `src/dashboard/core/notifications.js`: existing Updates integration and record navigation; compose `Eye/dart.js` with `node scripts/build-source-runtime.cjs`.
- Existing Web Push VAPID configuration is reused; no new service or signing key is required. The existing outbox handles bounded immediate sending and scheduled retry/recovery.
- The business-data reset removes the new business alerts/outbox entries while retaining staff device consent.

## Verification

- Backend lint, TypeScript check and build pass.
- Focused acceptance suite passes: native enqueue/delivery, encrypted subscriptions, all four event types, rollback/deduplication, pagination, independent staff receipts, permissions, CSRF, expiry/logout/opt-out and review/return integrations. Customer notification regressions pass.
- `node tests/admin-notifications-runtime.cjs`: initial/arrival counts, deduped toasts, escaped content, read/navigation, logout isolation and safe service-worker click URLs pass.
- Browser source freshness, database-authoritative storage and static delivery packaging pass.
- Full-suite baseline failures were reproduced on untouched `a4fd66d`: coupon deletion tests compare lowercase fixture codes with normalized uppercase output; frontend cart/promotion fixtures, CSS cascade and performance-budget checks also fail before this feature. These unrelated application paths are unchanged.
- The cloud browser cannot reach the local preview server, so visual desktop/mobile QA and actual receipt on the owner's phone remain unverified. No production orders/reviews were created and no real push was sent during testing.

## Quality review

| Check | Result |
| --- | --- |
| 1. Empty/loading/error | Pass: explicit inbox and push states, retry and accessible status text |
| 2. Server authority | Pass: API-owned events, counts, permissions and receipts; no money/stock logic changed |
| 3. Concurrency | Pass: unique events/receipts, subscription user lock and version checks, session-isolated UI refreshes |
| 4. Validation/authorization | Pass: bounded strict inputs, staff session/MFA/CSRF and centralized effective permissions |
| 5. Idempotency | Pass: event/entity and delivery keys, subscription versions and worker notification tags |
| 6. Audit/observability | Pass: existing business audit, audited device consent and durable delivery-attempt records |
| 7. External service/cost | Pass: existing Web Push/outbox; WhatsApp behavior and billing unchanged |
| 8. Regression safety | Pass for touched paths; unrelated baseline failures listed above; visual QA limitation recorded |
| 9. Automated scenarios | Pass: API/database and UI/worker runtime acceptance tests |
| 10. Secrets | Pass: encrypted endpoints/keys, generic lockscreen payloads and no committed credentials |

## Release

Additive migration `0081_admin_notifications.sql` was applied transactionally to the verified Neon main database and checksum-recorded. The previously pending, unrelated `0080` migration was left untouched. All three new tables have row-level security enabled. Existing orders/reviews were not altered or replayed.

Final focused run: 82 passed, 4 skipped; business-reset regression: 5 passed. Static source/notification/storage/cache checks passed. Actual owner-phone enrollment remains an explicit browser action by the owner.
