## Fine-grained staff action permissions

Dart Eye permissions are database-driven. The following dedicated permissions are now enforced while the older broad parent permissions remain compatibility fallbacks during the staged dashboard migration:

- Orders: `orders.create`, `orders.edit`, `orders.archive`, `orders.delete`, `orders.bulk_manage`.
- Returns: `returns.create_manual`, `returns.review`, `returns.assign`, `returns.inspect`.
- Damage: `damage.resolve`.
- Catalogue: `catalog.read`, `catalog.edit`.

The Owner role receives all new capabilities. Staff receive none automatically; the Owner selects their explicit permission keys. Existing `orders.manage`, `returns.manage`, `damage.manage` and `catalog.manage` permissions continue to authorize their child actions until the transitional bulk endpoints are retired.

## Dart Card draw authority

- Customer draw eligibility is editable from Dart Eye through the authenticated admin API and is audited.
- Monthly winner selection and card awarding must remain server-authoritative; the dashboard must not create winner cards as a browser-only side effect.
- Existing browser-era automatic award code has been removed. A future scheduled/API draw workflow must enforce eligibility, active-card exclusion, idempotency and audit in one server transaction.

# Dart Node.js / Express API contract

The production frontend is database-authoritative through `/api/v1`; PostgreSQL is the source of truth for business data. Browser storage is limited to transient UI/session hints and one-time legacy cleanup markers. `DartState` is an in-memory projection, not persistent business storage. Critical operational domains (returns, damage, promotions, loyalty, notifications/messages and finance) live in row-level relational tables. The initial relational backfill is duplicate-tolerant so historical browser-era records cannot block a production migration. Customer profile snapshots read Returns, Dart Card, Birthday rewards and Birthday messages from those same relational tables. Returns/Damage now also expose a typed PostgreSQL core for customer/order/item relations, money, pickup address, exchange-chain and lifecycle fields while the compatibility payload remains temporarily for fields not yet migrated. Legacy compatibility writes are deduplicated by record ID in the authoritative BEFORE trigger, with the last legacy array occurrence winning deterministically. `dashboard_domain_state` is retained only as an optimistic-concurrency/version envelope for the legacy bulk PUT protocol: a BEFORE trigger writes incoming records to the relational tables and clears `data` before the envelope row is persisted, so critical arrays are no longer duplicated there.

## Implemented foundation — 2026-09-19

- The provider-neutral TypeScript/Express service lives under `backend/`. Vercel production builds compile without opening a database connection; schema migrations run at serverless cold start under the existing PostgreSQL advisory lock before the Express app is exported, with SQL migration files explicitly included in the function bundle.
- `GET /api/v1/health/live` reports process liveness without depending on PostgreSQL.
- `GET /api/v1/health/ready` reports PostgreSQL readiness and returns `503` without leaking connection details when unavailable.
- Migration `0001_platform_foundation.sql` adds append-only `audit_logs`, transactional `outbox_events`, and hashed `idempotency_keys` storage.
- Migration `0002_identity_auth.sql` and the Identity/Auth module implement separate Customer, Staff and Representative realms, Argon2id passwords, customer Email OTP, rotating/revocable server sessions, CSRF enforcement, reset requests, protected Owner bootstrap and TOTP MFA.
- The existing customer login/registration/profile and representative login adapters use these endpoints when `window.DART_API_BASE_URL` is configured. Dart Eye has a Staff/Owner login and first-login Authenticator gate.
- Representative registration now stores verification documents encrypted in PostgreSQL and validates the declared JPG/PNG/WebP type against file magic bytes before persistence. Automated approval remains prohibited until metadata stripping, malware scanning and a human identity-review policy are configured.
- Catalogue, inventory, cart reservation, orders, customer commerce, representative workflow, site settings, finance summaries and transactional outbox delivery are implemented under `/api/v1`. Remaining sections below distinguish implemented behavior from future hardening.
- Production must never fall back silently to `localStorage` when the API is unavailable.

## Approved notification channels

