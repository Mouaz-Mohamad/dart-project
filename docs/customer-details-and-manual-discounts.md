# Customer details and Owner discounts

Customer Details retains the original fields and actions under General Information, open by default. Orders, Ratings & Feedback, Waiting, Returns & Exchanges, and Discounts expand independently. The customer module loads only when Details first opens; each history section fetches its own pages of 50 records without applying the dashboard date filters. Load more exposes the complete history.

Order rows show historical item prices, order total after discounts, refunded amount, date and status. Opening an order switches to Orders, clears incompatible filters/group mode, searches its order number and opens the original order details and actions. Waiting counts active requested pieces, including complete Sets; it excludes shopping-cart holds. Restricted sections require both customers.read and their own read permission.

Manual discounts are private customer entitlements. Only the protected staff_users.is_owner account may create, edit or cancel them; promotions.manage alone is insufficient. Names, start/end dates in Cairo, type, value and maximum eligible pieces are validated on the server. Percentage values are basis points; fixed values are integer EGP piastres. Overlapping unused manual grants are rejected to prevent ambiguous automatic selection. Used grants are immutable.

The pricing order for each standalone piece is Item/Model, Campaign, Manual, Birthday, Dart Card. A manual amount applies once to the eligible subtotal and is allocated proportionally across eligible pieces with exact integer totals. A manual percentage is calculated on that subtotal. The piece limit applies inside a single order. Higher-priority and Set pricing snapshots are preserved. Existing Set checkout and reward rules are unchanged. Website and dashboard-created orders consume the grant in their order transaction, permanently; unused piece capacity does not carry to another order. Returns, cancellations and order deletion do not restore it. Orders using a grant retain their customer and financial snapshots.

## Database and HTTP contract

Migration `0068_customer_manual_discounts.sql` creates the customer grant table, indexes, RLS and an immutable-use trigger; it extends the order-line discount-source check while preserving all existing sources. Apply the migration before publishing the API. Its SHA-256 is recorded by the normal `dart_schema_migrations` ledger.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/admin/customers/:clientRef/details/:section?offset=0` | Paged orders, reviews, waiting, returns or discounts; section permissions enforced |
| POST | `/api/v1/admin/customers/:clientRef/manual-discounts` | Owner creates a grant using `{id, discount}`; a retry with the same ID/body does not duplicate it |
| PUT | `/api/v1/admin/customers/:clientRef/manual-discounts/:id` | Owner edits with `{expectedVersion, discount}` or cancels with `discount: null` |

`discount` contains `name`, `kind` (`percent` or `amount`), integer `value`, `startsOn`, `endsOn`, and `pieceLimit`. Mutations require staff authentication, current MFA where required, CSRF, customers.read and promotions.manage, followed by the database Owner check. Versions prevent stale edits; the shared customer rewards lock serializes grant writes and checkout, and consumption updates only an Active grant. All sensitive changes and consumption write audit records. No production customer or order was created for testing.

## Verification

Backend: `npm run check` passed, including 612 assertions/tests across 89 passing suites; 52 environment-specific tests were skipped. New coverage includes fixed-amount rounding, piece limits, model/campaign/manual/birthday priority, Owner denial, duplicate creation, overlap rejection, stale edits, permanent use after refund, dashboard orders, every history permission, MFA, CSRF and strict payload validation. Existing mixed-discount and Set tests passed.

Frontend: `npm run check` passed all 39 static groups, including database-authoritative storage and unchanged public/core performance limits. `tests/customer-details-browser.cjs` exercises lazy loading, six accordions, original general controls, pagination, escaped feedback, Waiting/returns, the Owner form, order navigation, retry, non-Owner controls and late-response isolation after logout. Layout checks cover 370, 480, 767, 768 and 1440 pixels. The existing dashboard group/status browser regression also passed.

| Dart quality-review section | Result |
| --- | --- |
| 1. Empty/loading/error states | Pass: independent section states and retry; input stays on save failure |
| 2. Server authority | Pass: prices, allocations, eligibility and use computed in PostgreSQL-backed transactions |
| 3. Concurrency | Pass: reward locks, guarded consumption, immutable used grants and version checks; no production load test |
| 4. Validation/authorization | Pass: strict schemas, central permission middleware, CSRF/MFA and shared Owner guard |
| 5. Idempotency | Pass: creation ID and checkout replay; stale updates cannot repeat an edit |
| 6. Audit | Pass: create, edit, cancel and consumption logged |
| 7. External-service cost | Not applicable: no message/provider flow added or tested by sending |
| 8. Regression safety | Pass: existing checkout, mixed discounts, Sets, original controls and dashboard checks |
| 9. Automated tests | Pass: backend integration/route coverage and browser flow above |
| 10. Secrets | Pass: no credentials in code, generated files or fixtures |

## Manual walkthrough

1. In Customers, click the customer summary or Details: General Information opens; the other five sections start closed.
2. Expand Orders, load another page if available, and click an order number: its original Orders details opens.
3. Reopen the customer and inspect feedback, active requested pieces and returns/exchanges.
4. As Owner, expand Discounts, add a named amount/percentage, dates and piece limit. Edit or cancel an unused grant; confirm cancellation within the top dialog.
5. An eligible checkout receives the grant after higher-priority discounts. The grant becomes Used for that order and remains Used after refund. A non-Owner can view allowed data but cannot manage grants.
