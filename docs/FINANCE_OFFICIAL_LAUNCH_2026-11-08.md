# Dart official accounting launch — 8 November 2026

## Boundary and retention
- **Start:** 2026-11-08 at 00:00 Africa/Cairo, inclusive (not November 18).
- Anything created before launch remains intact in database/audit history but is **test bookkeeping** excluded from official Finance and income report aggregates.
- A pre-launch order delivered after launch remains a test sale. This is keyed by **order creation date**, while a real sale is recognized by **delivery date**.
- Payment receipts for pre-launch orders do not become official turnover just because they were posted later.
- No DELETE, TRUNCATE, UPDATE of financial data or historical migration is required.
- Stock brought in before launch is still a **current inventory asset** if it physically exists. Costs of pieces sold after launch remain in COGS even if those pieces were stocked before launch.

## Read-only Neon reconciliation (snapshot 2026-11-19, EGP)
| Metric | Result |
|---|---:|
| Delivered orders created on/after start | 11 |
| Delivered pieces | 26 |
| Sold without item-level discounts | 16 |
| Sold with discounts | 10 |
| Campaign-discounted units | 9 |
| Code-discounted units | 1 |
| Item-list selling value | 21,085.00 |
| Item discount reduction | 6,539.50 |
| Net pieces selling | 14,545.50 |
| Shipping billed to customer | 400.00 |
| Net delivered order revenue incl. shipping | 14,945.50 |
| Received other income | 4,385.00 |
| Recognized sales + received other income | 19,330.50 |
| COD settlements recorded | 13,945.50 |
| Confirmed cash inflow (settlements + received income) | 18,330.50 |
| Paid operating expenses | 3,350.00 |
| Unpaid operating expenses | 15,220.00 |
| Total recognized operating expenses | 18,570.00 |
| COGS based on sold item snapshots | 17,735.00 |
| Total accrual cost (COGS + operating expenses) | 36,305.00 |
| P&L net result (includes other income) | -16,974.50 |
| Cash movement based on recorded receipts/payments | +14,980.50 |
| Currently unsold pieces | 17 |
| Current stock cost value | 11,495.00 |

### Important accounting semantics
1. The 6,539.50 EGP discounts have **already been deducted** from order revenue; never subtract them a second time.
2. Courier allocation of 1,100.00 EGP is identified separately but **already included in immutable item costs** per existing Dart policy; not an additional deduction in P&L or bank balance.
3. Unpaid expenses affect accrual profit, **not cash out**.
4. Inventory cost on shelves is an asset, **not a new operating expense**. Stock acquisition cash out is separate and requires explicit paid expense entries.
5. Customer-paid order shipping is inside delivered order revenue. Confirmed courier remittances differ from order totals as carrier amounts may be retained and receipts pending.
6. **Other Income** records are separate ledger entries. An earlier manual gift receipt mentions K-17 and K-19 in its description, but is not formally linked to these orders. Review its documentary basis; do not create another income entry automatically.
7. Invoices are document controls, **not a second revenue/expense booking**.

## Technical changes
- Shared official date constant for backend, Cairo-local matching for browser.
- Finance report/Income queries exclude prelaunch created entries and linked prelaunch order receipts.
- Brand period defaults to `since_launch` and November month range is clamped to Nov 8.
- Finance UI grouped into sales/discounts, cost/expenses, P&L, actual cash, stock and marketing.
- Stock balance is not filtered by original date of arrival.
- Brand cards/charts use the same P&L `totalCost` and `netProfit`; Owner investment is not mislabeled as net profit.
- New backend/frontend tests protect the cutoff, snapshots and inventory separation.

## Further finance controls
Period views cannot prove the actual bank/cash drawer balance. Reconcile pending carrier receipts, cash held by drivers and genuine supplier invoice payments against external cash records before treating this as a certified accounting close.
