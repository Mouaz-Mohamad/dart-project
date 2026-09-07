# V7 verification — 2026-09-07

## Passed

- Actual Chromium browser acceptance on desktop (1440 × 1000) and mobile (390 × 844).
- Empty first run; Brand selected; no sample models/items/customers/orders. Newly entered data survives reload.
- Model creation, cost × 1.5 suggested price, manual price override, discount, sizes and multi-image color uploads.
- Four-field item creation; shared image references rather than per-item image copies.
- Groups, All Items and filtered group detail; stable first/second bars; no group selection/actions; selection and bulk archive scoped to displayed physical items; persistent filters.
- Per-color public cards; full model gallery; selected color synchronized with carousel; unavailable sizes disabled; no-photo color remains purchasable with a fallback note.
- Reservation survives navigation; checkout clears cart; order price/cost snapshot stays fixed after model price edit and during existing-order edit.
- Read-only cross-tab dashboard synchronization, preventing stale writes from erasing newly created orders.
- Linked option archive/restore; Sold Out cards remain; model archive removes its public cards.
- No page JavaScript exceptions in the browser acceptance scenario.
- Unit suites: platform, Cairo/Giza address rules, representative authentication/assignment, tracking order resolution.
- Added regression checks: changed cart price requires reconfirmation; expired cart cannot create an order.
- Static HTML/assets/accessibility attributes/integer-money checks; syntax checks for the changed core modules.

## Scope and limits

Browser tests intentionally block external network services. Checkout uses a verified-address fixture; actual live map tiles, geocoding, delivery GPS between real devices, and external CDN uptime are not validated here. Mobile screenshots are generated with isolated test fixtures, not shipping sample records. The checkout form success destination is Home; the automated order scenario calls the checkout API directly and verifies its data effects.

The data layer remains browser-local. Server authentication, database transactions, cross-device persistence and authoritative delivery validation must be implemented by the backend developer using API_CONTRACT.md. No deployment or production database operation was performed.

The V7 reset runs once when this version is first opened on each origin; it does not imply that data in the owner's existing browser has already been removed remotely.

Historical V5 reports describe that earlier version only. This report is the current V7 evidence.
