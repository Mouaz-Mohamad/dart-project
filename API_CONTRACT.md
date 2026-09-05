# Dart API contract for the Node.js / Express developer

Set `window.DART_API_BASE_URL` before `Js/dart-platform.js`. The current browser storage is a development simulation only; the server becomes the source of truth.

## Mandatory rules

- Enforce unique normalized email and phone values with database unique indexes, not frontend checks alone.
- Store passwords using Argon2id or bcrypt. Never accept or return password hashes to the browser.
- Use secure, HttpOnly, SameSite cookies; CSRF protection; rate limits; validation; audit logs; role-based dashboard access.
- Generate customer/order/item IDs atomically on the server.
- Treat prices, stock, discounts, card eligibility, return windows and order transitions as server-authoritative.
- Payment method for v1 is `COD` only.

## Suggested endpoints

- `POST /api/v1/auth/register`, `/login`, `/logout`, `/forgot-password`, `/reset-password`
- `GET/PATCH /api/v1/me`
- `GET /api/v1/products`, `GET /api/v1/products/:slug`
- `POST /api/v1/orders`, `GET /api/v1/orders/:orderId`, `PATCH /api/v1/orders/:orderId/status`
- `POST /api/v1/returns`, `GET/PATCH /api/v1/returns/:returnId`
- `POST /api/v1/reviews`, `PATCH /api/v1/reviews/:id/moderation`
- CRUD endpoints under `/api/v1/admin/*` for models, physical items, customers, representatives, cards and promotions

Use HTTP `409` for duplicate email/phone or inventory conflicts, `422` for validation, `401/403` for authentication/authorization, and idempotency keys for order creation.
