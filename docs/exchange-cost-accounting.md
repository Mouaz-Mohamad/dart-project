# Exchange cost and refund accounting

Original delivered order-item cost snapshots remain unchanged. Finance now posts the physical replacement cost less good stock recovered on each completed exchange, then reverses the returned piece's captured cost on a good refund. Exchanges are deduplicated by event identity, so a piece returning to the same order later does not erase an earlier exchange or collide with its refund.

New customer requests, representative completions and manual refunds capture cost from locked server inventory rows. Historical rows without a captured cost use the existing physical inventory cost snapshot; no production records are backfilled. Unknown inspection does not credit good stock. Existing refund values, discount restoration, courier charges and owner acquisition-cost cards remain governed by their current rules.

No schema migration or new endpoint. Changes affect FinanceService summaries and the existing return commands. Existing completed-return posting dates remain the date basis. Rollback is a code revert; the extra JSON snapshot fields are backward-compatible.

Manual test in an isolated environment: sell a standalone item costing300EGP for500EGP, exchange for the same model from a400EGP batch, inspect the original as Good, and refund the replacement as Good. Verify the sale snapshot remains300, exchange adjustment is100, refunded cost is400, and all-time net revenue/net COGS/gross profit are zero. Courier expenses remain real expenses. Repeat with a lower-cost replacement, multiple exchanges and separate date filters.

| Quality area | Result |
| --- | --- |
| 1. States | Existing no-data/error handling retained; zero and absent legacy costs distinguished |
| 2. Server authority | Cost captured from locked inventory; client amounts are not used |
| 3. Concurrency | Existing return-ledger/sale/item transaction locks retained |
| 4. Authorization | Existing command permissions and sale ownership checks retained |
| 5. Idempotency | Completed exchange event identity; duplicate/refund retry guards retained |
| 6. Audit | Cost snapshots included in existing persisted return events/audit trail |
| 7. External cost | No provider calls or customer messages added |
| 8. Regression | Relevant finance/return suites and backend checks |
| 9. Critical tests | Actual exchange→inspection→full refund on isolated schema; legacy/captured costs, cross-period totals and physical-piece reuse |
| 10. Secrets | No credentials or real customer test data |
