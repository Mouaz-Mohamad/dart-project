# Direct updates on the existing Vercel / Neon deployment

- `0072_direct_change_signals.sql` sends committed version invalidations using PostgreSQL NOTIFY. It stores no extra business records and sends no email or WhatsApp.
- The API shares one direct LISTEN connection per active instance. It closes that connection when its last subscriber leaves. No listener SQL polling runs in the background.
- Public `/api/v1/catalog/changes` exposes only catalog version signals. `/api/v1/admin/changes` uses the existing Staff session, MFA and domain read policy, rechecked before each signal batch.
- Streams last at most 240 seconds inside the existing 300-second function limit. Payloads, pending topics and stream counts are bounded. Browser tabs close their stream when hidden, offline or logged out.
- A successful stream pauses the three-second Orders/domain/catalog checks. A change refreshes only its authorized affected domain. Reconnect and a small once-per-minute integrity check reconcile persistent versions, including clock-driven reservation expiry. Unchanged versions do not download full snapshots.
- Signals arriving during an in-flight read or order mutation are reconciled afterward. Failed local writes retain their existing recovery path.
- The browser checks the API's `direct-updates-v1` capability before opening EventSource. An older/disabled API retains the existing polling behavior. `DIRECT_UPDATES_ENABLED=false` disables the runtime feature without changing business data.
- Existing GPS, finance-report and other specialized timers remain separate. This release does not claim that every timer or every API request has disappeared.
- No new provider, subscription or dependency is added to production. Existing Vercel/Neon resource usage still applies; this is not a guarantee of a zero hosting bill.

## Verification

`backend/tests/change-stream.test.ts` covers shared listeners, malformed signals, missing migrations, disconnect/capacity, public/domain permission isolation, HTTP auth/MFA/origin denial, active revocation, and commit/rollback notification timing on CI PostgreSQL.

`tests/direct-changes-runtime.cjs` and `tests/direct-changes-browser.cjs` exercise the actual browser entry point, native EventSource, reconnect reconciliation, hidden-tab cleanup, unsupported API fallback and logout isolation. `backend/tests/order-browser-concurrency.test.ts` covers a notification arriving during a local mutation.

| Quality area | Evidence / scope |
| --- | --- |
| Empty/loading/error states | Startup timeout, capability fallback and disconnect recovery |
| Server authority | Signals invalidate reads; never write prices, stock or orders |
| Concurrency | Shared listener, burst coalescing and read/mutation reconciliation |
| Authorization/input | Existing centralized domain policy; bounded typed signal validation |
| Idempotency | Version comparisons and fresh reads tolerate duplicate signals |
| Observability | Standard HTTP request logs; bounded unavailable/denied responses |
| External costs | Existing infrastructure only; no outbound customer messages |
| Regression | Existing static/backend suites and full-site Chromium smoke |
| Critical tests | Feed, authorization, TCP commit/rollback and browser lifecycle tests |
| Secrets | Cookie-based auth; no credentials in URLs, frames or frontend code |
