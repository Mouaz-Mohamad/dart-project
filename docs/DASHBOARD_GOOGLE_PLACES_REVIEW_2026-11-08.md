# Manual order Google Places — 2026-11-08

The manual order dialog now uses Google Places suggestions and a Google Maps viewport. Selecting a suggestion fills the available structured address, validates the governorate/point with the existing server endpoint, and writes the existing latitude, longitude and full-address fields consumed by the order API. Building/floor details remain editable. Complete manual entry remains available when Google is unavailable, subject to the existing delivery-coverage catalog.

## Scope

- `Eye/Dart Eye.html`: keeps `orderAddress` and the order field IDs, adds the Google search control and existing Google configuration/loader/coverage/Places scripts, and loads the new controller. The obsolete address provider is no longer loaded for this dialog.
- `src/dashboard/order-address.js` → `Eye/dart-order-address.js`: lazy Google map, drag/click selection, geocoding, server point validation, exact input snapshots, pending-request cancellation, hidden/reset/logout isolation and manual fallback.
- `Js/dart-checkout-places.js`: exposes the existing component as `DartGooglePlaces.create`; checkout initialization remains intact. Dashboard suggestions have a separate listbox ID and active-dialog guard.
- `Eye/dart-operations.js`: uses the new controller while preserving create/edit payloads and existing save operations. Reopening resizes/reuses the map.
- `Eye/dart-orders.css`: scoped search/listbox styles within the order dialog.
- `scripts/build-home-runtime.cjs`, `src/README.md`: canonical source ownership/build wiring.
- No database migration, new endpoint, order-status, discount, stock or permission change.

## Integration

Google browser configuration continues to come from the deployment-generated `Js/dart-google-maps-config.js`. No new key is committed. This uses the same Maps/Places project as checkout, with Egypt-only predictions, a session token per search session, a 300 ms debounce, a three-character threshold and only the selected place's location requested. Predictions/tokens stay in memory. No map is initialized while the order dialog is hidden.

The location is reverse-geocoded by Google and independently checked with `POST /api/v1/shipping/validate-point`. Late results cannot overwrite a changed field, a reset form, a closed dialog or an account after Staff logout. An incomplete/failed map lookup never leaves old verified coordinates behind.

Google's [Place Autocomplete Data API documentation](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data) specifies a Google Map when autocomplete results are displayed on a map. The dialog therefore replaces its old viewport together with its old search provider.

## Verification

- Production frontend build and source-layout/syntax checks.
- `tests/manual-checkout-contract.cjs`: checkout remains Google-only; dashboard scripts use the new controller/shared component and the existing server validation endpoint.
- `tests/google-navigation-browser.cjs`: actual order markup and layout against synthetic Google/API fixtures; Egypt predictions, keyboard/touch selection, four widths (320, 390, 768, 1440), structured address and coordinates, preserved unit details, pin dragging, rejected server points, late results after modal close/reset, no hidden-dialog requests, reused map and manual fallback. Existing checkout/Places/courier regression cases also run.
- Database-authoritative browser-storage checks.
- The general frontend command encounters an existing upstream image-budget failure: unchanged `Photos/Made For You2.png` is 3,812,540 bytes, exceeding the existing 2.5 MB legacy image ceiling. All other 50 maintained static checks pass. The image and its homepage use are preserved.
- Google/API browser tests use synthetic data and do not create production orders or charge a live Places query. Production verification checks deployed assets/configuration and production aliases; real suggestion quality depends on Google's results and the existing project's enabled APIs/referrer settings.

## Quality review

| Area | Result | Evidence / applicability |
| --- | --- | --- |
| 1. State coverage | Pass | Loading, empty predictions, failed Google/coverage/validation, retry and manual entry. |
| 2. Server authority | Pass | Existing independent point validation and protected order API; no financial/inventory rules moved to the browser. |
| 3. Concurrency | Pass | Input/form generations, abortable point validation, bounded geocoding and hidden/reset/logout guards. |
| 4. Validation/authorization | Pass | Egypt bounds, normalized available governorate, existing Staff order permission and backend ownership/payment rules preserved. |
| 5. Idempotency | Pass | One controller/map per dialog; create/edit save commands and their existing duplicate-submit protection retained. |
| 6. Audit | Unchanged | No durable action during search. Existing order audit runs on save. |
| 7. External cost | Bounded | Existing Google project/quota; lazy map, session tokens and debounced queries. No new paid provider, messaging or billing dashboard is introduced. |
| 8. Regression scope | Pass with baseline note | Shared checkout/Places/courier tests; unrelated upstream image-budget failure recorded above. |
| 9. Automated tests | Pass for changed behavior | Contract, real-browser fixture and source/storage checks above. |
| 10. Secrets | Pass | Deployment-generated browser configuration reused; no key/token/customer address logged or persisted by the picker. |

## Manual acceptance

1. Open Dashboard → Orders → create an order. Type a building/street such as `عمارات بانوراما` in **Search Google Maps**.
2. Select a suggestion using touch/click or arrows + Enter. Confirm the pin, governorate, area and street; add building/floor details and save through the ordinary order action.
3. Drag the pin and confirm it is revalidated. Close/reset the dialog during a pending search and verify it does not fill the next order.
4. Edit an existing order and verify its saved pin is located again. If Google is unavailable, enter the complete manual address; no old pin should remain.
