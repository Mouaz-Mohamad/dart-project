# Navbar and smart shopping bar — 2026-11-21

The shared header stays visible near the top, hides on downward scrolling and returns immediately on upward movement anywhere in the document. Keyboard focus and an open Menu keep it visible. Horizontal clipping uses `overflow-x:clip` only after installation so the body does not trap sticky positioning.

Successful additions call one shared bar through the deferred feedback loader. The whole message links to the canonical cart. On the cart page it opens checkout without reloading the customer's address. Confirmation lasts six seconds by default and pauses during focus/hover. Server-verified offer progress can remain after confirmation; Close dismisses it until cart/session changes. Late responses cannot restore another customer's message. Errors leave only the successful-addition confirmation, never an invented benefit.

## Configuration

Settings → Smart shopping bar controls global offer visibility, confirmation duration and an optional one-time purchase goal for Dart Card. The card goal defaults to disabled, is separate from monthly draws and requires Dart Card to be enabled. Target and display distance are independent. Only paid delivered retained pieces count; cart reservations do not become historical purchases. Goal cards are awarded on delivery, once per customer, with ten-piece/one-year terms and the configured percentage. An earned card retains its entitlement after returns.

Settings → Discount campaign manager controls each campaign's reward, activation/date range, audience, product scope, priority, limits, smart-bar visibility, remaining-count threshold and custom text. Zero display distance means achieved offers only. Templates accept `{remaining}`, `{target}`, `{reward}`. Existing campaigns remain silent in the smart bar until explicitly configured.

| Example | Reward | Minimum eligible pieces | Gift pieces |
| --- | --- | --- | --- |
| Three pieces earn free shipping | Free shipping | 3 | — |
| Buy two and get the third free | Gift | 3 | 1 |
| Three pieces earn 15% | Percentage | 3 | — |

The different-model checkbox controls counting. Model-discounted pieces and Sets remain outside these quantity campaigns. Gift pieces are selected/reserved by the customer and the cheapest qualifying pieces become free once per order. Shipping rewards zero actual freight and preserve independent piece discounts. Gift returns recalculate retained eligibility from the sold snapshot; earned shipping is not charged again after delivery. Used campaigns are not restored by returns.

## Implementation and validation

- `src/storefront/shopping-bar.js` owns feedback, scroll behavior, races and dismissal; `Js/dart-navigation.js` provides its deferred, versioned loader. Sources rebuild through the existing frontend commands.
- `promotion.service.ts` validates and selects relevant campaign progress; `commerce.service.ts` computes shipping/gifts and returns progress in the owned cart quote. `card-purchase-goal.ts` derives private progress and awards a stable card under the existing card lock/guard, with audit history.
- The existing settings/promotions endpoints persist JSON to PostgreSQL with normal permissions and version checks. `GET /me/promotions/card-progress` adds a private, no-store read. No migration or new paid service is required. No production campaign or card goal was activated during implementation.
- Local backend check: 143 suites and 1,016 tests passed, plus the added customer-progress HTTP authorization case passed separately. Integration scenarios cover configured display distance, true zero shipping, shipping plus Birthday pricing, cheapest-piece gifting, cumulative gift returns, paid-delivered goal counting and duplicate-award prevention. External/database-only scenarios keep their existing skips.
- All 67 maintained frontend static checks pass. Dedicated runtime tests cover direction, overscroll, focus, cart links, safe text, progress, dismissal, empty carts, session races and service failures. Initial/core and homepage JavaScript remain within their existing budgets.
- `shopping-feedback-browser.cjs` passed real CSS geometry at 370/480/767/768/1366px in Chromium CI: sticky header return mid-page, bar bounds/progress/CTA and dismissal. The general CSS comparison retains fonts/colors/sizes/children/pixels; only the header's deliberately changed positioning properties are compared by this dedicated test. Local Chromium was unavailable. Full browser CI and production alias checks must succeed before reporting the release live.

## Quality review

| Item | Result | Evidence |
| --- | --- | --- |
| 1. States | Pass | Empty, failed, repeated and late progress responses are covered |
| 2. Server authority | Pass | DB-backed eligibility, reserved pieces, pricing and refund snapshots |
| 3. Concurrency | Pass; real DB CI required | Existing campaign/order/card locks, unique goal-card identity and versioned saves |
| 4. Validation / access | Pass | Strict Zod input, Staff permissions/MFA/CSRF, own-session private progress |
| 5. Idempotency | Pass | Checkout retry, cumulative refunds, stable goal-card insertion |
| 6. Audit | Pass | Existing campaign/settings audit plus purchase-goal issuance audit |
| 7. Services / cost | N/A | No message/provider call or new paid service |
| 8. Regressions | Local pass; browser CI required | Existing frontend/backend suites and scoped changes |
| 9. Tests | Pass | Runtime, money, PostgreSQL-schema and authorization scenarios above |
| 10. Secrets | Pass | No credentials or durable business data added to browser files |

Pause a campaign or card goal to stop future eligibility. Preserve the gift settlement logic for orders already sold under these offers; existing order snapshots and awarded cards must remain readable after rollback.
