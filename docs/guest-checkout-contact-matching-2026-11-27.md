# Guest checkout contact matching

Guest checkout remains available without signing in. A normalized email and primary login phone belonging to the same eligible customer attach only the new order to that customer. Names, birthdays, login identifiers and existing credentials are not overwritten. A partial contact match creates a separate customer; conflicting login identifiers remain untouched and the submitted contact email remains in the order snapshot. The dashboard displays that email when the separate customer has no login email. Repeated orders with the same pair reuse a contact-only guest record rather than multiplying duplicates.

Typed contact details are purchase attribution, not verified identity. This flow never issues a login session, reveals existing orders or grants account-specific rewards. Anyone who knows both identifiers can still submit an order attributed to that customer; the design deliberately permits that tradeoff for guest checkout. Suspended/rejected login identities remain blocked. Actual access to account history still requires authentication.

## Scope

- Existing `POST /api/v1/guest/orders` only; no new endpoint or migration.
- `customer-record.ts`: match both contacts, separate partial matches, retain primary/secondary login ownership, and serialize decisions with the existing identity transaction lock.
- `dashboard-state.service.ts`: fall back to the order contact email for administrative display only; authentication still uses `users.email_normalized`.
- Existing signed-in checkout, inventory, pricing, idempotency, reservation ownership and OTP/passkey requirements remain authoritative.

## Verification

Targeted checkout and passwordless security: 20 passing tests. Includes normalized exact matches without changing names/birthdays; conflicting accounts; existing email with a new phone; dashboard projection; repeated partially matching contacts; shared and legacy secondary phones; suspended and deleted identities; reservation ownership; failed transaction rollback; duplicate checkout and guest email verification.

Lint, TypeScript checks, backend build, repository security-boundary checks and database-authoritative browser storage checks passed. Final full suite: 144 files passed, 8 skipped; 1,031 tests passed, 68 skipped. Production database integration tests require a dedicated TEST_DATABASE_URL and are skipped when unavailable; embedded PostgreSQL exercises the actual migrations.

## Quality review

| Area | Result | Evidence |
| --- | --- | --- |
| 1. States | PASS | Existing checkout responses retained; contact mismatches no longer force sign-in. |
| 2. Server authority | PASS | Matching and creation execute on the server in the checkout transaction. |
| 3. Concurrency | PASS | Existing identity advisory transaction lock and unique login constraints retained. |
| 4. Validation/access | PASS | Normalized contacts; no guest session or account-history access. |
| 5. Idempotency | PASS | Existing order key and reservation ownership retained; retry regression passes. |
| 6. Audit | PASS | Separate identity audit retains actual phone/email owner references without overwriting their records. |
| 7. External costs | PASS | No added provider calls or messages; existing notification deduplication retained. |
| 8. Regression | PASS | Changes scoped to guest identity matching and the administrative contact-email projection. |
| 9. Tests | PASS | Focused transaction, privacy, dashboard and authentication regressions pass. |
| 10. Secrets | PASS | No credentials introduced; browser storage boundary checks pass. |

## Manual acceptance

1. Use a guest browser to order with an existing customer's normalized email and primary phone. The order should appear on that customer without a new session or changed profile.
2. Change either identifier to a different person's or a new value. A separate customer should receive the order; existing accounts should retain their login identifiers and history.
3. Repeat with the same partially matching pair. The separate guest record should be reused.
4. Check the new customer's contact email in the dashboard. It must not become an alternate login for the owner of an existing email.

Rollback: revert these application changes; no schema changes or data deletion are needed. Existing separate customer records and order contacts must be preserved.
