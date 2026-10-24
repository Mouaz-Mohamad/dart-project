# Dashboard status colors — 25% record tint

Dashboard **rows and status-bearing cards** use a 25% state-color blend over a solid white backing. Status badges keep their existing 5% tint and layout. The tint applies to the background only; text, actions, archived strike-through, and record opacity remain unchanged. Color coding is display-only and does not update the status, data, eligibility, permissions or financial figures.

| Row/card state | Color |
| --- | --- |
| Successful: Delivered, Sold, Completed return/refund/exchange, Repaired, Paid, Settled | Green, 25% |
| Processing: Accepted, Preparing, Processing | Light green, 25% |
| New: New Order, New Request, Scheduled | Blue, 25% |
| In transit / pending: With Representative, On The Way, Waiting, Reserved | Yellow, 25% |
| Failed: Cancelled / Canceled, Delivery Failed, Failed Delivery, Refused, Rejected, Damaged, Not Delivered, Expired | Red, 25% |
| Neutral: customers, in-stock unsold items, draft/unknown statuses, mixed-status group container | No tint |

The central lifecycle classifier is `src/dashboard/dashboard-ui.js`, built into `Eye/dart-dashboard-ui.js`; CSS variables and tint rules live in `Eye/dart-dashboard-ui.css`. The same classification is used for Orders, Models/Sets, Items/groups, Returns/Damage, Reviews/Contact, Representatives, Cards, News, Waiting, Finance and live operational cards.

**Mixed order groups:** The group itself stays uncolored; each child order/status row is independently colored. **Returns:** A completed return/refund/exchange is green even when the original sale was reversed. **Customers:** Rows stay uncolored regardless of account status. **In Stock:** Physical pieces stay neutral until a meaningful business status applies. **Badges:** Keep the original 5% palette and chip styling without changing their appearance.

The existing dashboard compact-record adapter retains the original buttons and live state updates. COD settlement uses the settlement state independently of the order status, as before. Grouped records, archived rows, and responsive table layouts retain existing behavior.

## Verification

`tests/dashboard-groups-browser.cjs` covers the 25% computed record backgrounds at 370, 480, 767, 768 and 1440 px; cancelled/canceled/delivery-failed synonyms, completed returns, sold vs in-stock items, mixed groups, nested blends, background opacity, the unchanged 5% badges, COD priority, dynamic updates and archive transitions.

Run `npm run build:js && npm run check && node tests/dashboard-groups-browser.cjs` before deployment. No order/stock/finance write operation or public storefront code is modified.
