# Checkout contact simplification — 2026-11-15

Signed-in customers complete delivery details using their saved contact. Only a missing name or primary phone remains visible. Guests retain the existing name, phone, email, birthday and optional second-phone fields.

The existing checkout-only `Js/dart-checkout-stability.js` owns contact presentation, initial rendering, session changes and form resets. Hidden controls are disabled and excluded from native validation. Switching identity clears the previous contact; refreshing the same incomplete account preserves newly entered missing details. Guest-only account creation/sign-in copy is hidden for signed-in customers.

`src/storefront/platform/checkout.js` prefers the current account's saved contact when constructing the request and accepts form values for a missing required name/phone. Guest requests keep their existing contact requirements. The former shared checkout prefill in `tracking.js`/`lifecycle.js` is replaced by the checkout-only controller so the Home payload stays within its existing budget. Generated platform delivery files are rebuilt.

No database migrations, endpoint changes, discount changes, stock changes or new messaging integrations.

## Validation

- `npm run check:release`: source freshness, syntax and the maintained frontend static suite.
- DOM integration against the actual checkout HTML, birthday controller, contact controller and checkout function: guest, complete account, missing name/phone, missing optional email/birthday, late hydration, reset, repeated session refresh, switching identities, logout privacy and outgoing API contact/address data. All requests are synthetic and no real orders/messages are created.
- `tests/checkout-address-browser.cjs`: maintained responsive browser coverage expanded for the same contact/session paths and actual synthetic checkout requests. Local Chromium cannot launch because this execution environment rejects its socket; the GitHub browser job runs this test.
- `node scripts/stage-vercel-public.cjs`: production asset staging.

## Quality review

| Section | Result | Evidence |
| --- | --- | --- |
| 1. State coverage | Pass | Guest, delayed session, full/incomplete account, reset and logout covered; existing address/API errors retained. |
| 2. Server authority | Pass | Existing authenticated/guest order endpoints still validate contact, address, pricing and stock. |
| 3. Concurrency | Pass | Contact follows current session events; existing pre-POST address snapshot and quote guards retained. |
| 4. Validation and authorization | Pass | Hidden controls cannot block native validation; visible missing fields remain required; API authorization unchanged. |
| 5. Idempotency | Pass | Existing reservation-bound Idempotency-Key retained. |
| 6. Audit | Not applicable | No new sensitive action or server mutation; existing order audit remains unchanged. |
| 7. External-service costs | Not applicable | No added provider calls or message sends. |
| 8. Regression safety | Pass | Guest layout retained, address coverage unchanged, checkout behavior page-scoped, Home budget unchanged. |
| 9. Tests | Pass locally; browser CI required | Static suite and synthetic DOM integration; maintained responsive browser test expanded. |
| 10. Secrets | Pass | No new credentials or sensitive logging. |

## Manual verification

1. Sign in with complete contact and open checkout: only delivery controls remain. Fill the address and confirm that the order uses the saved name/phones/email.
2. Use an existing account missing email/birthday: checkout does not request those fields. A missing name or primary phone is requested individually.
3. Sign out and reopen checkout: all original guest contact fields and account-creation text return. Complete birthday, contact and address and verify the guest order flow.
4. Change the session while checkout is open: contact visibility updates and the previous customer's contact clears.
