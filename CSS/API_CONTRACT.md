# Dart Node.js / Express API contract

The frontend currently uses localStorage as an executable prototype. The backend must become the only source of truth. Set `window.DART_API_BASE_URL` before `Js/dart-platform.js` when API integration begins.

## Non-negotiable server rules

- Use Node.js with Express and a transactional database selected by the backend developer. PostgreSQL is recommended for orders, unique identities, inventory reservations and reporting.
- Store passwords with Argon2id (preferred) or bcrypt. Never send password hashes to the browser.
- Use secure, HttpOnly, SameSite cookies, CSRF protection, strict CORS, validation, rate limits and role-based access (`customer`, `representative`, `admin`).
- Add database unique indexes for normalized customer email and every normalized phone. Add unique indexes for representative email, phone, National ID and Rep ID.
- Generate Client ID, Order ID, Item Code, Return ID and Rep ID atomically on the server. Never use `MAX(id)+1` without a locked sequence.
- Perform inventory reservation, discount validation, final-price calculation, delivery state transitions and Dart Card eligibility on the server inside transactions.
- Accept delivery addresses only when server-side reverse geocoding resolves the administrative governorate to `Cairo` or `Giza`. Do not trust a governorate name or coordinates supplied by the browser alone.
- V1 payment method is `COD` only. An order cannot be marked paid until delivery is confirmed.
- Do not expose National ID images publicly. Store them encrypted in private object storage and return only short-lived authenticated URLs to authorized admins.
- Treat geocoding results as user-assisted address data. Cache/proxy Nominatim requests and comply with its production usage policy; do not send high-volume traffic directly from every browser.

## Canonical order price object

```json
{
  "subtotal": 1000,
  "discountPercent": 30,
  "discountAmount": 300,
  "finalAmount": 700,
  "amountPaid": 0,
  "amountRefunded": 0,
  "currency": "EGP"
}
```

Money must be stored as integer piastres or a database decimal. The current UI displays whole EGP and removes the fractional display portion (`780.90` is shown as `780 EGP`). The backend must never reconstruct a final amount from untrusted browser values; define the final production rounding/accounting policy explicitly before accepting online payments.

## Canonical address object

```json
{
  "source": "map",
  "country": "Egypt",
  "governorate": "Cairo",
  "area": "Nasr City",
  "street": "Example Street",
  "building": "12",
  "floor": "4",
  "fullAddress": "12 Example Street, Nasr City, Cairo, Egypt",
  "latitude": 30.0561,
  "longitude": 31.3301
}
```

`country`, `governorate`, `area`, `street`, `building`, `floor`, `latitude` and `longitude` are required. Accept either a selected map point or a complete manual address, but geocode/reverse-geocode before order creation and ask the user to correct any missing component. The accepted governorate must be `Cairo` or `Giza`; reject every other administrative governorate even if its coordinates fall inside the map's broad navigation rectangle. The 12-hour promise starts only after the order is accepted.

## Model size charts and catalogue filters

Each model owns one reusable size chart; do not create a separate HTML table for every product. The API returns the selected model's values and the frontend fills the shared modal template.

```json
{
  "modelId": "DA-P785",
  "sizeChart": {
    "unit": "cm",
    "rows": [
      {
        "size": "32",
        "chest": 100,
        "waist": 80,
        "hip": 102,
        "length": 108,
        "shoulder": null,
        "sleeve": null,
        "inseam": 78,
        "notes": "Relaxed fit"
      }
    ],
    "updatedAt": "2026-09-05T12:00:00.000Z"
  }
}
```

- `GET /api/v1/products` must include normalized sizes, colors, availability, integer display price and the model size chart needed by the catalogue modal.
- `PUT /api/v1/admin/models/:modelId/size-chart` updates the chart after admin validation and records an audit event.
- A size must be unique inside its model. Each published row needs at least one positive measurement. Measurement fields are nullable; never invent missing values.
- Catalogue search/filter parameters should support `query`, `category`, `size`, `color`, `availability`, `minPrice`, `maxPrice` and `sort`. Return facets/counts from the same inventory snapshot so the visible filters cannot advertise unavailable combinations.

