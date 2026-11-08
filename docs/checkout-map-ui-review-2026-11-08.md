# Checkout map and address search — 2026-11-08

The checkout map now has a white rounded search bar floating over its upper edge, with Google Places suggestions immediately beneath it. The map is taller (460px desktop, 420px mobile), stays in the LIGHT roadmap color scheme, and includes a floating current-location button. The search input has an Arabic placeholder and supports mixed Arabic/English queries. Google attribution stays clear of the location button.

## Scope

- `cart-checkout.html`: one map card around the existing search, map viewport and GPS button; existing IDs and address fields remain connected.
- `CSS/main.css`, `CSS/responsive.css`: scoped map/search/prediction styles and mobile sizing; generated `CSS/home.css` and `CSS/home.min.css` rebuilt.
- `Js/dart-checkout-google.js`: explicit LIGHT map initialization, cooperative gestures and visible loading/error paragraphs below the floating search.
- `Js/dart-checkout-places.js`: preserve input focus on pointer selection so touch/pen clicks can finish selecting a prediction before blur closes it.
- Existing Google loader, Egypt restriction, session tokens, three-character/300ms prediction debounce, stale-response guards, coverage validation, manual address fallback, GPS behavior and pin dragging are retained.
- No database migrations, endpoint changes, new services, courier-map changes, order mutations or messages are part of this task.

Google documents setting `colorScheme` at map initialization: https://developers.google.com/maps/documentation/javascript/mapcolorscheme.

## Verification

- `npm run build`: build and production asset staging.
- `npm run check`: maintained source checks and all 50 frontend static regressions.
- `node tests/google-navigation-browser.cjs`: synthetic Google/Places with touch and dark device settings; map stays LIGHT; overlay bounds and pointer hit testing at 320/390/768/1440px; touch and keyboard selection; empty/error suggestions; out-of-order results and pin/coverage verification; existing courier navigation regressions.
- `node tests/checkout-address-browser.cjs`: manual checkout without Google, shipping guards, stale address snapshots and visible fallback text below search.
- `DART_CSS_BASE_REF=HEAD node tests/css-cascade-browser.cjs` against the pre-change revision: unchanged surfaces compared at five screen widths. The intentionally redesigned map card is excluded from this equivalence comparison and covered by the dedicated Google browser tests; all other checkout surfaces remain compared.
- `git diff --check` and syntax checks on the modified scripts/tests.

Browser checks use synthetic places, coordinates and server responses; they do not certify Google billing/permissions, make paid Maps requests, submit real orders, or access customer data. Visual inspection used a synthetic map viewport with real checkout markup/styles. Production verification checks the deployed HTML/asset revisions and Vercel aliases after the single main update.

An additional legacy check, `tests/css-architecture.js`, fails on the existing dashboard Boxicons `@import`. This is unchanged in the baseline and is already documented under `legacyRewrite` in `tests/test-inventory.json`; it is outside the maintained 50-check suite and outside this checkout task.

## Quality review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. States | Pass | Existing empty/loading/error suggestions; map loading/error copy remains visible under search; manual fallback tested. |
| 2. Server authority | Pass | Existing server pin/coverage validation retained; pricing, stock and checkout submission unchanged. |
| 3. Concurrency | Pass | Existing request versions and snapshots retained and exercised with delayed/out-of-order Google responses. |
| 4. Validation / authorization | Pass | Existing Egypt and shipping guards retained; no endpoint or permission changes. |
| 5. Idempotency | N/A | Presentation and existing address reads only; no new durable mutation. |
| 6. Audit | N/A | No new sensitive operation or status change. |
| 7. External-service cost | Pass | Existing loader/debounce/session lifecycle reused; no added Google request path or WhatsApp sends. Existing Maps usage remains subject to its configured billing. |
| 8. Regression safety | Pass | Styles scoped to checkout map/predictions; generated assets rebuilt; unchanged page styles and courier flows checked. |
| 9. Tests | Pass | Dedicated overlay, dark mode, pointer selection, fallback, address and navigation checks described above. |
| 10. Secrets | Pass | No credentials/configuration values introduced or changed. |

## Manual acceptance

1. Open the cart and proceed to checkout on mobile and desktop; the search bar appears over the top of the map.
2. Type at least three characters of an Egyptian place or street (for example `عمارات بانوراما الحدائق`); suggestions should appear below the bar according to Google's results.
3. Select a suggestion by touch or ArrowDown/Enter; confirm the pin and address populate after server verification. Check building/floor fields before submitting.
4. Try current location and dragging the selected pin, then verify the location/address again.
5. With the device in dark mode, confirm that the map and search remain light.
6. Block Google/network access and confirm that the fallback message is visible and manual address entry remains available subject to coverage.
