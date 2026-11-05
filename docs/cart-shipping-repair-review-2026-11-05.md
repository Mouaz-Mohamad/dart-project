# Cart ownership and governorate delivery policy — 2026-11-05

Customers now sign in before adding a product or Set. Guest recovery remains
available for existing reservations; signing in, verifying email, navigation or
an empty browser projection cannot prevent discovering an owned guest hold.

## Behavior and scope

- New anonymous inventory/Set writes are denied on both current and compatibility
  URLs. Legacy discovery/read/release verifies the HttpOnly owner cookie.
- Claiming an old guest cart does not extend its expiry. An existing account cart
  produces an explicit conflict, preserving both reservations until the customer
  chooses. Replacement requires the displayed account cart ID and its unchanged
  server version. Reserve/claim/release share the owner lock.
- Signed-in Set access cannot bypass a missing or incorrect guest-owner cookie.
- The first Add waits for account-cart hydration. Old GET responses cannot
  overwrite newer mutations. A failed refresh after a cart choice leaves a
  visible retry and does not repeat the choice mutation.
- Product/Set return links preserve bounded, expiring public option selections
  in navigation. Restoring a selection creates no reservation or order; available
  catalog controls and authoritative reservation/pricing checks still apply.
- **Shipping Companies → Blocked Governorates** blocks a whole governorate
  before internal Dart delivery or any external company is considered. All 27
  governorates remain selectable so unavailable locations show a clear message.
- Checkout refreshes coverage before address validation, retries after outages,
  accepts enabled external governorates, and revalidates policy in the order
  transaction. Old Settings clients cannot erase the new policy accidentally.
- The server checks governorate/pin consistency using offline administrative
  polygons. Data reference: geoBoundaries EGY ADM1 2017, pinned revision 9469f09;
  see the boundary dataset license. This does not prove the customer's presence
  or automate city/neighborhood verification. Scoped city/area carriers require
  explicit staff address verification before dispatch or carrier correction,
  recorded in the shipment and existing staff audit event.
- Shipping workflow code previously present only in the generated dashboard
  was restored to its canonical sources before rebuilding. Product links,
  shipping management and the coverage picker now have readable sources and
  deterministic minified delivery, without raising performance budgets.

## API and database

- New: `GET /api/v1/cart/reservation`, cookie-proven legacy hold discovery.
- Changed: `PUT /api/v1/cart/reservation` and `PUT /api/v1/cart/set-groups`
  require customer authentication and CSRF, like their `/me/` equivalents.
- Changed: `POST /api/v1/me/cart/claim` supports explicit replacement using
  `replaceReservationId` and `replaceCartVersion`.
- Changed: shipping company GET/PUT carries `blockedGovernorates`; public
  checkout coverage carries availability/block state without private settings.
- Scoped-carrier workflow/correction accepts staff `coverageConfirmed`.
- Policy uses existing `site_settings.data`; no migration, destructive cleanup,
  production data reset, new paid provider or messaging campaign is required.

## Verification

- Frontend build and all **43 maintained static/runtime checks** passed.
- Backend lint, typecheck, production build and **695 tests** passed locally.
  **60 tests** require disposable PostgreSQL and were skipped locally, including
  four new multi-connection race tests. GitHub CI supplies PostgreSQL 17 and
  executes the integration suites before the release is called verified.
- New production-schema tests exercise real transactions/triggers with PGlite:
  cookie recovery, ownership failures, cart conflicts and versioned replacement,
  preserved expiry, policy version conflicts/old-client compatibility, blocked
  orders and geographic mismatch rollback, and successful valid checkout.
- Frontend regression coverage includes stale GET versus successful mutation,
  first-Add hydration readiness, explicit conflict choice with refresh failure,
  email-verification recovery, external checkout, and shipping-outage retry.
- Cloud-browser checks used synthetic local API data: empty-memory guest cart
  recovery; conflict choice; blocked Cairo message; enabled Alexandria carrier;
  unauthenticated Buy redirect. No live customer/order was created.
- Delivery budget: **962 KiB core**, **222 KiB direct Home**, coverage scripts
  below their unchanged **23 KiB** cap. Boundary data stays server-side.

## Manual acceptance

1. As a guest choose a product/Set and press Buy/Add: sign-in opens before a hold
   is written; sign in and review the restored selection before adding.
2. Reopen/reload with an existing owned legacy hold, including email signup:
   the cart is recovered. With two carts, neither disappears before a choice.
3. Stop network during recovery/after choosing a cart; reconnect and retry.
   The server cart survives and the choice mutation is not repeated.
4. In Shipping Companies block Cairo, save, then select Cairo at checkout:
   the unavailable message appears even though Dart delivery covers Cairo.
5. Enable an active carrier for an unblocked external governorate, verify its
   actual map pin, and complete checkout. A mismatched governorate/pin or a
   newly blocked governorate is rejected without consuming the reservation.
6. For a carrier restricted to selected cities/areas, verify the actual address
   with the carrier before confirming dispatch/correction.

## Quality review

| Check | Result |
| --- | --- |
| 1. Empty/loading/error states | Pass: recoverable cart, coverage and policy errors |
| 2. Server authority | Pass: auth, ownership, policy, price, stock and geography checked server-side |
| 3. Concurrency | Pass locally for state races/transactions; multi-connection PostgreSQL cases wired into CI |
| 4. Validation/authorization | Pass: central customer/Staff/permission/CSRF guards and strict settings schemas |
| 5. Idempotency | Pass: repeat claims preserve one hold; refresh retries do not replay cart choice; existing order idempotency retained |
| 6. Audit | Pass: cart claim/replacement and shipping policy/manual confirmation covered by transactional audit |
| 7. External cost | N/A: no new paid integration or WhatsApp/email send introduced |
| 8. Regression scope | Pass: existing shipment workflow retained in canonical sources; unrelated commerce rules unchanged |
| 9. Critical-path tests | Pass locally; PostgreSQL multi-connection verification also required in CI |
| 10. Secrets | Pass: no credentials or customer data added to browser delivery or committed files |

Production publication and GitHub CI results are reported separately after the
single release commit. This review does not claim a universal security guarantee.