Production automation is optional at core API startup. When `AUTOMATION_WEBHOOK_URL`, `AUTOMATION_WEBHOOK_SECRET`, and `OUTBOX_CRON_SECRET`/`CRON_SECRET` are all absent, the API starts normally with the Outbox disabled. A partial configuration is rejected. The Vercel cron is intentionally not scheduled until a valid cron secret and automation endpoint are configured.

- Routine `ORDER_PLACED`, `ORDER_OUT_FOR_DELIVERY`, and `ORDER_DELIVERED` notifications use Email, Web Push, and in-site notifications.
- Routine commerce communication uses Email, Web Push and in-site notifications.
- WhatsApp Business Platform is reserved for birthday messages and post-delivery review requests. Order placement, courier and delivery status messages must not silently expand the WhatsApp scope.

## Non-negotiable server rules

- Use Node.js with Express and a transactional database selected by the backend developer. PostgreSQL is recommended for orders, unique identities, inventory reservations and reporting.
- Store passwords with Argon2id (preferred) or bcrypt. Never send password hashes to the browser.
- Use secure, HttpOnly, SameSite cookies, CSRF protection, strict CORS, validation, rate limits and role-based access (`customer`, `representative`, `admin`).
- Add database unique indexes for normalized customer email and every normalized phone inside the customer role. Add separate unique indexes for representative email, phone, National ID and Rep ID inside the representative role; the same person may own one customer account and one representative account using the same contact details.
- Generate Client ID, Order ID, Item Code, Return ID and Rep ID atomically on the server. Never use `MAX(id)+1` without a locked sequence.
- Perform inventory reservation, discount validation, final-price calculation, delivery state transitions and Dart Card eligibility on the server inside transactions.
- Accept delivery addresses only when server-side reverse geocoding resolves the administrative governorate to `Cairo` or `Giza`. Do not trust a governorate name or coordinates supplied by the browser alone.
- V1 payment method is `COD` only. An order cannot be marked paid until delivery is confirmed.
- Do not expose National ID images publicly. Store them encrypted in private object storage and return only short-lived authenticated URLs to authorized admins.
- Treat geocoding results as user-assisted address data. Cache/proxy Nominatim requests and comply with its production usage policy; do not send high-volume traffic directly from every browser.

## Canonical order price object

```json
{
  "subtotal": 100000,
  "discountPercent": 30,
  "discountAmount": 30000,
  "finalAmount": 70000,
  "amountPaid": 0,
  "amountRefunded": 0,
  "currency": "EGP",
  "unit": "PIASTRE"
}
```

Money must be stored and calculated as integer piastres only. The current UI may convert those integers to an EGP display value, but the backend must never reconstruct a final amount from untrusted browser values or use floating-point money.

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

### Public product-card pricing

`GET /api/v1/products` should expose the effective display price without exposing cost:

```json
{
  "originalPrice": 600,
  "price": 480,
  "effectiveDiscountPercent": 20,
  "discountSource": "Site"
}
```

`discountSource` is `Site`, `Model` or an empty string. Model and site-wide discounts never stack. When an active site-wide discount exists it takes precedence for the current product-card display and checkout; otherwise the model discount applies. Recalculate these fields on the server and snapshot the accepted order line so later price changes never rewrite old sales.

## Customer authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password` — always return the same generic response.
- `POST /api/v1/admin/password-reset-requests/:id/temporary-password` — admin only; force password replacement on next login.
- `POST /api/v1/auth/change-temporary-password`
- `GET /api/v1/me`
- `PATCH /api/v1/me`

Keep the customer signed in across site revisits until explicit logout, account revocation or a security event. Implement this with secure rotating server sessions/refresh tokens rather than a never-expiring browser credential. Admin-assigned temporary passwords are the selected launch workflow. Send them to the verified owner through a controlled channel; never display existing passwords.

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

Order creation requires an authenticated customer account. Do not create guest customers during checkout; return `401` and preserve the cart so the customer can sign in or register first.

## Representative accounts and documents

