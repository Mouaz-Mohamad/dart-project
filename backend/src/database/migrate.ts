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
const LEGACY_DUPLICATE_MIGRATION_PREFIXES = new Set(["0013", "0014", "0015"]);

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

  const invalidDuplicatePrefixes = [...counts.entries()]
    .filter(
      ([prefix, count]) =>
        count > 1 && !LEGACY_DUPLICATE_MIGRATION_PREFIXES.has(prefix),
    )
    .map(([prefix]) => prefix)
    .sort();

  if (invalidDuplicatePrefixes.length > 0) {
    throw new Error(
      `Duplicate migration sequence prefixes are not allowed: ${invalidDuplicatePrefixes.join(", ")}`,
    );
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

export function selectMigrationsToApply(
  files: MigrationFile[],
  applied: AppliedMigration[],
  requestedOne?: string,
): MigrationFile[] {
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));
  for (const file of files) {
    const existingChecksum = appliedByName.get(file.name);
    if (existingChecksum && existingChecksum !== file.checksum) {
      throw new Error(`Applied migration checksum changed: ${file.name}`);
    }
  }

  const pending = files.filter((file) => !appliedByName.has(file.name));
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
