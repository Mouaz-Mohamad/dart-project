# Dart corrections

- Added local account registration/login with normalized unique email and phone checks.
- Added dynamic profile fields and editing; customer ID remains immutable.
- Connected website orders, inventory, customers, returns and reviews to the same local development store used by Dart Eye.
- Limited checkout to cash on delivery.
- Added dynamic order tracking and representative status updates.
- Removed fake public reviews, leaderboard identities and demo dashboard defaults.
- Added verified-purchase review and 14-day return eligibility checks.
- Applied birthday discount 30% and Dart Card 40%, maximum 10 items or one year.
- Excluded customers with an active Dart Card from later monthly draws until the card expires by time or 10 delivered items.
- Added 15-minute physical-item cart reservations with automatic release and a visible countdown.
- Locked feedback until the signed-in customer has at least one Delivered order.
- Rebuilt Profile order and return views as detailed responsive cards.
- Added responsive/accessibility corrections without changing the desktop identity.
- Added unique page metadata, canonical URLs, robots.txt, sitemap.xml and a working service worker.
- Added policies and a Node.js/Express API handoff contract.

Security note: localStorage is suitable only for frontend development. Production authentication, uniqueness, authorization and data integrity require the backend controls in `API_CONTRACT.md`.

## Operations V4 — 5 September 2026

- Saved `subtotal`, `discountAmount` and `finalAmount` on every new order and migrated older local orders to the same calculation.
- Standardised all visible EGP values as whole pounds without piastres while preserving precise order calculations internally.
- Added shared OpenStreetMap search, pin selection, reverse geocoding and manual-address forward geocoding to checkout and dashboard order entry.
- Required country, governorate, area, street, building and coordinates; V5 later made floor mandatory as well.
- Rebuilt the representative portal with registration, approval-gated login, four supported identifiers, three protected verification-image uploads and multiple assigned-order cards.
- Added representative start/stop/delivered actions, live location sharing, fixed customer destination, route drawing and OSRM ETA on representative and customer tracking maps.
- Removed map zoom controls and applied a clean light map style.
- Added dashboard approval/rejection, verification-image previews and temporary-password controls for representatives.
- Added customer/representative password reset requests to the dashboard and forced replacement of admin-issued temporary passwords.
- Converted serial verification success/failure results completely to English and kept owner names privacy-masked.
- Added a real leaderboard: verified delivered-order candidates first; privacy-masked random registered accounts marked not eligible when there are no purchases.
- Added one-time local demo cleanup retaining exactly three model records and twelve physical item records.
- Added meaningful image alternatives and `IMAGE_DESCRIPTIONS.md` for every bundled raster/SVG asset.
- Expanded the Node.js/Express handoff with authoritative price, address, representative, tracking, reservation and security contracts.
- Added repeatable unit/static checks under `tests/`.

## Catalogue and delivery V5 — 5 September 2026

- Added one reusable customer size-chart dialog that fills itself from the selected model's saved measurements.
- Added a Size Chart action to every Models row in Dart Eye and one shared editor for size, chest, waist, hip, length, shoulder, sleeve, inseam and notes.
- Added combined catalogue search, category, size, color, availability and price filters, sorting, result count, Clear and no-results feedback.
- Added consistent loading, empty, error, offline and unavailable-image states without replacing the existing visual identity.
- Restricted checkout and manual dashboard orders to reverse-geocoded Cairo or Giza governorates; every other governorate is rejected.
- Required country, governorate, area, street, building and floor, plus a verified map coordinate, for both mapped and manually entered orders.
- Updated the checkout delivery promise to Cairo and Giza within 12 hours and refreshed the service-worker cache version.
- Added address and catalogue interaction tests, and expanded the Node.js/Express contract for delivery-zone enforcement and model size charts.

## Interface and order-flow V6 — 5 September 2026

- Restored the original Leaderboard card structure and styles; live delivered-order data uses the same original row classes.
- Collapsed the complete Products search/filter area behind a reusable Filter products button without resetting active filters.
- Made the product Size Chart scroll vertically and horizontally inside its own viewport, with sticky headers, a sticky Size column, an X button, outside-click close and Escape close.
- Repaired the hidden Checkout map sizing by invalidating Leaflet after the Checkout section becomes visible.
- Fixed order completion so the order remains in shared dashboard storage, the cart is cleared, the last order is remembered for tracking and the customer returns to Home.
- Removed the dashboard's destructive first-open data reset that could erase a website order before the dashboard displayed it.
- Restored the original Track Order card layout and added fallback to the last checkout order or the signed-in customer's latest order.
- Darkened and disabled the tracking map until a representative is assigned; kept order number, status, items and total visible with an undetermined ETA.
- Rebuilt representative authentication in the customer Sign In visual language while keeping Login and Create Account mutually exclusive.
- Removed the representative-page map, stacked every assigned-order card full width and added Google Maps directions when Start delivery is pressed.
- Kept Delivered hidden until delivery starts and a fresh representative location is within 1 km of the saved order destination; the same check is enforced again on click.
- Restored the 300px Action cell in the dashboard representative table so every value aligns with its title column.
- Updated the service-worker cache version and added regression checks for tracking resolution, proximity and the revised structures.
