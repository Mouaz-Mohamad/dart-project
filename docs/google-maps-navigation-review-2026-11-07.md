# Google checkout and courier navigation — 7 November 2026

## Result and remaining dependency

The code and synthetic browser checks pass. Live Google Maps is still blocked by the existing Google Cloud key restrictions: a bounded browser diagnostic using the deployed browser configuration and the exact checkout URL returned `RefererNotAllowedMapError` for `https://www.dartofficial.com/cart-checkout.html`. The credentials console could not be opened from the connected browser. No Google Cloud restriction, API enablement or billing setting was changed.

The key owner must allow these HTTP referrers on the same browser key configured in Vercel:

- `https://www.dartofficial.com/*`
- `https://dartofficial.com/*`
- `https://dart-project-psi.vercel.app/*` if the original storefront hostname is used.

Keep website restrictions enabled. Enable Maps JavaScript API, Geocoding API and Routes API in that key's project and API restrictions. The new code uses Google's Routes library instead of the prior external route service. These service permissions must be verified after the referrer rejection is resolved; the first authentication error masks downstream service availability.

## Changed behavior

- Checkout shares the Google loader with the courier map, searches written addresses with Google Geocoder, reverse-geocodes selected/GPS/dragged pins and updates governorate, district, street and formatted address. Building and floor still require customer review. Server point validation and shipping coverage remain authoritative.
- Old search, GPS and pin-validation results cannot replace a newer selection. Manual street/governorate edits invalidate the verified pin. Building/floor edits and coverage labels preserve it; these details supplement rather than move the physical location. Network/authentication failures leave a usable manual-address form and a visible error.
- Start delivery opens a native full-screen dialog. Its map occupies 70% of the viewport, with directions above and actions below. The old card-sized map is removed. Exit closes the dialog without changing delivery status; Open navigation reopens it.
- Google Routes supplies road geometry and turn instructions. GPS updates move the courier and update instructions locally. Route requests are throttled, skipped while stationary/closed, and retried explicitly after failures. Sound is an optional browser speech toggle; it is not Google's native Navigation SDK voice.
- The Delivered button updates as accepted GPS readings change and is shown inside the modal only within 1 km of a known customer pin. Confirmation explicitly asks whether the customer received the order and the displayed cash amount was collected. The existing authenticated backend rechecks distance, state and ownership before marking delivery/payment.
- Existing manual orders without a pin retain their explicit manual confirmation on the order card. The modal never claims a one-kilometre match for an unknown destination.
- Shared confirmation dialogs mount inside the active native dialog so they remain visible/clickable. Closing the native parent cancels a pending confirmation safely.

## Scope and data impact

No migrations, database writes, new endpoints, order-state rules, discount rules or WhatsApp rules were introduced. Existing routes used: shipping point validation, representative location updates, assigned work reads and representative order actions. Production diagnostics used public landmark coordinates only; no customer order, stock or delivery was created/completed.

The build refreshed previously stale generated CSS/JS from their checked-in canonical sources. Existing failing CI fixtures were synchronized with current Google login markup and the current checkout-function boundary. One redundant product-filter color was split out of a grouped selector and its reduced-motion rule moved to responsive.css without changing rendered values. Google code has an independent 100 KiB page-only budget; core/lazy aggregate caps remain unchanged. Rebuilding existing stale Home sources required a 1 KiB Home cap adjustment.

## Verification

- `npm run build`: pass.
- `npm run check`: pass, including source ownership and all 50 maintained static checks.
- `node tests/database-authoritative-storage.cjs`: pass.
- `node tests/google-navigation-browser.cjs`: pass in Chromium with synthetic Google, representative API and GPS responses. Scenarios: forward/reverse lookup, newer map choice superseding delayed search, manual invalidation, late Google auth failure, 70% map sizing on mobile, no inline map, route error/retry, exit/reopen without status changes, live one-kilometre eligibility, visible real confirmation dialog, cancel without mutation and confirm with completion.
- Syntax and `git diff --check`: pass.
- Live Maps diagnostic: blocked by `RefererNotAllowedMapError`. Geocoding and routing cannot be certified live until Google Cloud permissions are corrected.

## Quality review

