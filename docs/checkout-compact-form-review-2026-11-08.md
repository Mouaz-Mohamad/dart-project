# Taller checkout map and compact address form — 2026-11-08

Approved follow-up to the floating Google map search release: increase the map height and show only the customer's name, first phone, optional second phone, building number/name and floor by default.

## Implementation

- `cart-checkout.html`: move email, delivery notes, country, governorate, area, street and the dynamically inserted city/neighborhood helper into a native `details` disclosure. Its `summary` uses a downward chevron and the existing site's English operational labels (`Additional details`). It starts closed and supports keyboard activation without JavaScript.
- `CSS/main.css`: map height is 65% of the stable viewport (`65svh`, with `65vh` fallback), bounded to 480–720px. Add styles scoped to the new disclosure. `CSS/responsive.css`: remove the previous fixed 420px mobile map override. Rebuild the tracked Home CSS delivery bundles.
- `Js/dart-checkout-stability.js`: capture native `invalid` events and open the disclosure before the browser focuses an invalid field. For native-valid submissions, reveal coverage controls if existing address validation fails. The current pending-address and duplicate-submit guards remain in place.
- Fields retain their IDs, names, required attributes and form membership. Closing the disclosure keeps values in the form payload. Google can fill the address while the disclosure stays closed. Pricing, order submission, coverage rules, pin verification and address snapshots remain unchanged.
- No new endpoints, migrations, storage, external service requests, WhatsApp sends, or courier runtime changes.

## Verification

- `npm run build`: production assets rebuilt and staged.
- `npm run check`: source ownership/syntax/freshness and all 50 maintained frontend static checks.
- `node tests/checkout-address-browser.cjs`: 320/390/768/1440px widths; map height and containment; exactly the five primary inputs visible; email/notes/address collapsed; Enter/Space toggling; native opening/focus for missing address fields and invalid email; current `requestSubmit` flow; valid collapsed submission; values retained in `FormData`; coverage-error reveal; manual fallback and no-JavaScript toggling.
- `node tests/google-navigation-browser.cjs`: map/Places selection still populates collapsed address inputs; manual edits through the disclosure; existing asynchronous, dark-mode, touch, keyboard, route and courier renderer checks. The camera assertion now waits for asynchronous initialization before asserting the expected tilt; it does not change courier code.
- `node tests/checkout-address-runtime.cjs`: existing address races and pending-submit guards.
- `node tests/database-authoritative-storage.cjs` and `git diff --check`.
- `DART_CSS_BASE_REF=HEAD node tests/css-cascade-browser.cjs` against the preceding release: unchanged surfaces checked at five widths. The approved checkout map/payment/disclosure surfaces are excluded from equality comparison and covered by dedicated browser acceptance tests. Other checkout fields, pages and dashboard styles remain compared.

Browser fixtures use synthetic users/addresses and Google responses, intercept form submission and make no real orders or paid Maps requests. A mobile screenshot was inspected with Google deliberately unavailable to confirm manual recovery and the collapsed layout. Production verification checks Vercel aliases, current commit statuses and the exact published checkout assets.

## Quality review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. States | Pass | Closed/open disclosure, missing/invalid fields and coverage failure tested; existing map loading/error/manual fallback retained. |
| 2. Server authority | Pass | No pricing, stock, coverage, server validation or order payload changes. |
| 3. Concurrency | Pass | Disclosure changes presentation only; existing pending/duplicate guards and address snapshot/race tests retained. |
| 4. Validation / authorization | Pass | Required fields stay enabled and validated; invalid hidden fields become visible/focusable; no permission changes. |
| 5. Idempotency | N/A | No new durable mutation. Existing submission guards retained. |
| 6. Audit | N/A | No new sensitive action requiring an audit entry. |
| 7. External-service cost | N/A | No new request path, service or message. Existing Maps debounce/session lifecycle unchanged. |
| 8. Regression safety | Pass | Scoped selectors, preserved form fields, generated assets rebuilt, dedicated checkout and unchanged-surface tests. |
| 9. Tests | Pass | Automated checks cover responsive height, disclosure, validation/focus, payload preservation and Google address integration. |
| 10. Secrets | Pass | No credentials introduced or configuration values changed. |

The preceding release already had unrelated CI failures: `navigation-browser.cjs` times out at `/products.html` phase 3, and backend lint reports unused `customerPasswordOrThrow` in `social-auth.service.ts`. Those were confirmed in the prior commit's GitHub logs and are outside this approved layout task. This report does not claim that every repository-wide workflow is green.

## Manual acceptance

1. Proceed from cart to checkout on a phone and desktop. Confirm a taller light Google map and the five primary customer/building inputs.
2. Expand/collapse `Additional details` using its chevron or keyboard. Check that the email, notes and complete address/coverage controls remain available and preserve entered values.
3. Select a Google place while details are closed; confirm that the pin and address still update after verification.
4. Leave a required hidden address field blank and press Order. Details should open with the browser focusing the invalid field. Repeat with an invalid optional email.
5. Complete a valid address and close details. Confirm submission still uses all address values and that coverage/security checks apply as before.