- `POST /api/v1/representatives/register` — multipart upload: ID front, ID back, face photo.
- `POST /api/v1/representatives/login` — identifier may be phone, email, Rep ID or National ID.
- `GET /api/v1/representatives/me`
- `GET /api/v1/representatives/me/orders`
- `POST /api/v1/admin/representatives/:id/approve`
- `POST /api/v1/admin/representatives/:id/reject`
- `PATCH /api/v1/admin/representatives/:id`

New registrations start as `Pending Approval`; rejected or unavailable accounts cannot log in or receive orders. Validate JPG/PNG/WebP and a maximum 5 MB source file per image. The API must inspect actual MIME signatures before persistence (implemented); metadata stripping and malware scanning remain required before unattended production approval of representative documents.

Customer and representative identities are separate roles and sessions. Reject duplicate email, phone or National ID within representative accounts, but do not reject a representative merely because the same email or phone belongs to that person's customer account.

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

- `POST /api/v1/returns` now inserts one authoritative `return_requests` row directly and bumps only the returns version envelope; it no longer rewrites the complete legacy returns array. `GET /api/v1/me/returns` and admin review/update endpoints continue to consume the same authoritative rows during the staged migration. Every request contains a newly entered Cairo/Giza pickup address with validated coordinates; never silently reuse the order address.
- `POST /api/v1/reviews` only if the authenticated customer has at least one `Delivered` order.
- `GET /api/v1/leaderboard` returns current candidates; customers with an active Dart Card are excluded until 10 delivered items or one year. Its `purchasedItems` value is the net count of delivered physical item codes in the selected month after subtracting completed `Refund` requests. Exchanges, pending requests and rejected requests do not reduce the score. Deduplicate by physical Item Code so one refund can never be subtracted twice.
- `GET /api/v1/items/:code/authenticity` returns success only for a sold item. The customer-facing response includes product name/image, physical Item Code, size, color and only the first two parts of the registered owner's name.
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

# V7 catalogue and inventory extension (authoritative for new UI)

## Data ownership

Model: `modelId`, `name`, `category`, `description`, `cost`, `selling`, `discount`, `lowStockLimit`, `createdAt`, `updatedAt`, archive flags, `sizeOptions`, `colorOptions`.
Each size has a stable ID, name and active/archive state. Each color has a stable ID, name, active/archive state and an ordered `images` list. The first image is its cover. Production image entries reference uploaded asset IDs and public product URLs; local IndexedDB IDs are prototype-only.
Item: unique `itemCode`, model reference, color/size references, status, timestamps and archive flags. Do not copy model galleries onto physical items. Use database foreign keys and unique constraints, not only UI validation.

## Suggested server boundaries (not implemented endpoints)

- GET /admin/bootstrap: Brand aggregates, first model summary page and first group summary page. Load other sections separately afterward.
- GET /admin/item-groups: search, filters, cursor, newest-first summary rows. Key: model + color + size. Include stock/status counts and low-stock flag.
- GET /admin/items: same filters plus optional group identifiers; cursor pagination; same item response for All Items and group details.
- POST/PATCH /admin/models: validate options and prices; reject removal of historically referenced options, allow archive/restore.
- POST /admin/items: validate unique item code and active model/color/size; default state In stock.
- POST /admin/product-images: validate type/size, generate compressed variants, return shared asset references. Preserve assets needed by history.
- GET /products: active model data plus imaged color cards; never expose internal cost, customer data or physical item codes. Include sold-out colors. Full model endpoint includes available options and all active color galleries.
- POST /cart/reservations: atomic allocation and server-controlled 15-minute expiration. Reject invalid quantity, unavailable or archived options. Release expiry with a server job.
- POST /orders: authorize owner, validate address, recompute authoritative price, compare client-confirmed price/version, allocate items and save order in one transaction. Return a price-change response requiring reconfirmation when needed. Use idempotency keys to prevent duplicate checkout.

## Immutable order snapshots

