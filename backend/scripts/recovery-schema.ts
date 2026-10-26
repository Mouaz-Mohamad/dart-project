import assert from "node:assert/strict";
import type { Pool } from "pg";
import { readMigrationFiles, selectMigrationsToApply } from "../src/database/migrate.js";

export async function verifiedRecoveryMigrationNames(pool: Pool, directory: string): Promise<string[]> {
  const files = await readMigrationFiles(directory);
  const history = await pool.query<{ name: string; checksum: string }>("SELECT name,checksum FROM dart_schema_migrations ORDER BY name");
  // Use the migrator's exact legacy-name AND checksum rules. No DDL, backfill,
  // lock or history rewrite is needed in a read-only recovery check.
  const pending = selectMigrationsToApply(files, history.rows);
  assert.equal(pending.length, 0, "Restored schema has unapplied migrations");
  assert.equal(history.rows.length, files.length, "Restored schema has unexpected migration history");
  return history.rows.map((row) => row.name);
}
