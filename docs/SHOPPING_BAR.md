# Navbar and smart shopping bar — 2026-11-21

The shared header stays visible near the top, hides on downward scrolling and returns immediately on upward movement anywhere in the document. Keyboard focus and an open Menu keep it visible. Clipping uses `overflow-x:clip` on the body and `overflow:clip` on the actual `.mother` page shell after installation, so neither ancestor traps sticky positioning. The browser fixture includes that production shell; a bare-header fixture missed its original `overflow:hidden` interaction during the first release check.

The compact glass bar stays fixed exactly 7px from the left, right and bottom edges of the viewport. It reuses the Profile/Waiting `glass-effect` blur, border and shadow, with an 82% white surface for burgundy text readability over product images. The piece count is white in a solid burgundy circle. The default row is 44px high, shows **عرض السلة** and the server-priced item total after discounts and before delivery, and has no redundant total caption. The visible amount rounds to the nearest whole pound; the server quote and charged amount retain their original integer piastres. The exact amount remains available to screen readers.

The bar remains visible while the cart contains pieces, including after the short added confirmation expires. Confirmation uses an inline checkmark without adding another text row, plus the accessible product-name announcement. Its duration is six seconds by default and pauses during focus/hover. The whole message links to the canonical cart. Both the cart and checkout views of `/cart-checkout.html` and its clean URL suppress the bar completely, add no bottom spacing and make no bar-specific quote/progress requests. The shared scroll header continues working there.

An eligible personalized offer expands the same bar with its reward title, remaining-count message and a white progress line. The line fills from right to left according to the server's current/target values and animates as progress changes; reduced-motion preferences disable that animation. The page reserves the measured bar height so its last controls remain reachable. Close dismisses the bar until cart/session changes. Empty carts hide it unless the server returns an eligible card goal. Pricing failures retain the cart link with an unknown-price marker; old prices and private messages are cleared immediately on cart/session changes, and late responses cannot restore them.

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

- `src/storefront/shopping-bar.js` owns the compact/expanded cart, server price projection, progress, scroll behavior, races and dismissal; `Js/dart-navigation.js` provides its deferred, versioned loader. `Js/dart-ui.js` forwards accepted checkout quotes to the same bar. `CSS/main.css` and `CSS/responsive.css` own its fixed insets and responsive layout. Sources rebuild through the existing frontend commands. The visual revision adds no endpoint, database migration or campaign activation.
- `promotion.service.ts` validates and selects relevant campaign progress; `commerce.service.ts` computes shipping/gifts and returns progress in the owned cart quote. `card-purchase-goal.ts` derives private progress and awards a stable card under the existing card lock/guard, with audit history.
- The existing settings/promotions endpoints persist JSON to PostgreSQL with normal permissions and version checks. `GET /me/promotions/card-progress` adds a private, no-store read. No migration or new paid service is required. No production campaign or card goal was activated during implementation.
- Local backend check: 143 suites and 1,016 tests passed, plus the added customer-progress HTTP authorization case passed separately. Integration scenarios cover configured display distance, true zero shipping, shipping plus Birthday pricing, cheapest-piece gifting, cumulative gift returns, paid-delivered goal counting and duplicate-award prevention. External/database-only scenarios keep their existing skips.
- All 67 maintained frontend static checks pass. Dedicated runtime tests cover direction, overscroll, focus, cart links, safe text, progress, dismissal, empty carts, session races and service failures. Initial/core and homepage JavaScript remain within their existing budgets.
- Visual revision local validation: production assets build, all 67 static checks pass, and shipping integration verifies that only accepted quotes reach the bar. The existing shared money formatter keeps initial/core payload within its 966 KiB limit. Local Chromium cannot launch under the host's socket restrictions; the required Chromium CI suite verifies the six-width geometry before Vercel releases the commit.
- `shopping-feedback-browser.cjs` covers real CSS geometry at 320/370/480/767/768/1366px: 44px compact height, exact 7px insets, glass blur, burgundy text and white count, whole-pound display, expanded height, white progress at two-thirds and completion, fixed placement while scrolling, real cart-link navigation, page clearance and dismissal. Fresh cart/checkout URL fixtures verify no bar, no bar pricing requests and an intact scroll navbar. The general CSS comparison retains fonts/colors/sizes/children/pixels; only the header's deliberately changed positioning properties are compared by this dedicated test. Full browser CI and production alias checks must succeed before reporting a release live.

## Quality review

| Item | Result | Evidence |
| --- | --- | --- |
| 1. States | Pass | Empty, loading, failed, dismissed, repeated and late price/progress responses are covered |
| 2. Server authority | Pass | Whole-pound formatting leaves original owned-quote piastres unchanged; server offer eligibility |
| 3. Concurrency | Pass | Cart/session sequence guards and accepted-quote identity; existing campaign/order/card locks |
| 4. Validation / access | Pass | Strict Zod input, Staff permissions/MFA/CSRF, own-session private progress |
| 5. Idempotency | Pass | Checkout retry, cumulative refunds, stable goal-card insertion |
| 6. Audit | Pass | Existing campaign/settings audit plus purchase-goal issuance audit |
| 7. Services / cost | N/A | No message/provider call or new paid service |
| 8. Regressions | Local pass; browser CI required | Checkout suppression, zero extra requests, header and responsive glass layout coverage |
| 9. Tests | Pass | Runtime, money, PostgreSQL-schema and authorization scenarios above |
| 10. Secrets | Pass | No credentials or durable business data added to browser files |

Pause a campaign or card goal to stop future eligibility. Preserve the gift settlement logic for orders already sold under these offers; existing order snapshots and awarded cards must remain readable after rollback.

## Manual review of the visual revision

1. Add a piece: confirm the compact glass row has burgundy text, a white count in a burgundy circle, **عرض السلة**, an amount without decimal digits and no total caption. Wait for the inline checkmark to expire: the cart bar remains at the same height.
2. With an explicitly configured eligible offer, confirm its name and remaining count appear in the taller bar. Add a qualifying piece and confirm the white line advances. Recheck 7px insets while scrolling and at mobile/desktop widths.
3. Open the cart through the bar and continue to checkout: neither view shows the strip or reserves its spacing. Verify the exact original total in checkout, including fractional piastres when applicable. On other pages remove all pieces, dismiss/reopen through a cart change, and verify no stale customer message survives logout.
