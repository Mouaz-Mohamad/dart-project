# Pre-launch security remediation

## Scope and intentional behavior

Guest purchase attribution follows the approved contact-matching design in `guest-checkout-contact-matching-2026-11-27.md`. Typed matching contacts are not identity verification: they only attach a new purchase. No guest session, history access or personal reward access is granted.

Sequential changes:
1. Guest contact matching and separate records for partial matches, with contact email displayed administratively.
2. Public serials return a generic purchaser label; leaderboard names are rank-local generic labels.
3. Migration 0100 makes discount-table RLS reproducible and revokes Data API roles without disrupting the API runtime.
4. Public SSR/sitemap functions enforce bounded per-instance request, concurrency and key-storage quotas. The news sitemap has a 50-page upstream budget and 60-second shared-cache TTL. Individual article reads retain no-store publication semantics.
5. Background outbox and WhatsApp persistence failures produce structured, sanitized diagnostics. Authenticated error logs include internal actor identity, never cookies or tokens.
6. Dashboard chart libraries use exact versions and SHA-384 SRI rather than mutable CDN URLs. `scripts/external-browser-scripts.json` records their origins and fingerprints.

## Operational evidence

- Neon production: `spring-recipe-45034941`, branch `br-aged-meadow-b1631frp`. Migration 0100 was applied transactionally with a migration lock, 3-second lock timeout and 15-second statement timeout; its recorded checksum matches the source. Verification found zero public tables lacking RLS, zero broadly public true policies, and 23 orders both before and after the change.
- Verified encrypted backup run: https://github.com/Mouaz-Mohamad/dart-project/actions/runs/45853158354 (2026-11-26). Backup, isolated restore, application financial checks and integrity scan all succeeded. Artifact `dart-database-backup-45853158354` was available, not expired, size 7,504,579 bytes. No production restore was performed.
- Neon reported a six-hour instant-restore history window. Retained external backup artifacts are configured for 14 days.
- Previous ready production deployments at source d2aa06bf: storefront `dpl_EcQKuRXGhMp27gNrWzwet3XkSQk9`; API `dpl_HR7gD8zfjyFonfrtuU7wvuDMtZAd`. Both were marked rollback candidates by Vercel. Preserve additive RLS and customer/order records when rolling application code back.

## Remaining provider checks

The Vercel connector refused firewall configuration access; no authenticated Vercel CLI fallback was available. Distributed WAF protection is not established by the per-instance guard. Vercel/Neon organization spend limits and Google Maps API/referrer restrictions could not be verified from accessible settings. No unapproved monetary threshold or automatic service suspension was configured. The dashboard calculator is not a spending cap.

## Quality review

| Area | Result | Verification |
| --- | --- | --- |
| States | PASS | Existing empty, denied, retry and provider-unavailable responses retained. |
| Server authority | PASS | Matching, pricing, stock and role decisions remain server/database authoritative. |
| Concurrency | PASS | Identity/checkout locks retained; bounded SSR concurrency and outbox SKIP LOCKED retained. |
| Validation/access | PASS | No customer names in serial replies; generic leaderboard names; guest attribution never authenticates. |
| Idempotency | PASS | Guest retry and duplicate notification protections retained. |
| Audit/observability | PASS | Actor identity and sanitized background incidents are logged; existing business audit remains durable. |
| External cost | PARTIAL | Per-request limits and bounded retries; distributed WAF and organization spending limits still require provider access. |
| Regression | PASS | Focused tests plus repository frontend/backend checks; no deletion of orders or customer history. |
| Tests | PASS | Checkout, privacy, migration, rate/concurrency and sanitized logging regressions added or updated. |
| Secrets | PASS | No credentials introduced in source, test fixtures or diagnostic messages. |

Final test totals and deployment status are reported in the task response. Real database integration scenarios skipped locally run under the CI test database; synthetic embedded PostgreSQL suites exercise the actual migrations locally.
