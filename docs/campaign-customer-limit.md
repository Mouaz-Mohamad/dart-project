# Unique-customer campaign limits

For `limitBasis=customers`, an existing Reserved/Used beneficiary does not consume another unique-customer slot. They can reuse the campaign only while their per-customer usage limit permits it. New beneficiaries remain blocked at the global customer cap. `limitBasis=orders` continues to count every Reserved/Used order. Returned delivered campaign benefits remain Used under the existing policy.

The service eligibility query and migration `0073_campaign_unique_customer_reuse.sql` implement the same predicate. The migration replaces only the existing reward-reservation trigger function; its campaign-row lock, other eligibility checks, Birthday behavior, permissions and historical ledgers are retained. No existing migration is edited and no endpoint is added.

Validation: 26 targeted local tests pass; two PostgreSQL-only tests run in CI. Scenarios include Reserved/Used repeat beneficiaries, new customer rejection, per-customer exhaustion, order-basis limits, concurrent last-slot allocation and existing mixed-discount/return accounting. The live function body is compared with its previous migration before replacement. Neon cannot create another test branch because its branch quota is full; existing recovery branches remain untouched, and PostgreSQL CI tests use an isolated schema with the complete migration history.

Manual acceptance: configure one unique customer and two uses per customer; first customer can use twice, another cannot join, and a third use is refused. Change the basis to orders to confirm the second order is refused. Recovery restores the previously reviewed function body; campaign usage history requires no backfill or rewrite.

| Review | Result |
| --- | --- |
| 1. States | Pass: existing exhausted/ineligible response retained. |
| 2. Authority | Pass: SQL trigger enforces the same service predicate. |
| 3. Concurrency | Pass: campaign FOR UPDATE lock serializes slot allocation. |
| 4. Auth/input | Pass: existing campaign schemas and management permissions unchanged. |
| 5. Idempotency | Pass: order-id unique usage and checkout idempotency unchanged. |
| 6. Audit | Pass: existing checkout/campaign audit retained; migration recorded with checksum. |
| 7. Cost | Not applicable: no provider calls or additional service. |
| 8. Regression | Pass: per-customer cap, order basis, other reward branches and return policy retained. |
| 9. Tests | Pass locally; real PostgreSQL concurrency runs in CI before applying the live migration. |
| 10. Secrets | Pass: no sensitive data or credentials introduced. |