## Customer authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password` — always return the same generic response.
- `POST /api/v1/admin/password-reset-requests/:id/temporary-password` — admin only; force password replacement on next login.
- `POST /api/v1/auth/change-temporary-password`
- `GET /api/v1/me`
- `PATCH /api/v1/me`

Admin-assigned temporary passwords are the selected launch workflow. Send them to the verified owner through a controlled channel; never display existing passwords.

## Catalogue, physical items and reservation

- `GET /api/v1/products`
- `GET /api/v1/products/:slug`
- `POST /api/v1/cart/reservations` — atomically reserve specific physical Item IDs for 15 minutes.
- `DELETE /api/v1/cart/reservations/:id` — release on explicit close/cancel when received.
- A server job releases expired reservations. Browser close events are best-effort and cannot be authoritative.
- Return HTTP `409` when another cart/order already owns the item.

## Orders

- `POST /api/v1/orders` — idempotency key required.
- `GET /api/v1/orders/:orderId`
- `GET /api/v1/me/orders`
- `PATCH /api/v1/admin/orders/:orderId`
- `PATCH /api/v1/admin/orders/:orderId/status`
- `POST /api/v1/admin/orders/:orderId/assign-representative`

State machine:

`New → Accepted → Preparing → Out With Representative → Representative On The Way → Delivered`

Terminal/exception states are `Refused`, `Cancelled` and `Needs Attention`. Every transition needs an immutable activity-log entry containing actor, old state, new state, timestamp and optional reason.

## Representative accounts and documents

- `POST /api/v1/representatives/register` — multipart upload: ID front, ID back, face photo.
- `POST /api/v1/representatives/login` — identifier may be phone, email, Rep ID or National ID.
- `GET /api/v1/representatives/me`
- `GET /api/v1/representatives/me/orders`
- `POST /api/v1/admin/representatives/:id/approve`
- `POST /api/v1/admin/representatives/:id/reject`
- `PATCH /api/v1/admin/representatives/:id`

New registrations start as `Pending Approval`; rejected or unavailable accounts cannot log in or receive orders. Validate JPG/PNG/WebP and a maximum 5 MB source file per image, inspect actual MIME signatures, strip metadata and malware-scan uploads.

## Live delivery tracking

- `POST /api/v1/representatives/me/orders/:orderId/start`
- `POST /api/v1/representatives/me/orders/:orderId/location`
- `POST /api/v1/representatives/me/orders/:orderId/stop`
- `POST /api/v1/representatives/me/orders/:orderId/delivered`
- `GET /api/v1/orders/:orderId/tracking-token`
- `GET /api/v1/tracking/:token` plus authenticated WebSocket/SSE updates.

Location updates must be accepted only from the assigned active representative and only while the order is `Representative On The Way`. Use a short-lived, unguessable customer tracking token. Stop and expire location sharing at delivery/cancellation. Store only the retention needed for operations and legal obligations.

`POST /api/v1/representatives/me/orders/:orderId/delivered` must independently verify a fresh server-received location update and reject confirmation when the representative is more than 1 km from the saved delivery coordinates. The browser's hidden/visible button state is only UX and is not authorization. The Start response should include a Google Maps-compatible destination URL or validated coordinates; never accept destination coordinates supplied by the representative client.

## Returns, reviews, cards and serial verification

- `POST /api/v1/returns`, `GET /api/v1/me/returns`, admin review/update endpoints.
- `POST /api/v1/reviews` only if the authenticated customer has at least one `Delivered` order.
- `GET /api/v1/leaderboard` returns current candidates; customers with an active Dart Card are excluded until 10 delivered items or one year.
- `GET /api/v1/items/:code/authenticity` returns success only for a sold item and a privacy-masked owner name.
- If no delivered purchases exist, leaderboard fallback rows are registered accounts marked `not eligible`; no winner is selected.

## Response codes

- `400` malformed request.
- `401` unauthenticated.
- `403` wrong role, unapproved representative or unauthorized order.
- `404` resource not found.
- `409` duplicate identity, stock/reservation race or invalid concurrent transition.
- `422` valid JSON but failed business validation.
- `429` rate limit.

All create/update endpoints return the server-calculated canonical record and an audit/event ID.
