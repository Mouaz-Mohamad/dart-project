# Courier Google navigation repair — 2026-11-11

The courier navigation uses Google Maps JavaScript and the Google Routes library exclusively. Device GPS and an absolute compass provide local position/heading; existing Dart/Neon authorization, orders, handover rules and audit remain authoritative. No alternate tiles, router, database migration or new service was introduced.

## Changes

- Keep the first viewport still until streets finish loading; coalesce camera changes to at most once per second while interpolating the marker locally. A pending street request does not get reset by every GPS fix.
- Observe the real map viewport across dialog/mobile browser resizes. Preserve Google-native sizing for map imagery/canvas.
- Watch initial streets and later camera loads. After a 12-second vector stall, switch the same Google map once to its supported raster renderer, retaining the path, pins and controls. A complete outage produces an explicit error and retry, without remount loops. A working vector keeps its 60-degree camera; raster remains flat.
- Add an opt-in absolute phone compass, with permission requested during the user gesture. Reject arbitrary relative alpha, handle landscape orientation and inaccurate/stale readings, and stop sensor listeners on exit, hiding or logout. A late permission grant cannot restart a closed navigation session.
- Request Google driving directions using `TRAFFIC_AWARE_OPTIMAL`; offer independent walking directions, without a driving-only traffic preference. Show Google distance/time and the required pedestrian warning. Preserve ordered Google instructions rather than jumping to a nearby later crossing road.
- Use the newest fresh local GPS for both the route origin and initial map before the server acknowledgement. Local movement and compass events do not write business state or relax delivery eligibility. Location uploads remain serialized and spaced six seconds apart.
- Keep the existing compact Exit/Arrived footer, retained navigation on exit/resume, manual rotation and explicit recenter behavior.

## Verification

- Build, browser source/syntax/layout, storage authority and cross-layer security contracts passed.
- `rep-google-contract`, `rep-navigation-session`, `rep-reliability-runtime` and the new `rep-compass-runtime` passed. Covered initial/later tile stalls, one recovery, delayed streets, hidden/closed dialogs, route retention, manual rotation, bounded camera requests, fresh route origins, ordered steps, compass permissions/staleness and six-second uploads.
- `google-navigation-browser.cjs` passed locally in Chromium headless shell: checkout/Places regressions, real deployment CSP, mobile/desktop map sizing, compass without fake movement, 60-degree vector follow, walking/driving options, local GPS before delayed API acknowledgement, stale fixes, delivery gates and cash confirmation.
- Full static inventory: 48/54 passed. Six existing failures remain in cart/council fixtures, a missing test-fixture helper, homepage review styling, non-courier core/image budgets, duplicate dashboard HTML attributes and unrelated notification-test CI wiring. The courier navigation payload passes its separately bounded 148 KiB budget; Home/core budgets were not relaxed.
- Added an independent courier CI job step for a bounded real Google provider check whenever the renderer, compass or provider probe changes: one map and two routes between public Cairo landmarks under the approved production referrer, using current source and production CSP. It never loads Dart auth/API code or uses real customer/courier coordinates. Outcome is recorded in the commit's workflow logs. Local outbound requests to Google returned `ERR_EMPTY_RESPONSE`, so local synthetic browser success alone is not presented as proof of a real phone/provider fix.

## Quality review

| Area | Result |
| --- | --- |
| 1. States | Loading, slow, recovering, error/retry, no fresh GPS, sensor permission denial/unavailable and walking warnings covered. |
| 2. Authority | Existing server handover/proximity, payment, stock and order state remain authoritative. |
| 3. Concurrency | Existing session/request guards retained; mode changes invalidate old routes, one GPS upload, late permission and shared Maps visibility handlers cannot resume a closed compass. |
| 4. Validation/auth | No endpoint changes; existing courier ownership/auth retained. Compass only accepts finite absolute readings. |
| 5. Idempotency | No new business mutation. Renderer recovery is bounded; retries reuse a healthy map/route where applicable. |
| 6. Observability | Existing business audit retained; map diagnostics expose renderer, timing, viewport and recovery reason without order IDs or GPS coordinates. |
| 7. External cost | Google remains the sole map/router. Existing Google Cloud usage/billing reports are the owner's cost source. Routes remain serialized/throttled; live probe is limited to one map/two routes per renderer/compass/probe-changing commit. Traffic-aware optimal can cost more than basic directions; no new paid provider or subscription added. |
| 8. Scope | Courier UI plus shared Google loader and build/test contracts; checkout/Places regression passed. No homepage or business-rule changes. |
| 9. Tests | Critical paths above passed; real-provider and deployment results belong to commit CI/deployment records. Physical compass/GPU/mobile-network behavior still requires a real handset check. |
| 10. Secrets | No key/token committed. Restricted public browser key remains deployment-generated; probe suppresses keys/URLs from failure output. |

Web Maps does not provide the native Google Maps/Uber application runtime or unrestricted background navigation/PiP. A hardware sensor/GPU or mobile-network fault cannot be certified from synthetic tests. A 60-degree view requires a working Google vector renderer; the recovery deliberately keeps a usable flat Google map on devices where vector cannot complete.
