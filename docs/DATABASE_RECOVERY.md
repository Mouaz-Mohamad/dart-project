# Database backup and recovery

`database-backup.mjs` creates and lists custom-format PostgreSQL archives. Archive readability alone is not a restore proof. `encrypted-database-backup.mjs` adds streaming AES-256-GCM authenticated encryption, a random salt/nonce, scrypt key derivation and private files. Modified/truncated archives and incorrect passwords fail before PostgreSQL restore starts. Temporary plaintext is removed on both success and failure; existing target files are never replaced.

## Daily workflow

`.github/workflows/database-backup.yml` runs on `main` at 03:17 UTC daily or by manual dispatch. It reads the database, encrypts the dump, authenticates/decrypts it and restores it transactionally into a disposable PostgreSQL 18 CI service. Only a successful run uploads the encrypted archive, retained for 14 days. Production is never the workflow restore target. It does not change Vercel or Neon endpoints, branches or defaults.

Configure these repository secrets directly in GitHub Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `DART_BACKUP_DATABASE_URL` | Direct PostgreSQL connection for the intended production database; use a dedicated backup role with SELECT rights over all required data, including the necessary RLS access. |
| `DART_BACKUP_ENCRYPTION_PASSWORD` | A randomly generated password of at least 32 characters; keep a separate secure recovery copy. Losing it makes the archives unrecoverable. |

Restrict secret-bearing runs to reviewed, protected `main`. The workflow never runs on pull requests and has read-only repository permissions. Missing secrets fail the job explicitly; a committed workflow does **not** prove scheduling is active. Enable/configure Actions and run one manual dispatch; verify its restore step and downloadable artifact before relying on the daily schedule. GitHub scheduling can be delayed, so this is a daily target rather than a guaranteed execution time. Inspect failed runs and the age of the latest successful archive routinely.

The PostgreSQL client major version must be at least the source major version. The workflow uses the official PostgreSQL 18.6 image. A dump excludes global roles/role passwords and owner/grant recreation. Keep application configuration and role grants documented separately. Never publish decrypted dumps as CI artifacts.

## Controlled restore drill

Use an empty, isolated database whose name contains `recovery`, `restore`, `drill` or `test`. Configure `DATABASE_URL`, `DART_RECOVERY_DATABASE_URL` and `DART_BACKUP_ENCRYPTION_PASSWORD` through the local environment without printing them, then run:

```bash
node backend/scripts/encrypted-database-backup.mjs restore-verify /absolute/path/database.dump.enc
```

The guard rejects the same host/port/database even when the role differs or a Neon pooled hostname is used. Restore uses `--single-transaction --exit-on-error --no-owner --no-privileges`; it has no cleanup/drop command. Check restored migrations, critical table counts, FK integrity and application behavior before any separately approved production recovery. Never use an unspecified Neon snapshot restore target: explicitly use an isolated target and `finalize: false`, then verify production's branch/default/endpoint before any cutover.

## Evidence on 2026-10-09

- Native Neon snapshot scheduling was unavailable on the current free plan; creating another snapshot exceeded its quota. No paid plan change was made. The external workflow remains pending secret configuration and its first successful run.
- A current-data safety branch was retained before the snapshot drill.
- **Operational incident:** the Neon snapshot restore tool unexpectedly finalized onto the production endpoint when its target/finalize parameters were omitted. Production briefly served the older snapshot between approximately 14:17:55 and 14:19:37 UTC. The original branch/default/endpoint were restored immediately. The incident was disclosed during the work. No application writes were intentionally sent during that interval; absence of customer writes in that interval has not been independently established.
- The original database was checked again after correction: 16 orders, 21 order items, 21 inventory items, 1,447 audit entries, total `final_minor` 1,095,600; no orphan order items and no public tables without RLS. The API readiness check passed. These checks support restored database integrity, rather than proving the brief interval had no customer impact.
- The recovered older snapshot contained 4 orders, 6 order items/inventory items, 323 audit entries and no orphan order items. The recovered and safety branches were retained; no data branch was deleted.
- The encrypted dump/restore path is tested separately against synthetic local PostgreSQL data. This does not replace the pending production backup workflow activation.