| Section | Result |
| --- | --- |
| 1. State coverage | Pass: loading, no pin, stale/denied GPS, provider error and retry states. |
| 2. Server authority | Pass: existing server point/geofence/status/payment checks retained. |
| 3. Concurrency | Pass: selection versions, stale mount guards, one route request at a time and action locks. |
| 4. Validation/auth | Pass: no new server surface; existing authenticated assignment endpoints retained. |
| 5. Idempotency | Pass: repeated UI actions locked; existing authoritative order transition used. |
| 6. Audit | Existing audited backend transition retained; no new sensitive server operation. |
| 7. External cost | Partial: requests bounded and page-scoped. Usage/cost remains in Google Cloud metrics/billing, not a new Dart finance ledger. No WhatsApp change. |
| 8. Regression | Pass: 50 static checks, generated-source freshness, current shared confirmation behavior and explicit unchanged rendered CSS values. |
| 9. Tests | Pass for automated/synthetic paths; live Google services remain blocked as above. |
| 10. Secrets | Pass: no actual key committed/logged. The intended restricted public browser key remains injected by Vercel at build time. |

## Manual check after Google Cloud correction

1. Open checkout with an existing cart. Search an Egyptian street; inspect the pin, governorate, district and street. Tap another point, drag it, and use GPS. Verify building/floor and shipping coverage before placing any real order.
2. For an assigned test order, Start delivery. Verify full-screen layout, turn banner, road path and optional sound. Exit and reopen; status must remain On The Way.
3. With fresh GPS outside 1 km, Delivered stays hidden. Within 1 km it appears. Cancel confirmation first; then confirm actual physical receipt and collection only when a real delivery occurs.

## Post-deployment CI observations

Vercel production succeeded and served all four reviewed JavaScript files byte-for-byte; frontend/API health checks returned 200. GitHub static checks and the new Google browser test passed. The broader browser job stopped in the existing Products navigation/history scenario; backend checks stopped on the pre-existing unused `customerPasswordOrThrow` helper in social-auth.service.ts (not modified here). These unrelated checks are not represented as passing.

## Live recheck — 8 November 2026

After the owner corrected Google Cloud settings, the actual checkout viewport displayed a Google map on www.dartofficial.com. A bounded Routes API request for two public Cairo landmarks returned a route. Live Google search reached the checkout controller but its governorate mapping rejected the result. The follow-up correction accepts long/short administrative names, removes Unicode direction controls, supports Arabic/English governorate affixes, and checks administrative-area/locality fallbacks when level 1 is absent. Unknown names still fail closed; the server still validates the chosen pin against governorate polygons.

The browser regression now loads the real checkout coverage controller rather than a canonicalizer stub. It uses synthetic Arabic Google components with direction marks and verifies that building/floor and shipping-area changes preserve a verified pin. The real canonicalizer also has static regressions for Arabic/English labels, direction marks, prefix/suffix variants and unknown-region rejection. Build, all 50 static checks and the isolated Chromium checkout/courier test passed before publication. No order was submitted or delivery marked during live verification. Live address search/pin verification must be repeated after publication of this follow-up.

| Quality area | Follow-up result |
| --- | --- |
| States | Pass: unknown governorates still show a recoverable error. |
| Server authority | Pass: polygon and coverage validation unchanged. |
| Concurrency | Pass: existing version checks and action locks retained. |
| Validation/auth | Pass: no new endpoint or permission. |
| Idempotency | No new durable operation. |
| Audit | Existing server workflows retained; no new audited action. |
| External cost | Existing Google Cloud usage reporting; no Dart billing ledger added. |
| Regression | Pass: build, source freshness and 50 static checks. |
| Tests | Pass: real coverage mapping plus isolated Chromium flows. |
| Secrets | Pass: no actual API key or sign-in value in changes/logs. |

## Checkout type-ahead — 8 November 2026

