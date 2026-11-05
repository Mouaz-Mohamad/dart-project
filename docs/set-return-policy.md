# Set exchange policy

Every physical piece purchased as part of a Set is ineligible for Exchange. Refund requests retain the existing 14-day eligibility, inspection, allocated-price and authorization rules. Standalone sales of the same models remain exchangeable.

The API checks historical `order_set_components` membership for the specific sale at customer submission, staff approval and representative completion. It does not infer membership from current catalog listings or discount names. Existing pending/approved Set exchanges cannot progress to completion; Back/Reject remains available to recover held replacement stock.

No migration or endpoint was added. Existing return request/action endpoints enforce this policy. Customer order lines expose only a `setComponent` boolean. The return form disables Exchange for those lines and clears a previously selected Exchange without silently choosing Refund. The form and policies page explain the restriction.

Manual acceptance: open the return form for a delivered Set piece; Exchange is disabled and Refund remains selectable. Repeat with a standalone piece from the same model; Exchange remains available. Direct API attempts against Set pieces return 422 `SET_EXCHANGE_NOT_ALLOWED`. For an older approved Set exchange, Complete is refused and Back can release the replacement before Reject.

| Quality review | Result |
| --- | --- |
| 1. States | Pass: existing loading/errors retained; explicit policy notice; standalone options restored on item changes. |
| 2. Server authority | Pass: durable sale membership checked in all operational write paths. |
| 3. Concurrency | Pass: existing return ledger and sale/inventory transaction locks retained; checkout membership immutable for delivered sales. |
| 4. Validation/authorization | Pass: existing ownership, eligibility window, actor and route permissions unchanged. |
| 5. Idempotency | Pass: denied commands roll back without return, inventory or financial side effects. |
| 6. Audit | Pass: successful actions use existing audit; rejected actions commit no partial status change. |
| 7. External cost | Not applicable: no provider calls or messages added. |
| 8. Regression | Pass: Refund/allocated prices and standalone exchanges remain available. |
| 9. Tests | Pass: production-schema component denial, membership projection, refunds, legacy approval/completion denial, backward recovery and executed browser-runtime form behavior. |
| 10. Secrets | Pass: no credentials or private cost fields added to public payloads. |
