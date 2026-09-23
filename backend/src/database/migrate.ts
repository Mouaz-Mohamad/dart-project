// DART CODE GUIDE | backend/src/database/migrate.ts
// الغرض: طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createDatabasePool } from "./pool.js";

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

interface AppliedMigration {
  name: string;
  checksum: string;
}

const MIGRATION_LOCK_NAME = "dart_backend_schema_migrations";
const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

// These aliases preserve upgrade safety for databases which already recorded the
// historical duplicate-number migration filenames. The SQL blobs themselves are
// unchanged during the rename, so the checksum must still match before an alias
// is accepted as already applied.
const LEGACY_MIGRATION_NAME_BY_CURRENT = new Map<string, string>([
  ["0014_customer_preferences.sql", "0013_customer_preferences.sql"],
  ["0015_dashboard_domain_permissions.sql", "0013_dashboard_domain_permissions.sql"],
  ["0016_representative_manage_permission.sql", "0013_representative_manage_permission.sql"],
  ["0017_staff_onboarding.sql", "0013_staff_onboarding.sql"],
  ["0018_cart_price_review.sql", "0014_cart_price_review.sql"],
  ["0019_damage_manage_permission.sql", "0014_damage_manage_permission.sql"],
  ["0020_inventory_cost_snapshot.sql", "0015_inventory_cost_snapshot.sql"],
  ["0021_platform_reset_permission.sql", "0015_platform_reset_permission.sql"],
  ["0022_guest_cart_ownership.sql", "0016_guest_cart_ownership.sql"],
  ["0023_order_delivery_cost_snapshot.sql", "0017_order_delivery_cost_snapshot.sql"],
  ["0024_relational_business_domains.sql", "0018_relational_business_domains.sql"],
  ["0025_relational_domains_authoritative.sql", "0019_relational_domains_authoritative.sql"],
  ["0026_return_damage_typed_core.sql", "0020_return_damage_typed_core.sql"],
  ["0027_action_permissions.sql", "0021_action_permissions.sql"],
  ["0028_staff_whatsapp_delivery.sql", "0022_staff_whatsapp_delivery.sql"],
  ["0029_staff_mfa_pending_setup.sql", "0023_staff_mfa_pending_setup.sql"],
  ["0030_staff_google_identity.sql", "0024_staff_google_identity.sql"],
  ["0031_staff_simple_email_access.sql", "0025_staff_simple_email_access.sql"],
  ["0032_remove_retired_staff_google_identity.sql", "0026_remove_retired_staff_google_identity.sql"],
  ["0033_customer_signup_without_email_otp.sql", "0027_customer_signup_without_email_otp.sql"],
  ["0034_courier_fee_per_order.sql", "0028_courier_fee_per_order.sql"],
  ["0035_password_reset_email_otp.sql", "0029_password_reset_email_otp.sql"],
  ["0036_waitlist_reservations.sql", "0030_waitlist_reservations.sql"],
  ["0037_waitlist_cart_consistency.sql", "0031_waitlist_cart_consistency.sql"],
  ["0038_live_operations.sql", "0032_live_operations.sql"],
  ["0039_cod_risk_verification.sql", "0033_cod_risk_verification.sql"],
  ["0040_rewards_promotions_draw_integrity.sql", "0034_rewards_promotions_draw_integrity.sql"],
  ["0041_reward_history_reference_compatibility.sql", "0035_reward_history_reference_compatibility.sql"],
  ["0042_dart_card_active_concurrency_lock.sql", "0036_dart_card_active_concurrency_lock.sql"],
  ["0043_reward_reservation_after_order_insert.sql", "0037_reward_reservation_after_order_insert.sql"],
  ["0044_customer_social_auth_and_multi_winner_draw.sql", "0038_customer_social_auth_and_multi_winner_draw.sql"],
]);

function formatSequence(value: number): string {
  return String(value).padStart(4, "0");
}