The owner clarified that address search must suggest matching buildings/places while typing. A live Places API (New) request for the owner-provided public complex name returned two matching Panorama Gardens buildings. The new checkout-only Places controller uses Google's AutocompleteSuggestion API, Egypt filtering, Arabic results and the visible map as a ranking bias. Predictions appear after three characters and a 300 ms typing pause. They remain in memory, use a fresh Google session token after each selected place, and never change a delivery destination until the customer selects one. Selection fetches only location, then reuses the existing reverse lookup and server polygon/coverage checks. Arrow keys, Enter, Escape, pointer/touch selection, stale responses, composition input, service errors and the original Search fallback are handled. Checkout stays pending during selected-place lookup; editing or cancelling the lookup releases that pending state safely.

Files: new Js/dart-checkout-places.js, checkout HTML wiring, two small read/pending hooks in the existing checkout controller, CSS and generated CSS, build contracts, browser regressions and the independent checkout/courier size cap (112 KiB, allowing the new page-only module). No database migration or endpoint is added. Existing money, inventory, order, representative and discount rules are unchanged.

| Quality area | Result |
| --- | --- |
| 1. States | Loading, no results, service error, selection error and Search fallback covered. |
| 2. Authority | Existing server point/coverage validation reused; pending selection blocks checkout. |
| 3. Concurrency | Debounce and sequence/snapshot checks reject stale predictions/details. |
| 4. Validation/auth | Public place lookup, Egypt restriction and existing checkout authorization retained. |
| 5. Idempotency | No new persistent mutation; selecting a prediction only verifies a draft location. |
| 6. Audit | No new sensitive server operation; existing order audit unaffected. |
| 7. External cost | Three-character threshold, debounce, session-token rotation and minimal Place Details fields; cost reporting stays in Google Cloud. |
| 8. Regression | Original Search, map clicks, manual address, GPS and courier behavior retained. |
| 9. Tests | Browser coverage includes live-list behavior with a mocked Google service, keyboard selection, token rotation, delayed details/checkout guard, out-of-order suggestions, Escape and error/Search fallback. |
| 10. Secrets | No actual key or credential added; no prediction persistence or query logging. |


## Courier arrow and blue route — 8 November 2026

The owner requested a moving navigation arrow and a blue road route, and explicitly removed the directions banner. The full-screen dialog now starts with the Google map occupying 70% of the viewport; the lower 30% contains Exit, Follow my location, proximity, recoverable route errors and Delivered when eligible. The turn banner and its optional speech control are removed. The customer destination remains a pin; the courier uses a white-outlined blue arrow above the blue route. The map starts at the courier with zoom 17 and follows accepted fresh GPS updates. Dragging pauses camera follow while the arrow keeps updating; the Follow button recenters and resumes it.

Heading comes from moving-device GPS when available, otherwise from movement beyond the reported accuracy / eight-metre jitter threshold. Unknown or stationary GPS heading does not reset a known course to north. Stale or older location updates cannot move the live arrow/camera. Off-route detection, bounded route refresh, retries, route warnings, exit/reopen, server delivery authorization and the one-kilometre completion gate remain. This is the website's Google road-route display with a custom heading marker; native Google Maps app navigation is still available through the existing external link.

Changed files: rep.html, Js/dart-google-maps.js, Js/dart-rep.js, CSS/main.css and generated CSS/home.css / CSS/home.min.css, tests/google-navigation-browser.cjs, and this report. No database migration or endpoint change.

| Review area | Result |
| --- | --- |
| 1. States | Pass: waiting/stale GPS, manual destination, route loading/error/retry and empty/closed dialog retained; route status is below the map. |
| 2. Authority | Pass: delivery completion continues through the existing server action; no pricing, stock or eligibility change. |
| 3. Concurrency | Pass: existing map-generation and route-request identity guards retained; older live marker updates ignored. |
| 4. Validation/auth | No new endpoint; coordinate/timestamp/heading validation and existing representative ownership retained. |
| 5. Idempotency | No new persistent operation; existing action locks and receipt/collection confirmation retained. |
| 6. Audit | No new sensitive operation; existing server delivery audit remains authoritative. |
| 7. External cost | Arrow movement/follow/recenter use local map methods; no added route queries or cadence changes. Existing Google Cloud usage reporting remains the cost source. |
| 8. Regression | Pass: source checks, 50 frontend static checks, database browser-storage contract and isolated browser checkout/courier flow. |
| 9. Tests | Pass: blue route, heading and movement fallback, stationary course preservation, camera follow/pause/recenter, stale GPS rejection, no banner, 70% mobile/desktop map, route error/retry, exit/reopen, 1 km gate and cash confirmation. Google/GPS are synthetic; no real order changed and no physical driving test claimed. |
| 10. Secrets | Pass: no actual key, credential, customer data or persistent location cache introduced. |