Each physical line stores itemCode, modelCode, name, color, size, qty, originalUnitPrice, discountPercent, discountAmount, finalUnitPrice and costSnapshot. Preserve the order's customer/address/payment/delivery records independently of future profile changes. Model price or discount edits must never rewrite existing snapshots. Editing an existing order retains snapshots for retained items; a newly added physical item of a model already present in that order inherits that model's original order price, discounts and cost snapshot. Only a newly introduced model uses its current server price. Keep an audit trail.

Public availability must come from server stock counts. Transactions and locking must prevent the same item entering two active orders. localStorage events only synchronize same-origin browser tabs and cannot enforce cross-device consistency. Authenticate every admin action on the server; retain prior security requirements in this document. The owner-requested V7 browser reset must not be reused as a production database deletion mechanism.

# V8 service contracts

## Contact and review inbox

`POST /contact-messages` accepts name, phone(s), email and message. The admin inbox response uses a shared record shape with `source: "Contact Us"`, while `status`, `rating` and `title` are null and displayed as `-`. Customer reviews use `source: "Review"`. Contact records must never be published as storefront reviews by changing visibility accidentally. `GET /admin/feedback?source=contact|review` provides server-side filtering and cursor pagination.

## Return state machine

Customer requests begin as `Pending Request`. Admin may reject them with a required customer-visible reason or approve them as `Approved - Awaiting Representative`. An approved request becomes `Representative Assigned`, then only the assigned active representative may move it to `Pickup On The Way` and `Completed`. Failed/cancelled pickup attempts return it to `Representative Assigned` without consuming an exchange. The customer tracking response maps the detailed workflow to exactly three public phases: Under Review, Approved/Rejected and Return Completed.

- The customer submits a fresh complete pickup address. Map selection reverse-geocodes to text; a manual address is server-geocoded back to a point. Accept Cairo and Giza only.
- `POST /api/v1/admin/returns/:id/approve`, `POST /api/v1/admin/returns/:id/reject`, `POST /api/v1/admin/returns/:id/assign-representative`.
- `POST /api/v1/representatives/me/returns/:id/start`, `/location`, `/failed` and `/complete`. Apply the fresh-location and 1 km validation used for delivery confirmation.
- A completed `Refund` reduces revenue and cash by that physical line's original net customer amount. Allocate any order-level discount proportionally across physical lines. The original delivery component is not separately refunded.
- A completed `Exchange` never changes order revenue. Its replacement must be the same model/design, may use another color/size, and inherits the exact original line price/cost plus its proportional order discount. The replacement inherits the physical exchange-chain ID.
- Exchange allowance is per physical exchange chain, including after the order line has been replaced with a new physical Item Code. The server resolves the chain from completed replacement history while holding the return-domain row lock, so concurrent submissions cannot both consume the same first-exchange benefit. Only completion consumes it: Dart pays the representative 50 EGP for the first completed exchange; every later exchange uses the configured customer-paid fee (initially 50 EGP). Every refund uses the configured customer-paid fee (initially 100 EGP). The server reads these values from `site_settings` and stores `courierFeePolicySnapshot` when the request is created; later setting changes never rewrite open or completed requests. Customer-paid fees never enter Dart revenue or Cash Flow.
- After representative completion, the original item becomes `Return Inspection`. Admin records `Good` or `Damaged`. `Good` restores it to `In stock`, retaining original cost and using the model's current selling price. `Damaged` creates one damage record. A damaged refund stays in original COGS; a damaged exchange adds one damage loss because its replacement remains the sold line.
- Apply completion, refund/exchange line movement, fees, inventory, Dart Card reversal for a refund, audit events and notifications in one idempotent database transaction.
- `POST /api/v1/admin/returns/:id/rollback` moves exactly one workflow step backward and requires an optimistic-lock version plus an idempotency key. The same transaction must restore every field changed by that step: held/sold/inspection inventory, refund totals and payment status, exchange order lines, Dart Card usage, courier-fee state and inspection damage rows. Never delete the original events; append `RETURN_ROLLBACK` with actor, reason, old/new state and the reversed transaction/event ID. Reject rollback with `409` if later dependent activity makes an exact reversal unsafe.

## Per-order delivery activation

