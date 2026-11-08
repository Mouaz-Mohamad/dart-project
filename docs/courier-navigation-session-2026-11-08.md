# Courier navigation session — 8 November 2026

## Behavior and scope

- The map occupies 80% of the viewport; primary Exit and Delivered controls come first below it. Existing Google arrow, road geometry, vector/raster recovery and following behavior remain.
- Exit closes the native dialog while keeping the map, route, navigation progress and GPS subscription in memory. Resume opens the same map and requests a resize. Terminal status, assignment removal, logout and changing the active destination dispose the previous session. Retry intentionally creates a fresh map.
- Text instructions and approximate straight-line distance to the next turn update from the accepted GPS/route steps. Stale GPS produces a visible warning instead of continuing to assert fresh directions. Completion requires server-acknowledged fresh GPS.
- Known-pin delivery completion is allowed at 500m or less in both the UI and the authenticated server transition. The existing receive/payment confirmation, audit and transition code remain. Return pickup keeps its previous 1km radius; manual orders keep their explicit no-pin flow.
- Supporting browsers offer an explicit Floating directions button using Document Picture-in-Picture. It requires a user click and ends when the opener closes. It contains written directions, not a second map. Android Chrome does not support Document PiP. The external Google Maps link is the mobile alternative; background browser GPS cannot be guaranteed. No claim of an automatic Android overlay or navigation after closing the site is made.

No migrations or endpoints added. Existing representative status endpoint has a stricter delivery radius. Files: rep.html, CSS/main.css and generated CSS, Js/dart-rep.js, Js/dart-google-maps.js, commerce.service.ts, regression tests/inventory and their CI wiring. Page-only Google code budget increased from 116 to 120 KiB for retained-session controls and floating directions; Home budgets unchanged.

## Validation

Build, source checks, 51 frontend static checks and database-authoritative browser storage pass. Synthetic navigation tests execute retained close/reopen, no new map/route on reopen, 499/501m, stale/missing GPS, unchanged pickup radius, cleanup at completion. Server guard tests exercise 499/500/501/750m. Targeted commerce/order tests and TypeScript/lint for touched backend files pass.

Full backend suite has pre-existing unrelated failures in waiting.contract, migration-naming and migration-isolation (76 expected migrations versus 77 present). Full backend lint also fails on the untouched unused customerPasswordOrThrow helper. Chromium cannot launch locally because its executable is unavailable; the updated browser regression is not certified locally. No real delivery/customer data is mutated during verification.

## Quality review

| Section | Result |
| --- | --- |
| 1 States | Pass: waiting, route/provider errors, stale GPS, no pin, ended session and resume. |
| 2 Server authority | Pass: server geofence tightened; payment/status authority preserved. |
| 3 Concurrency | Pass: existing action locks and route-entry/request identity guards preserved. |
| 4 Validation/auth | Pass: existing assignment/auth/location validation unchanged. |
| 5 Idempotency | Existing guarded state transition and submit locks preserved. |
| 6 Audit | Existing server transition audit preserved. |
| 7 Cost | Bounded route refresh preserved; local text/PiP has no provider request. Google usage remains in Cloud billing; no new finance ledger. |
| 8 Regression | Static and synthetic tests pass; live browser/GPS remains unverified. |
| 9 Tests | Added runtime session/geofence and server guard regressions; browser test updated but locally blocked. |
| 10 Secrets | No new keys, secrets or customer records. |

Manual check: Start an assigned delivery; verify streets/arrow/blue route and written turn instructions, Exit, Resume with no reload, then verify completion hidden outside 500m and fresh GPS inside 500m. Cancel confirmation first. Confirm only after an actual handover/payment. Check a supporting desktop browser's explicit Floating directions button and mobile Google Maps link. Revoke assignment or log out to verify session cleanup.
