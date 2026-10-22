# Dashboard status colors

Rows and their status labels share a 15% alpha background. Text, controls and archived rows retain full opacity; archived rows retain their existing strike-through. Status text remains visible. In Items, only Sold pieces receive the green tint; all unsold pieces retain their original white surface and unfilled status text.

| Color | Examples |
| --- | --- |
| Green | Active, Sold, Delivered, In stock, Published, Paid, Settled, Converted, Repaired |
| Light green | Accepted, Preparing, Processing/Held |
| Blue | New, Scheduled, Expected |
| Yellow | Reserved, Waiting, Pending, Out With Representative, Representative On The Way, Awaiting Settlement, Unpaid |
| Red | Refused, Rejected, Cancelled, Damaged, Destroyed, Suspended, Overdue, Out of stock |
| Purple | Refunded, Partially Refunded, Returned |
| Gray | Draft, Inactive, Expired, Archived, mixed groups and records without a recognized status |

`rowStatus` and `colorSection` in `scripts/dashboard-ui.source.js` own the display mapping; `Eye/dart-dashboard-ui.css` owns the palette. The compact adapter retains original cells so in-place updates recolor the row and its summary. It uses the existing animation-frame refresh and observes relevant status and section attributes. COD rows follow Settlement while Order Status remains independently labeled. Mixed order groups are gray; each order and status breakdown keeps its own color. Inventory groups follow availability, with individually labeled colored counts.

Coverage includes Orders, Models/Sets, Items/groups, Clients, Returns, Damage, Reviews/Contact, Representatives, Dart Cards, News, Waiting, Finance tables/goals/alerts, Staff/invitations, announcements/campaigns and Live Operations. Pure report rows without a lifecycle remain neutral.

The customer, goal, promotion and route renderers expose already-displayed status using `data-status` where a dedicated status column is absent. No state transition, calculation, storage, API, permission, migration or production record is changed.

Readable display-preference code now lives in `scripts/display-preferences.source.js` and is built with the existing pinned Terser pipeline. This offsets the added palette runtime and preserves the existing performance budgets. Do not edit its generated `Eye/dart-display-preferences.js` directly.

## Verification

- All 31 frontend CI static suites, all browser JS syntax checks, delivery build and static production staging passed.
- Existing dashboard groups browser suite extended with 49 status cases across 12 operational sections, plus Staff, live routes, goal and inventory/order group checks; exact 15% computed background colors and full text opacity verified at 370, 480, 767, 768 and 1440 px.
- Sold and unsold Items are checked separately, including Sold → In stock → Sold updates. Unsold pieces and their labels are uncolored.
- In-place status updates change the summary and row; archive overrides its old lifecycle color. COD settlement color takes precedence over a delivered order.
- Full-site Chromium smoke passed for storefront pages and dashboard navigation/settings/actions.
- Manual check: open each section, change an authorized record status, inspect its summary and Details, then switch tabs and archive/restore a record.

## Dart quality review

| Section | Result | Applicability |
| --- | --- | --- |
| 1. State coverage | Pass | Empty lists, unknown/missing statuses and mixed groups remain neutral; current loading/error UI is retained. |
| 2. Server authority | N/A | Display-only change; no new price, stock, status or eligibility decision. |
| 3. Concurrency | Pass | Reuses coalesced rendering; current DOM status is read again on each refresh. No new writes or requests. |
| 4. Authorization | N/A | No permission/endpoint change. Existing controls stay connected. |
| 5. Idempotency | Pass | Repeated coloring changes only presentation attributes and is safe to repeat. |
| 6. Audit | N/A | No sensitive mutation is introduced. |
| 7. External cost | N/A | No paid integration or messaging action is added. |
| 8. Regression safety | Pass | Existing groups, filters, Details, private loading/logout and full-site smoke pass. |
| 9. Tests | Pass | Observable computed-color/responsive/status-update cases and existing frontend checks above. |
| 10. Secrets | Pass | No credentials or environment configuration added. |
