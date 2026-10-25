import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { Pool as PostgresPool } from "pg";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runMigrations } from "../src/database/migrate.js";
import { bindMigrationFunctionsToIsolatedTestSchema } from "./integration-schema.js";

// Isolated PostgreSQL with the production schema/triggers. UUID generation is built
// into PostgreSQL; only pgcrypto extension installation is omitted in this engine.
export async function embeddedStore() {
  if (process.env.TEST_DATABASE_URL) {
    const admin = new PostgresPool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const schema = `dart_council_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new PostgresPool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, options: `-c search_path=${schema},public` });
    const close = async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); };
    try { await runMigrations(pool, resolve(process.cwd(), "migrations")); await bindMigrationFunctionsToIsolatedTestSchema(pool); }
    catch (error) { await close(); throw error; }
    return { pool, db: { close } };
  }
  const db = new PGlite();
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
    const result = params.length ? await db.query(text, params) : (await db.exec(text)).at(-1);
    return { ...result, rows: result?.rows || [], rowCount: result?.affectedRows ?? result?.rows.length ?? 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  try { await runMigrations(pool, resolve(process.cwd(), "migrations")); }
  catch (error) { await db.close(); throw error; }
  return { db, pool };
}
