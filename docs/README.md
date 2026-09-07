# Dart official frontend and dashboard

This package contains the customer website, Dart Eye dashboard and the representative delivery portal. The current data layer is a browser-only prototype. A Node.js / Express backend must replace localStorage before production.

## Main pages

- `index.html` — public home page.
- `products.html` — product catalogue with combined search/filtering and the shared model size-chart dialog.
- `cart-checkout.html` — cart, 15-minute item reservation, COD checkout and OpenStreetMap address selection.
- `profile.html` — customer profile, detailed orders and returns/exchanges.
- `track.html` — order status, fixed destination, live representative marker and ETA.
- `rep.html` — representative registration, approval-gated login and assigned deliveries.
- `Sign Up modern.html` — customer registration/login and password-reset request.
- `Eye/Dart Eye.html` — private brand/dashboard management, including the per-model size-chart editor.

## V7 — Empty dashboard and shared catalogue

This version starts with no models, physical items, customers or orders. At the first visit on each browser origin, `dart-catalog.js` clears the previous Dart prototype data once, as requested by the owner. The `dart_v7_empty_start_completed` marker prevents subsequent resets. New entries survive reloads. There is no automatic demo seeding. This does not delete data on a remote server.

Add a Model first: code, name, category, description, cost, editable selling price (initially cost × 1.5), sizes, colors and each color's gallery, optional discount, and low-stock threshold (default 5). Add Item then requires only model code, unique physical item code, color and size.

Items defaults to Groups. Groups are computed from model + color + size. First and second bars stay in place; only the table changes. Group rows have no checkbox/actions. Opening a group shows the normal detailed item rows with their existing actions and selection. Filters remain active. Rows load in batches of 60.

The public catalogue shows one card per active color with images. A color without an image is still selectable and purchasable inside the model dialog when its chosen size is available. Its fallback image does not change the chosen color. Sold-out cards remain visible; archiving a model hides its cards while keeping records.

Color images are compressed and stored once in IndexedDB, referenced by model/color. Items do not duplicate image bytes. Covers load first, full galleries load on demand. Brand, models and item groups are prioritized; other dashboard sections render afterward. This prototype still reads browser metadata locally; true server pagination is described in `API_CONTRACT.md`.

Existing orders keep their price and cost snapshots. Current model prices apply to future orders. A cart price change requires reconfirmation. Successful checkout clears the cart and returns Home.

## Local run

Serve the project through HTTP because map, service-worker and module security rules do not work correctly from a `file://` URL. For example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

## Checks

```bash
node tests/platform-unit.js
node tests/rep-unit.js
node tests/tracking-unit.js
node tests/address-unit.js
python3 tests/static_checks.py
node tests/catalog-browser.js
node --check Js/dart-platform.js
node --check Eye/dart-operations-v4.js
node --check Eye/dart-size-chart-v5.js
```

Checkout and dashboard address creation accept verified locations in Cairo or Giza only. Building/name and floor are mandatory. Representative delivery confirmation is blocked until a fresh device location is within 1 km of the order coordinates. The browser test requires Playwright and Chromium. Install them in your development environment, or set `CHROMIUM_EXECUTABLE` to a compatible local browser executable. It fails with an explicit message if the browser is unavailable.

See `API_CONTRACT.md` for the mandatory Node.js / Express handoff and `IMAGE_DESCRIPTIONS.md` for the complete accessible-image inventory.

## Production warning

localStorage is not a shared database and must not hold real passwords, National ID images or authoritative orders. Live cross-device tracking requires authenticated server APIs plus WebSocket or Server-Sent Events. Production image files must be stored privately with encrypted storage and short-lived signed URLs.

See `CODE_MAP.md` and `VERIFICATION_REPORT.md` for implementation boundaries and verification.

## V8 corrections

- Contact Us submissions enter the dashboard Review section with source `Contact Us`. Status, rating and title stay `-`; the Review source filter separates contact messages from customer reviews.
- A customer return starts at `Pending Request`. Admin can Accept or Reject it. Accepted returns move to `Pending Inspection`, where Good restores the item to stock and Damaged moves it to Damage.
- The tracking map initializes immediately around the saved order destination. It remains behind a 20% black layer until the assigned representative presses Start Delivery for that specific order. The start action records `deliveryStartedAt`; only then can live location and route/ETA appear.
- Top Clients has mutually exclusive month/year filters. Month defaults to This Month and Year to None. If both become None, the month returns to This Month. Ranking uses delivered order count first and net spending after refunds second.
- Client age is calculated from birthday in Client rows, Top Clients and Birthday. Client History compares the last complete month with the preceding complete month for order-count and spending trends.
- Leaderboard `PIC` now means net retained pieces: delivered physical items minus completed post-delivery returns. Pending and rejected return requests do not reduce the score.
- Run `node tests/v8-features-browser.js` with Playwright/Chromium for the V8 end-to-end checks.

See `VERIFICATION_REPORT.md` for the current verification results.
