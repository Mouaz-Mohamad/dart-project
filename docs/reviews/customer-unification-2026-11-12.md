# Unified customer records — 12 November 2026

Website registration, dashboard customer creation, manual orders and manual waiting requests now resolve a single customer by normalized primary phone or email. Names and secondary contact numbers never determine identity. Two different matches return `CUSTOMER_IDENTITY_CONFLICT` for review instead of merging existing accounts.

## Data and precedence

- Migration `0085_unified_customer_records.sql` adds customer profile provenance, contact-phone history, address history, old-code aliases and migration-conflict records. Original dashboard customer records remain stored with their aliases.
- Website name and birthday take precedence over dashboard data. Omitting a birthday or email does not erase existing values. A customer explicitly clearing their own email remains supported.
- Secondary numbers and order-recipient numbers are contacts only. They are not authentication identifiers and may be shared. Previously authenticated secondary numbers are moved to contacts; affected old sessions are revoked. Accounts with only a primary phone retain their sessions.
- The existing profile governorate is retained; otherwise the saved address or latest order with a known governorate fills the gap. Order and saved-address history remain visible in Customer Details. The storefront profile displays the gathered governorate.
- Old `DA-*` / `CDB-*` references resolve to the canonical `DR-*` customer. Existing guest orders are linked without changing their recipient snapshots, item prices, totals or IDs. Dashboard domain references are normalized before existing relational projection triggers execute.
- Existing customer IDs and benefit ledgers are retained. Signup reuse and birthday correction do not reset a used birthday entitlement. Card balances and historical pricing are not recomputed. No messaging command is invoked by the migration.
- Ambiguous or invalid legacy records remain visible with an identity-conflict notice. Correct the primary phone/email and save the record to retry reconciliation. Two already registered accounts are never automatically merged.

## API and files

- New `POST /api/v1/admin/customers`: permission-gated canonical create/reuse with Staff authentication, MFA, CSRF and server validation.
- Existing `/auth/register`, `PATCH /me` and `PATCH /admin/customers/:id` share `identity/customer-record.ts` and the serialized database identity command.
- Existing `/me` response adds `contactPhones`, `country`, `governorate` and `addresses`; `phones` keeps its existing display contract while login reads primary identity phones only.
- Dashboard customer projection and history/discount lookups resolve aliases. Birthday queue lookups accept old aliases and do not bypass canonical preferences/birthday through stale manual projections.
- Commerce order writes capture customer address/contact history. Manual waiting creation uses the same identity command. The existing Owner-only reset command knows the new dependent tables; no reset was performed.
- Maintained browser sources under `src/` were changed and their delivery bundles rebuilt. No CSS or product-pricing implementation was changed.

## Validation

- Backend lint, TypeScript and Vercel configuration checks passed.
- Backend full suite with `--maxWorkers=2`: 873 passed, 67 skipped. The default higher worker count hit unrelated PGlite startup timeouts; bounded concurrency passed the suite.
- Final focused identity HTTP/customer tests: 31 passed, 1 skipped. Cases include dashboard → website reuse, old-order/review linking, shared contact numbers, secondary-number login rejection, primary/email conflict rollback, address history, website precedence, used birthday preservation, suspension, Arabic digits/international formats, and Staff/MFA/CSRF boundaries.
- Database-authoritative storage, account-session runtime and authentication contract checks passed. Source ownership, JavaScript parsing and generated-runtime freshness passed.
- Two existing browser-test fixtures were aligned with the current variant quote and courier currency/helper contracts; product behavior was not changed for these fixtures.
- The full frontend static runner reaches an existing CSS audit failure in untouched `index.html` (`covered declarations in embedded style`). This is outside the customer change. No CSS cleanup is included.
- The existing customer-details Chromium test could not launch because the configured Chromium executable is missing. Browser layout inspection remains unverified in this environment.
- A direct PostgreSQL concurrency test is included for `TEST_DATABASE_URL`. Network DNS prevented the direct test connection, so this case remains skipped locally. Database advisory serialization and primary-phone/email unique constraints enforce the race boundary.
- Two transaction-and-rollback migration rehearsals on the actual database passed. The final rehearsal produced 8 unified customers, 12 old references, 9 linked live orders and zero identity conflicts. Existing website names/birthdays, order count, total order value and outbox count were preserved. No rehearsal changes were committed.

## Quality review

| Area | Result |
| --- | --- |
| Empty/loading/error states | Pass: disabled create while saving, errors retain the form; empty contact/address history supported. |
| Server authority | Pass: identity, linking and history are persisted in PostgreSQL. |
| Concurrency | Pass by advisory serialization and unique constraints; direct concurrent-client test unavailable as noted above. |
| Validation/authorization | Pass: protected API boundaries and conflict rejection tested. |
| Idempotency | Pass: repeated signup reuses the same ID; aliases/history have stable unique keys. |
| Audit | Pass: identity changes and legacy snapshots remain queryable; existing domain/actor audit retained. |
| External service cost | Pass: no WhatsApp or paid provider sends were executed. |
| Regression | Pass for backend/affected runtime checks; unrelated CSS and unavailable Chromium limits recorded above. |
| Tests | Pass for the critical customer paths listed above. |
| Secrets | Pass: no credentials in tracked files, browser bundles or introduced logs. |

## Manual acceptance

1. Open Customers and locate `DR-1` / `DR-3`; their old `DA-2` / `DA-6` records should no longer appear as separate customers.
2. Open Orders in their details: `K-5` and `K-10` belong to the respective profiles.
3. Create a dashboard customer, then register from the website using its primary phone with a different display name. One customer remains; website name/birthday win.
4. Place an order with a secondary number and address. Reopen the profile/customer details: the contact number and address history appear. Secondary contact alone cannot log in.
5. Attempt to combine one customer's primary phone with another customer's email. Saving is refused; both existing profiles retain their histories.

Rollback of application code should retain the additive schema and alias/audit records. Do not drop the history tables or restore old duplicate customer arrays as a rollback shortcut.

## Applied migration

Migration 0085 was committed to Neon after the rehearsals, under the schema-migration advisory lock and with its SHA-256 recorded in `dart_schema_migrations`. Transactional preservation assertions passed. Result: 8 canonical customers, 12 aliases, 9 linked live orders, zero unresolved conflicts. No reset, order creation or messaging command was run.
