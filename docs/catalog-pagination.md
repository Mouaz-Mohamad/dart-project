# Bounded public catalog hydration

The storefront now requests the existing `/api/v1/catalog?page=N&limit=100` contract. It merges model and stock pages only when their versions, totals and row counts agree. A version change restarts the read up to three times. Failed, duplicate or incomplete pages preserve the previous complete projection; the existing hydration error/retry path remains available. An older API without pagination remains compatible during separate deployments.

No endpoint, database migration, price/discount rule or product layout changes. Existing filters and related-model lookup still use the complete catalog in browser memory. This bounds individual response sizes, not total browser memory. The existing backend maximum of 10,000 pages is enforced without silently truncating the result.

Manual check: open Products, filter by category, open a model and verify related products and stock. In Network, catalog requests include `page` and `limit=100`. With more than 100 models, later pages load before the confirmed projection changes. An interrupted later page retains the previous products; reconnect/focus triggers the existing version reconciliation.

| Quality review | Result |
| --- | --- |
| 1. States | Pass: empty complete catalog, pending pages and offline/invalid errors covered |
| 2. Authority | Pass: read-only existing server models/stock; checkout validation unchanged |
| 3. Concurrency | Pass: same-version pages, bounded restarts and slower snapshot isolation |
| 4. Validation/auth | Pass: existing public read endpoint; page metadata/identifiers validated |
| 5. Idempotency | Pass: retrying reads has no business writes |
| 6. Audit | Not applicable: no sensitive mutations introduced |
| 7. External costs | No added provider or outbound customer messages |
| 8. Regression | Existing source/static checks and full-site browser smoke |
| 9. Critical tests | Maintained and delivered runtimes: 205 models/stock merge, interrupted page, drift, repeated drift, corrupt metadata, duplicate IDs, empty/legacy API and concurrent reads |
| 10. Secrets | Pass: no credentials introduced |