Assignment and `Out With Representative` do not activate live tracking. `POST /representative/orders/:id/start` records an immutable start event and `deliveryStartedAt`, then authorizes location writes for that representative and order. Cancelling the active delivery clears its current activation and location. A representative can carry many assigned orders while sharing location only with orders they explicitly started. Tracking always returns the saved destination; courier location and route are returned only after activation. Production must authorize these rules on the server rather than trusting status fields from the browser.

## Customer ranking and trend

Monthly and annual reports include Delivered orders only, count orders first, and use net spending (`finalAmount - amountRefunded`) as the tie-breaker. Month and year parameters are mutually exclusive. Age is derived from birthday at response/display time. Client trend compares the most recent complete calendar month with the complete month immediately before it for both delivered order count and net spending.

# V9 birthday rewards and requested dashboard operations

## Birthday message queue

- All birthday dates, queue windows and reward expiry calculations use the `Africa/Cairo` time zone.
- `GET /api/v1/admin/birthdays/message-batch` is available all day and returns only unsent active customers for the current messaging batch. Before 20:00 Cairo the batch retains that Cairo calendar day's birthdays; at 20:00 it rolls to the next calendar day's birthdays. Include the authoritative `birthdayDate` in the response so newly registered matching customers can appear immediately without waiting for the next rollover.
- `POST /api/v1/admin/birthday-messages/:customerId/send` queues/sends the WhatsApp greeting idempotently using `(customerId, birthdayDate)` as the unique key. Remove a customer from the dashboard widget only after the server accepts the request; an empty result means every applicable customer in the current batch is already sent or no matching birthday exists.
- Persist delivery status (`queued`, `sent`, `failed`), provider message ID, attempt count and timestamps. A failed provider request remains retryable and must not be recorded as sent.
- The current browser prototype stores the action in `dart_message_queue`; the real WhatsApp delivery still requires this backend endpoint and a configured provider.

## Birthday reward lifecycle and checkout priority

The server creates one reward per customer and birthday year:

```json
{
  "id": "BDAY-DR-1-2026",
  "customerId": "DR-1",
  "type": "Birthday",
  "discountPercent": 30,
  "usageLimit": 1,
  "usedCount": 0,
  "startsAt": "2026-09-01T21:00:00.000Z",
  "expiresAt": "2026-09-08T21:00:00.000Z",
  "status": "Active",
  "orderId": null
}
```

- `startsAt` is 00:00 Cairo on the birthday and `expiresAt` is 00:00 Cairo seven calendar days later. Store UTC instants, but calculate the calendar boundaries in Cairo.
- Allowed states are `Scheduled`, `Active`, `Reserved`, `Used` and `Expired`.
- At checkout, an active Birthday reward always takes priority over coupons and Dart Card, regardless of percentage. Discounts never stack.
- `POST /api/v1/orders` validates and reserves the Birthday reward in the same database transaction that creates the order. A reserved Birthday reward does not consume Dart Card pieces.
- Mark the reward `Used` only when its linked order becomes `Delivered`. If that order becomes `Cancelled` or `Refused`, restore it to `Active` when it has not expired; otherwise mark it `Expired`.
- The storefront countdown is informational. The server must reject expired/reused rewards even if the browser displays stale data.

## Dart Card manual benefit

- `POST /api/v1/admin/dart-cards` grants an Additional Benefit manually. Its percentage is copied from the current Dart Card setting (initially `40%`) and then remains immutable on that card, for up to `10` net retained pieces, with editable issue/expiry dates defaulting to today and one year later.
- Reject a second active Dart Card for the same customer with HTTP `409`.
- A completed `Refund` for an item bought with Dart Card decrements its consumed-piece count exactly once. An exchange does not change the count. Reactivate a quota-completed card only if it is still within its expiry date.
- The profile may display the most recent inactive/expired card; the server response must expose its status rather than deleting its history.

## Destructive dashboard actions

