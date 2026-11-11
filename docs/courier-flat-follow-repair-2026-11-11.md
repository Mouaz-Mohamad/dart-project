# Flat courier navigation follow — 11 November 2026

Supersedes the 60-degree camera behavior in the earlier courier repair. The requested navigation is a flat heading-up Google road map, a fixed screen arrow, manual browsing and explicit Recenter. Google remains the only map/routing provider. Dart/Neon business state and the six-second serialized location upload remain unchanged.

## Implementation and evidence

- A centered, pointer-transparent arrow is fixed to the map viewport while following. The native map marker is hidden in this mode; Google `panTo` moves the streets, and vector `setHeading` orients the road ahead upward. The map starts at tilt zero with tilt gestures disabled. The Google map DOM, controls and attribution are never rotated/cropped to imitate native rotation.
- Dragging hides the screen arrow and shows the actual geographic marker with existing interpolation. It also shows the labeled Recenter button. Recenter resumes following the latest position, preserves the route and hides the button again.
- Native map panning replaces application animation of the location marker during follow. Compass/camera updates are coalesced at 250 ms, with no camera writes during first street loading. Sensor updates do not upload locations; server writes retain their six-second cadence.
- Source inspection confirmed a race: the Maps SDK could finish loading after the navigation dialog closed, then construct a map in that hidden viewport. Construction now rechecks the current dialog and nonzero dimensions after the await. Resume attaches a skipped map without rebuilding an existing healthy map.
- The Google drawing surface receives the measured viewport width/height in pixels, updated through ResizeObserver. It does not depend on a percentage-height chain during dialog/browser-bar resizing.
- A vector surface that never paints is replaced once after eight visible seconds by a separate Google raster map. This releases the failing WebGL surface rather than changing its rendering type in place. Route/position/follow state survive. The replacement has a bounded timeout; no reload loop.
- Cached camera movement no longer starts a false tile-load timeout: Google need not emit `tilesloaded` when panning through cached streets. Real raster street-image failures now produce an explicit retry state, rather than being presented as a successful map load.

The hidden-mount race and sizing dependencies are confirmed source-level defects/potential contributors. They do not prove the sole cause of gray streets on the user's handset; that device has not been remotely inspected.

## Verification

- `rep-google-contract`, `rep-navigation-session`, `rep-reliability-runtime`, `rep-compass-runtime`: passed.
- `google-navigation-browser.cjs`: passed in Chromium. Verified the fixed arrow's center and upward orientation in vector mode, map heading changes, zero tilt, drag/pause, labeled Recenter, cached Exit/Resume, no duplicate map, delayed SDK close/resume, fresh GPS before API acknowledgement, delivery gates, image failure/recovery, one bounded renderer replacement, hidden-dialog timers and cleanup. Shared checkout/Places scenarios also passed.
- Real Google provider check, approved production referrer, public Cairo landmarks only: loaded street surfaces covered all 153 sampled viewport points before movement, after eight synthetic position updates and after portrait/landscape resizing. The arrow remained centered; final map-center error was zero metres. Google driving/walking geometry and instructions resolved. The test made no Dart auth/API request or business mutation.
- The real browser environment selected Google RASTER, so actual native vector rotation and physical phone sensor/GPU behavior were **not** certified by that live provider test. Vector rotation was exercised by deterministic browser fixtures. The diagnostic deliberately reports the actual renderer.
- Build, source layout/syntax, database-authoritative storage and security-boundary checks passed. The independently scoped Google navigation budget is 150 KiB (approximately 1.2 KiB additional maintained source); Home/core budgets were not relaxed. The six previously documented unrelated static-suite failures remain outside this courier change.
- The strengthened real-provider coverage/movement/resize check runs in the independent courier CI job for navigation-provider source changes. Commit workflow and Vercel records contain the final deployment outcome.

## Quality review

| Area | Result |
| --- | --- |
| 1. States | Pass: no GPS, loading, slow, timeout/retry, genuine image errors, cached movement and resumed loading. |
| 2. Server authority | Pass: no pricing, stock, cash, delivery eligibility or status changes. |
| 3. Concurrency | Pass: post-SDK visibility guard; skipped-map resume; canceled camera/observer work; stale callbacks cannot replace a newer map. Existing GPS/session guards retained. |
| 4. Auth/input | Pass: existing ownership/auth unchanged; no new endpoint or coordinate input. |
| 5. Idempotency | Pass: attach checks map identity; healthy resume reuses it; failed WebGL recovery constructs at most one replacement. |
| 6. Audit/diagnostics | Pass: no sensitive business mutation; diagnostics add follow state and centre-error distance without coordinates or identity. Existing server audit retained. |
| 7. Cost | Existing Google Cloud usage/billing reports remain authoritative. Normally one map; a failed vector load can incur one replacement map load. No new provider/subscription, route cadence or extra location writes. The bounded provider probe makes one map and two routes. |
| 8. Regression | Pass: courier-specific UI and shared Google courier functions; shared checkout/Places browser flows passed. |
| 9. Tests | Pass for paths above. Physical handset rendering/heading remains unverified and must not be represented as tested. |
| 10. Secrets | Pass: no credentials committed. Deployment-generated restricted public browser key; probe logs no key, customer identity or GPS coordinates. |

## Google platform constraint

Flat and raster are different concepts. Native heading-up rotation still requires Google's vector renderer, even when tilt is zero. Google can choose raster when vector rendering is unavailable; its roadmap raster cannot rotate. In that fallback, the page explicitly explains the limitation, keeps the geographic center followed and rotates the arrow to the real bearing instead of falsely pointing upward. The native-app experience cannot be guaranteed on every mobile browser.

References: https://developers.google.com/maps/documentation/javascript/vector-map ; https://developers.google.com/maps/documentation/javascript/webgl/support ; https://developers.google.com/maps/documentation/javascript/reference/map

Manual handset check: start an assigned delivery, allow location/compass, confirm all streets paint, walk/turn with the arrow fixed, drag to inspect the route, press Recenter and confirm follow resumes. Change phone orientation, Exit/Resume while loading, and repeat with a pickup. Do not confirm real handover solely as a test.
