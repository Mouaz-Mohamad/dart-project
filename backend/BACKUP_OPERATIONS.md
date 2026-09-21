# Dart PostgreSQL backup and recovery operations

Dart business data is server-authoritative. A database backup is therefore part of the production data-safety boundary, not an optional developer convenience.

## Create a verified backup

Install PostgreSQL client tools compatible with the database server, keep `DATABASE_URL` in the environment, then run from `backend/`:

```bash
npm run db:backup
```

The command writes a timestamped PostgreSQL custom-format archive under `backend/backups/` and immediately runs `pg_restore --list` against it. A backup is not reported as successful until the archive is non-empty and readable.

To choose an explicit path:

```bash
npm run db:backup -- backups/manual-before-change.dump
```

To verify an existing archive without connecting to the live database:

```bash
npm run db:backup:verify -- backups/manual-before-change.dump
```

The script passes database credentials through PostgreSQL environment variables rather than command-line arguments and never prints `DATABASE_URL` or the password.


### Automated isolated restore verification

For a real restore drill, create an **empty, isolated** recovery database and set:

```bash
export DART_RECOVERY_DATABASE_URL="postgresql://.../dart_recovery"
npm run db:restore:verify -- backups/<backup>.dump
```

The command refuses to run when the recovery target resolves to the same database identity as `DATABASE_URL`. It also requires the target database name to contain `recovery`, `restore`, `drill`, or `test`. It never creates, drops, cleans, or overwrites a database automatically; the recovery target must already exist and be disposable.

The restore uses `--single-transaction` and `--exit-on-error`, so a failed archive does not leave a partially restored verification database.

## Storage policy

Do not keep the only backup on the application server and never commit a dump to Git. Copy verified archives to encrypted, access-controlled backup storage. A practical starting retention policy is daily backups for 14 days, weekly backups for 8 weeks, and monthly backups for 12 months. Adjust retention when legal, accounting, or business requirements are defined.

Backups contain customer, order, staff, representative and operational data. Treat every archive as sensitive production data.

## Restore drill

A readable archive is not enough. At least monthly, restore a recent backup into an isolated recovery database that is not connected to the live storefront.

Use credentials supplied through PostgreSQL environment variables, then restore with PostgreSQL client tools:

```bash
pg_restore --no-owner --no-privileges --dbname="$PGDATABASE" backups/<backup>.dump
```

For a clean recovery target, create a new empty database instead of using destructive restore flags against production.

After restoration:

1. Run the migration command; it should report the schema as current.
2. Verify `/api/v1/health/ready` against the recovery database.
3. Check counts for customers, models, inventory items, orders, order items, audit logs and outbox events.
4. Open representative/order/return/finance sample records and verify relationships and money snapshots.
5. Record the backup timestamp, restore timestamp and result of the drill.

## Before high-risk changes

Create and verify a backup immediately before schema migrations, bulk imports, destructive admin reset operations, or any one-off data repair. A migration or reset should not proceed when the pre-change backup cannot be verified.