- Before permanent deletion, `GET /api/v1/admin/delete-impact/:entityType/:id` returns counts of linked records.
- `DELETE /api/v1/admin/:entityType/:id?mode=only|cascade` requires an explicit per-operation choice. `only` removes only the selected record and preserves linked records; `cascade` removes the selected record and the previewed linked data in one transaction.
- Both modes require an admin role, an immutable audit event and a second-step confirmation token. Cascade deletion is intended for pre-launch/test cleanup and should be disabled or heavily restricted after production launch.

## Tracking visibility

`GET /api/v1/me/active-orders` and public tracking-token responses exclude `Delivered` orders. Delivery remains available in account order history, but it no longer appears on the Track Your Order page.

# Finance V1 service contract

All finance endpoints require the admin role, accept/return ISO-8601 timestamps, and store money as integer minor units. The server is authoritative: it recomputes every aggregate from immutable order/cost snapshots and finance records inside a consistent database snapshot. The browser prototype keys in `Eye/dart-finance.js` are repository boundaries, not production storage.

## Unified period and comparison

- `GET /api/v1/admin/finance/summary?start=<ISO>&end=<ISO>&compare=previous` returns the selected range, the immediately comparable range and both summaries.
- Calendar presets are resolved in `Africa/Cairo`. This month, quarter and year are compared to the same elapsed portion of the previous calendar period; rolling/custom ranges compare with an immediately preceding range of equal length.
- Return explicit `dataQualityIssues` for missing order `priceSnapshot`, `costSnapshot`, return resolution timestamps or damage cost snapshots. Never invent or silently seed finance data.

## Accounting rules

- Revenue is recognized only when an order becomes `Delivered`. A refund reduces revenue on the completed return/refund date, including when it falls in a later reporting period.
- COGS uses every delivered line's immutable `costSnapshot`. A completed `Good` return reverses that line's COGS; a completed `Damaged` return does not restore inventory and stays in COGS.
- Model/item cost already contains the owner's complete normal per-piece factory, delivery and related cost (for example, the stated 100 EGP delivery component). Never add an automatic normal-order shipping expense on top of it.
- `Total Selling = Delivered sales recognized in the period − completed refund amounts in the period`.
- The Brand overview `Total Cost` is the owner's full liability for the selected period: immutable acquisition cost of every physical item entered in that period, whether sold or still in stock, plus recognized operating expenses, COD/settlement fees, Dart-paid representative fees and non-duplicated write-offs for older stock damaged in the period.
- The Brand overview `Total Profit = Total Selling − Brand Total Cost`.
- The P&L report keeps conventional matching: net sold-piece COGS plus recognized operating expenses, COD/settlement fees, Dart-paid representative fees and non-duplicated damage write-offs. This is intentionally separate from the owner-liability Brand card.
- Pre-sale damage is written off once using its immutable damage `costSnapshot`. A damaged refunded item already present in delivered COGS is not written off again. A damaged exchanged item is written off once because the replacement occupies the delivered order line.
- Operating expenses are recognized on `expenseDate` for P&L. Only `Paid` expenses with a `paidAt` instant affect Cash Flow. `Void` records affect neither.
- COD provider fees are recognized as expense and cash outflow on settlement date. Invoice documents never create revenue or expense by themselves; they reference the authoritative order or expense to prevent duplication.
- Net units sold are Delivered physical units minus completed refunds; exchanges preserve the unit count. Returning Customer Rate is customers with at least two Delivered orders in the range divided by customers with at least one.
- `In Stock Cost Value` sums immutable item-entry cost snapshots for active `In stock` physical items in the selected period. `In Stock Selling Value` uses those items and each model's current final selling price. Neither inventory value is added to P&L Total Cost.

## Finance resources