export function assertMigrationNamingPolicy(names: string[]): void {
  const counts = new Map<string, number>();

  for (const name of names) {
    if (!MIGRATION_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid migration filename: ${name}`);
    }

    const prefix = name.slice(0, 4);
    if (Number(prefix) < 1) {
      throw new Error(`Invalid migration sequence prefix: ${prefix}`);
    }
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  const duplicatePrefixes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([prefix]) => prefix)
    .sort();
  if (duplicatePrefixes.length > 0) {
    throw new Error(
      `Duplicate migration sequence prefixes are not allowed: ${duplicatePrefixes.join(", ")}`,
    );
  }

  const ordered = [...counts.keys()].map(Number).sort((left, right) => left - right);
  for (let index = 1; index < ordered.length; index += 1) {
    const expected = ordered[index - 1]! + 1;
    const actual = ordered[index]!;
    if (actual !== expected) {
      throw new Error(
        `Migration sequence must be consecutive: expected ${formatSequence(expected)}, found ${formatSequence(actual)}`,
      );
    }
  }
}

export async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const directoryEntries = await readdir(directory);
  const sqlNames = directoryEntries.filter((name) => name.endsWith(".sql"));
  assertMigrationNamingPolicy(sqlNames);

  const names = sqlNames.sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

function appliedMigrationFor(
  fileName: string,
  appliedByName: Map<string, string>,
): AppliedMigration | undefined {
  const directChecksum = appliedByName.get(fileName);
  if (directChecksum) return { name: fileName, checksum: directChecksum };

  const legacyName = LEGACY_MIGRATION_NAME_BY_CURRENT.get(fileName);
  if (!legacyName) return undefined;
  const legacyChecksum = appliedByName.get(legacyName);
  return legacyChecksum ? { name: legacyName, checksum: legacyChecksum } : undefined;
}

export function selectMigrationsToApply(
  files: MigrationFile[],
  applied: AppliedMigration[],
  requestedOne?: string,
): MigrationFile[] {
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));
  for (const file of files) {
    const existing = appliedMigrationFor(file.name, appliedByName);
    if (existing && existing.checksum !== file.checksum) {
      throw new Error(`Applied migration checksum changed: ${existing.name}`);
    }
  }

  const pending = files.filter(
    (file) => !appliedMigrationFor(file.name, appliedByName),
  );
  if (!requestedOne) return pending;

  const normalized = requestedOne.endsWith(".sql") ? requestedOne : `${requestedOne}.sql`;
  const selected = pending.find((file) => file.name === normalized);
  if (!selected) throw new Error(`Pending migration not found: ${normalized}`);
  if (pending[0]?.name !== selected.name) {
    throw new Error(`Cannot apply migrations out of order. Next migration: ${pending[0]?.name}`);
  }
  return [selected];
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dart_schema_migrations (
      name TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(
  pool: Pool,
  directory: string,
  requestedOne?: string,
): Promise<string[]> {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    lockAcquired = true;
    await ensureMigrationTable(client);
    const appliedResult = await client.query<AppliedMigration>(
      "SELECT name, checksum FROM dart_schema_migrations ORDER BY name",
    );
    const files = await readMigrationFiles(directory);
    const pending = selectMigrationsToApply(files, appliedResult.rows, requestedOne);
    const appliedNames: string[] = [];

    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO dart_schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        appliedNames.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return appliedNames;
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
      }
    } finally {
      client.release();
    }
  }
}

function requestedMigration(argv: string[]): string | undefined {
  const flagIndex = argv.indexOf("--one");
  if (flagIndex === -1) return undefined;
  const name = argv[flagIndex + 1];
  if (!name) throw new Error("--one requires a migration filename");
  return name;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createDatabasePool(config);
  try {
    const applied = await runMigrations(
      pool,
      resolve(process.cwd(), "migrations"),
      requestedMigration(process.argv.slice(2)),
    );
    logger.info({ applied }, applied.length ? "Migrations applied" : "Database is up to date");
  } finally {
    await pool.end();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Migration failed"}\n`);
    process.exitCode = 1;
  });
}
