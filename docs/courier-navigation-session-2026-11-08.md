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

## Follow-up: two controls and reference appearance

The latest revision supersedes the optional controls described above. The footer now contains exactly two Arabic buttons: خروج and وصلت. The 80% map viewport has a teal direction banner with maneuver arrow and written directions above the map. Routine renderer/proximity/debug messages no longer occupy the footer. Provider errors remain visible over the map and explain that closing/reopening retries a failed session; healthy sessions remain cached. The map uses the light palette and hides default Google control buttons. Dragging pauses follow temporarily and automatically resumes after eight seconds so no extra recenter control is needed. Google attribution is preserved.

The unsupported desktop-only floating-instruction control has been removed. This change does not deliver an Android floating map. Chrome Android video PiP does not expose the map's HTML/WebGL view as a native PiP activity; Dart needs an Android app with native PiP for that experience. A PWA shortcut alone does not supply it. Vector tilt remains conditional on the device/renderer; the photographed flat map is the existing raster fallback. No fake CSS perspective or repeated vector retries are used.

Follow-up quality review: sections 1, 3, 8, 9 and 10 pass the local build, 51 static checks and retained-session synthetic test. Sections 2, 4, 5 and 6 preserve the existing server validation, assignment permissions, idempotent transition and audit; no backend change in this revision. Section 7 preserves bounded route loads and adds no paid service. Browser regression now checks the two buttons, Arabic labels, teal banner and hidden default map UI, plus existing map/session/geofence paths. Local Chromium remains unavailable; live GPS and actual Android rendering still require device verification. No migration or endpoint added.