Manual check after publishing: sign in as the assigned representative, start the actual delivery, allow accurate location and keep the page open. Check the blue route and arrow while moving. Drag the map then press Follow my location. Exit/reopen without changing delivery status. Mark Delivered only after physical receipt and actual cash collection inside the allowed radius.


## Smooth vector navigation camera — 8 November 2026

The owner requested navigation-style smoothness and a 45–60 degree oblique camera, then clarified the courier map must be a directional vector map. The courier-only Map now requests VECTOR rendering, 60-degree tilt and fractional zoom. During follow, moveCamera keeps the road ahead at the top using the moving GPS course. The arrow's screen angle compensates for the camera heading; free exploration keeps its correct orientation. Google automatically constrains tilt by renderer/zoom/device capability; the existing working flat map remains available if the device falls back to raster. No CSS perspective imitation or production demonstration map ID is used.

Fresh device GPS now previews the arrow before the API throttle and response. The preview never updates an order or enables Delivered. The existing server-acknowledged location still controls delivery proximity, route queries and completion. GPS sample timestamps prevent a delayed acknowledgement from reversing a newer visual position; older responses also cannot replace a newer acknowledged in-memory position. Server location-write frequency and route-query limits are unchanged.

Marker position and heading interpolate between actual fixes using requestAnimationFrame for 300–1000 ms, taking the shortest angular turn across north. Camera center and heading use the same frame, avoiding competing pan animations. No movement is extrapolated beyond a real fix. Stationary headings are retained; missing course uses movement outside the GPS uncertainty threshold. Large discontinuities snap to the real position. Closing cancels animation; hidden tabs and reduced-motion preferences skip interpolation. These changes are limited to Js/dart-google-maps.js, Js/dart-rep.js, the existing synthetic browser regression and this report. No endpoint or database migration.

| Review area | Result |
| --- | --- |
| 1. States | Pass: vector initialization/raster fallback, no course, stopped GPS, reduced motion, hidden/closed map and existing loading/error/retry handled. |
| 2. Authority | Pass: preview is visual-only; eligibility still waits for the acknowledged server location and the existing delivery endpoint. |
| 3. Concurrency | Pass: GPS sample ordering, stale response rejection, retargeting from the drawn position and cancellation prevent rollbacks/orphan animation. |
| 4. Validation/auth | Pass: validated coordinates and fresh timestamps required; no new permission or endpoint. |
| 5. Idempotency | No new durable operation; duplicate visual targets do not restart animation. Existing action locks retained. |
| 6. Audit | No new sensitive operation; existing status/location server flows remain authoritative. |
| 7. External cost | Local animation only; existing location throttle and Routes refresh limits retained. Billing visibility remains in Google Cloud. |
| 8. Regression | Pass: source checks, all 50 static checks and database-only storage contract; checkout/Places behavior also covered by the browser regression. |
| 9. Tests | Pass: vector/60-degree camera request, forward-facing arrow, intermediate position frames, shortest 350→10 degree turn, paused follow/recenter, raster/reduced-motion fallback, close during animation, delayed API and newer throttled GPS without early Delivered or visual rollback; existing route retry/1km/cash confirmation preserved. GPS, Google and API responses are synthetic; physical driving smoothness and each device GPU are not certified by these tests. |
| 10. Secrets | Pass: no key, credential, customer data or persistent location storage added. |

Manual acceptance: refresh rep.html, start an actual assigned delivery and allow precise location. With the page open and the device moving, verify the road ahead stays up, the camera is oblique on supported vector devices and the arrow moves smoothly. Drag to inspect and use Follow to resume. Confirm receipt/collection only after real delivery.

Google references: https://developers.google.com/maps/documentation/javascript/map-rendering-type and https://developers.google.com/maps/documentation/javascript/vector-map (VECTOR can be requested without a map ID; zoom 17 supports a 60-degree tilt, subject to renderer capability).
