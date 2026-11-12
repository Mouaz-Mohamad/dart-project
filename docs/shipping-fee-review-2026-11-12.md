# Customer shipping fee — 2026-11-12

Approved: uniform 100 EGP per order, charged after item discounts; dashboard-controlled; new orders only. Product prices are managed by the owner.

## Behavior and implementation

- Checkout displays Subtotal, Discount, Shipping, Total. The server quote returns `shippingMinor`; shipping participates in its fingerprint and final payable amount, never the item-discount allocation.
- Settings → Sales → Pricing & Fees exposes `Shipping fee per order (EGP)` (`shippingFeePerOrder`). Zero and two decimal places are supported. Existing settings permission, CSRF, MFA and optimistic version checks remain in force; the audit records previous/new shipping values.
- Website and manual dashboard orders snapshot `orders.shipping_fee_minor`. Repricing an existing order keeps that snapshot. Customer reloads, profile details, dashboard projections, COD collection, confirmation totals and idempotent replays retain the payable total.
- Customer shipping is separate from `delivery_cost_minor` / `courierFeePerOrder`, which represent the existing operating expense. This change does not rewrite item prices or their cost allocation.
- Set reconciliation includes the shipping snapshot. Quantity-offer merchandise refunds exclude the separately charged shipping; shipping is never accidentally refunded with the first piece.
- Migration `0087_customer_shipping_fee.sql` adds a nonnegative BIGINT column with zero for historical orders, initializes the new setting to 100, and updates the Set total trigger. It does not rewrite historical payable totals.
- Existing endpoints extended: GET `/api/v1/site-settings`, GET/PUT `/api/v1/admin/site-settings`, GET `/api/v1/me/cart/quote`, POST `/api/v1/orders`, admin order creation/editing and customer order projections. No new endpoint.

## Validation

- Backend typecheck and lint passed.
- Eight focused backend suites: 66 passing scenarios, four real-PostgreSQL concurrency scenarios skipped without TEST_DATABASE_URL. Includes six new shipping cases: validation/public setting, multi-piece discounted checkout and replay, price review on shipping change, immutable manual-order fee during item edits, real Set checkout/deferred reconciliation/email totals, and zero shipping independent of courier expense.
- New frontend runtime test passes for once-per-order shipping, discount exclusion, zero/decimal fees, fresh/stale authoritative quotes and empty cart.
- Source layout, database-authoritative storage, cart recovery and profile compact record checks passed. Full production asset build/staging passed.
- 49 other frontend static checks passed. Seven broader frontend checks already fail at the unchanged base commit `7d23e2d`: CSS cascade, home performance, performance budgets, server authority (duplicate HTML attributes), Set runtime refund text, settings reset, test inventory (existing unclassified return wizard test). Reproduced each in a detached baseline checkout; they are not repaired in this shipping batch.
- Browser visual QA unavailable: the cloud browser could not reach the local preview (connection refused). No live customer order, payment, email or WhatsApp was submitted as a test.

## Quality review

| Area | Result |
| --- | --- |
| 1. State coverage | Pass — existing settings loading/error states and checkout price-review recovery retained |
| 2. Server authority | Pass — fee read/recomputed from PostgreSQL settings, never accepted from client totals |
| 3. Concurrency | Pass — shared settings lock at checkout, versioned settings writes, fingerprint changes require review |
| 4. Validation/auth | Pass — finite nonnegative two-decimal amount, existing central settings permissions unchanged |
| 5. Idempotency | Pass — cached successful checkout retains original shipping after settings change |
| 6. Audit | Pass — settings audit includes previous/new fee; existing order audit retained |
| 7. External cost | Pass — no additional message send, provider or scheduled task; existing confirmation total includes shipping |
| 8. Regression | Pass for affected paths — historical totals preserved; baseline failures listed above |
| 9. Tests | Pass — checkout, settings validation, historical snapshot retention, Sets, quantity refunds, dashboard creation and runtime display |
| 10. Secrets | Pass — no credentials introduced |

## Manual verification

1. In Settings → Sales → Pricing & Fees, set Shipping fee per order to 100 and save.
2. Open checkout with two pieces of 500 EGP each at 20% item discount: subtotal 1000, discount 200, shipping 100, total 900.
3. Change shipping to 125.25 in the dashboard while checkout remains open; confirmation must show/review the new total before creation.
4. Open an order created with shipping 100 after changing the setting. Its recorded shipping and payable amount remain unchanged.
5. Set shipping to 0 and confirm it renders as 0 rather than falling back to 100.
