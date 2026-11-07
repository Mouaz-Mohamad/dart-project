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
