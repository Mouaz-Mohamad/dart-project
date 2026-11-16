# Admin release of one cart item

An authorized inventory operator can use **Release from Cart** beside a reserved physical piece, or from its Details actions. Confirmation removes only that physical piece from its reservation and returns it to **In stock**. Other pieces retain their reservations and original expiry.

The server rejects a changed item version, a different reservation, or an item already attached to an order. Retrying the same completed release does not release a later reservation. The public stock version invalidates the customer's current cart projection through the existing live catalog signal.

If the selected piece belongs to a Set unit, that incomplete Set unit is dissolved, including its temporary Dart Card hold. Its other physical pieces remain as standalone cart items, with server pricing and checkout review. The confirmation explicitly explains this behavior. A Waiting allocation for the selected item expires, and this explicit override leaves the physical item publicly available instead of immediately allocating it again.

## API and schema

`POST /api/v1/admin/items/:itemId/release-cart`

Body: `{ "expectedVersion": 2, "reservationId": "CART-SYNTHETIC-RELEASE" }`.

Requires a Staff session, satisfied MFA when required, CSRF, and at least one of `inventory.manage`, `catalog.manage`, or `catalog.edit`. The actor is always the authenticated Staff user. No migration or production data repair is required.

## Files

| Files | Change |
| --- | --- |
| `backend/src/modules/commerce/commerce.cart-release.ts` | Transaction, owner/cart/item locking, version checks, audit, Waiting and Set consistency |
| `backend/src/modules/commerce/commerce.service.ts`, `commerce.routes.ts` | Service entry point and authorized HTTP route |
| `src/dashboard/inventory.js` | Action, confirmation, in-flight guard, accessible loading and result messages |
| `src/dashboard/catalog-admin.js`, `src/storefront/catalog.js` | Existing Staff API/CSRF adapter and pending-save coordination |
| `src/dashboard/staff-permissions.js`, `dashboard-ui.js` | Central presentation permissions and direct compact-row action |
| `src/storefront/platform/lifecycle.js` | Reconcile nonempty customer carts after live catalog updates |
| Corresponding generated `Eye/` and `Js/` files | Rebuilt delivery runtimes |
| `backend/tests/admin-cart-release.postgres.test.ts` | Production-schema service, authorization, rollback and concurrency scenarios |
| `tests/admin-cart-release-runtime.cjs`, `dashboard-groups-browser.cjs` | UI states, live reconciliation and the direct browser action |
| `tests/test-inventory.json`, `.github/workflows/frontend-ci.yml` | Maintained test inventory and CI wiring |

## Validation

- `npm run check`: all 62 maintained frontend static/runtime checks pass, including database authority, current generated sources and the existing 226 KiB direct homepage JavaScript budget.
- `cd backend && npm run check && npm run build`: 972 backend tests pass; 67 pre-existing environment-dependent tests skip locally; lint, typecheck, Vercel configuration and TypeScript build pass.
- After adding the real PostgreSQL parallel scenario and strengthening Waiting/Set coverage: backend lint/typecheck and the focused release suite pass (11 tests). Its additional real PostgreSQL race test runs when `TEST_DATABASE_URL` is supplied by CI and skips in the local embedded engine.
- The existing Chromium dashboard suite now clicks the real compact-row release action against synthetic APIs. GitHub's existing browser job runs this suite before promotion.

Critical scenarios: signed-in and guest carts; decrementing a shared-variant quantity by one; unrelated cart preservation; final-item cleanup; duplicate retry; retry after re-reservation; changed version/cart; missing piece; stale quote after release; checkout before release; selected Waiting expiration without reassignment; incomplete Set and Dart Card hold cleanup; audit failure rollback; permission/MFA/CSRF/input rejection; UI confirmation cancellation, double-click, offline/conflict and committed-release/refresh-failure states.

## Review

| Area | Result | Evidence |
| --- | --- | --- |
| 1. State coverage | Pass | No action for unreserved/ordered pieces; visible pending, conflict, failure and confirmed-result states |
| 2. Server authority | Pass | Physical inventory and current reservation validated in PostgreSQL; no browser stock mutation |
| 3. Concurrency | Pass | Common owner/cart locks, reservation and item row locks, expected item version; both checkout orderings covered |
| 4. Validation and authorization | Pass | Central Staff permissions, MFA, CSRF and strict version/cart body validation |
| 5. Idempotency | Pass | Completed release identified by item, original cart and original version in the audit trail |
| 6. Audit | Pass | Actor, request, before/after values and affected Set/Waiting references committed with inventory |
| 7. External costs | Not applicable | No provider calls or WhatsApp messages are introduced |
| 8. Regression | Pass | Existing maintained frontend and backend checks pass; other physical items and expiry are preserved |
| 9. Tests | Pass | Production-schema and UI critical paths listed above; real PostgreSQL and Chromium coverage wired into existing CI |
| 10. Secrets | Pass | No new credentials, provider settings or browser-persisted business state |

## Manual check

1. Reserve two physical pieces in a synthetic guest or customer cart.
2. In Dart Eye, open Items, select the model/color/size group, and locate a **Cart Reserved** piece.
3. Click **Release from Cart** (also available in Details), then confirm.
4. Verify that piece is **In stock**, its action disappears, and the other piece remains reserved with its original expiry.
5. Verify the customer's cart reconciles after the existing live update; a new visitor can reserve the released stock.
6. Check the item's History for `CART_ITEM_RELEASED` and the authenticated Staff actor.
7. Attempt the old action after the item has entered an order; the server must reject it without changing the order or stock.

Validation uses synthetic local/CI data. No live customer cart is released as part of deployment verification.
