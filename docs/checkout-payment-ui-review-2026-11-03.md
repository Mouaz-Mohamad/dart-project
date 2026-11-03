# Checkout payment presentation — 2026-11-03

Removed the repetitive automatic-discount explanation paragraphs for Dart Card, birthday and campaigns from `Js/dart-ui.js`, plus their unused CSS. Discount selection, rates, input state, applied indicator and totals are retained.

Replaced the disabled cash checkbox and oversized Payment Method heading in `cart-checkout.html` with a single non-interactive cash-on-delivery row: cash icon, title and a short payment timing description. Styling lives in `CSS/main.css`; generated Home CSS was rebuilt. No card-payment controls or additional payment methods are introduced.

Validation: `npm run build`, `npm run check` (42 frontend static checks), database-authoritative-storage contract, JavaScript syntax and diff whitespace checks. A focused runtime check exercised Dart Card 40%, birthday 30%, campaign 20% and no-discount cases without creating explanatory paragraphs. Existing checkout Chromium regression passes, including a cash-only accessible region, no payment input, location pending/timeout guards and payment bounds at 370/480/767/768/1440px. Screenshots at 370px and 1440px were inspected.

The historical CSS equivalence fixture excludes only the intentionally redesigned `.dart-cash-payment` region from both sides; its presentation is checked by the dedicated checkout browser suite. Five checkout equivalence comparisons verify the remaining computed styles, geometry and pixels against the previous revision. No other page design was changed.

No endpoints, database migrations, payment behavior, pricing rules or address-verification logic changed. The known existing full-site smoke failure concerning aborted profile review requests is outside this presentation change.

| # | Review | Result |
| --- | --- | --- |
| 1 | States | Pass: existing cart/checkout states retained; cash has no selectable/loading state. |
| 2 | Server authority | Retained: only presentation changed; existing server totals/discount validation retained. |
| 3 | Concurrency | Retained: no async logic changed; existing checkout address race tests pass. |
| 4 | Validation/authorization | Retained: no API or permission changes; removed checkbox was disabled and never submitted. |
| 5 | Idempotency | Retained: checkout submit guard and idempotency behavior unchanged. |
| 6 | Audit | Not applicable: no sensitive operation or persistent data change added. |
| 7 | External services | Not applicable: no new external calls, paid service or WhatsApp change. |
| 8 | Regression | Pass: discounts retained, checkout layout outside payment equivalent, mobile/desktop inspected. |
| 9 | Tests | Pass: maintained static checks and checkout Chromium regression; discount branches exercised. |
| 10 | Secrets | Pass: no credentials or private customer data introduced. |