- `GET/POST /api/v1/admin/finance/expenses` and `GET/PATCH/DELETE /api/v1/admin/finance/expenses/:id`
- `GET/POST /api/v1/admin/finance/budgets` and `GET/PATCH/DELETE /api/v1/admin/finance/budgets/:id`
- `GET/POST /api/v1/admin/finance/invoices` and `GET/PATCH/DELETE /api/v1/admin/finance/invoices/:id`
- `GET/POST /api/v1/admin/goals` and `GET/PATCH/DELETE /api/v1/admin/goals/:id`
- `GET/POST /api/v1/admin/finance/marketing` and `GET/PATCH/DELETE /api/v1/admin/finance/marketing/:id`
- `GET/POST /api/v1/admin/finance/cod-settlements` and `GET /api/v1/admin/finance/cod-settlements/:id`
- `GET /api/v1/admin/finance/reports/:report?start=<ISO>&end=<ISO>` where `report` is `pnl`, `cash-flow`, `cod`, `model-profitability`, `marketing`, `budgets` or `alerts`.

Mutations use idempotency keys plus optimistic version checks. Deletion archives finance records and retains their references; settled COD receipts are reversed by an explicit reversal entry rather than edited or deleted. Maintain one append-only finance audit event per mutation with actor, timestamp, before/after values and reason.

## Site settings and immutable policy snapshots

- `GET/PATCH /api/v1/admin/site-settings` controls the two hero image asset IDs, founder image asset ID, timed announcements, typing scenes/styles/speeds, per-model storefront-card rules, default new-model markup, site-wide discount, Birthday discount, Dart Card discount, refund customer fee and repeated-exchange customer fee.
- Validate uploaded image assets server-side and store only asset IDs in settings. If one hero image is configured, the API returns it as the effective day and night image.
- Settings changes create append-only audit events. Existing models, orders, rewards, cards and return requests keep their stored snapshots. New settings affect only records created afterward, except presentation-only settings such as images, text and card visibility.
- Checkout applies exactly one discount using this priority: Birthday, active site-wide discount, then Dart Card. Persist the selected source and percentage on the order.

## Delivery and pickup grouping

- The server may create a shared `deliveryGroupId` only for unassigned orders owned by the same customer whose normalized country, governorate, area and street are all equal. Building and floor do not split the route group.
- Representative assignment is the grouping cutoff. Assigning the selected order rows freezes that group; a later order starts a separate group even when its address matches. Every order and physical line remains an independent record and state machine.
- Apply the same rules to approved return/refund/exchange requests using their newly entered pickup address and `pickupGroupId`. Assignment operates only on explicitly selected return rows.
- Customer tracking may present one visual card per active group, with each order/request and its lines separated inside it. Completed returns disappear from active tracking but remain in authenticated history and dashboard reports.
- Normalize comparison values consistently on the server (trim, case-fold and collapse whitespace) and reject multi-selection assignment when customer or route fields do not match.

## COD reconciliation

A settlement references exactly one Delivered COD order and contains `amountReceivedMinor`, `feeMinor`, `settlementDate`, provider/batch reference and immutable audit metadata. Sum of non-reversed receipts cannot exceed `orderFinalMinor - refundedMinor`. P&L revenue remains tied to delivery; Cash Flow uses receipt dates. The API returns `due`, `received`, `remaining` and `Expected | Awaiting Settlement | Partial | Settled` per order.

## Goals and marketing

Goals support `revenue`, `units`, `orders`, `net_profit`, `repeat_rate`, `marketing_roas` and `expense_limit`, with name, target, start/end, Active/Paused state and archive metadata. Actual/progress values are computed server-side and are never persisted as authoritative fields.

Marketing records contain channel, campaign, date, spend, impressions, clicks, attributed orders/revenue and optional `linkedExpenseId`. Attributed revenue is analytical only and never added to accounting revenue. Linked expense validation prevents a marketing cost from being counted twice.

## Dart Card draw eligibility

- `PATCH /api/v1/admin/customers/:customerId/dart-card-draw-eligibility` accepts `{ "eligible": boolean, "reason": string, "expectedVersion": number }`.
- The eligibility change and its append-only audit event are committed atomically. Return previous/new values, actor and timestamp.
- Monthly winner selection reads the same committed customer snapshot and excludes `eligible=false` before ranking. Existing customers default to eligible only through an explicit database migration; new-customer defaults must be documented and enforced server-side.

> CI note: fine-grained permission middleware is lint/typechecked and unit-tested independently from browser chart smoke; chart CDN behavior is not part of authorization acceptance.
