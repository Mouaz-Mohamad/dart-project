// DART CODE GUIDE | backend/tests/integration-schema.ts
// الغرض: إبقاء دوال migrations المقيدة بـ public آمنة في الإنتاج مع ربطها فقط داخل اختبارات PostgreSQL بالـschema المعزول لكل Suite.
import type { Pool } from "pg";
import { runMigrations } from "../src/database/migrate.js";

export async function bindMigrationFunctionsToIsolatedTestSchema(pool: Pool): Promise<void> {
  await pool.query(`
    DO $dart_test_schema$
    DECLARE
      fn record;
      isolated_schema text := current_schema();
    BEGIN
      IF isolated_schema IS NULL OR isolated_schema = 'public' THEN
        RAISE EXCEPTION 'Isolated integration-test schema is required';
      END IF;

      FOR fn IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = isolated_schema
      LOOP
        EXECUTE format(
          'ALTER FUNCTION %s SET search_path = %I, pg_catalog, public, pg_temp',
          fn.signature,
          isolated_schema
        );
      END LOOP;
    END
    $dart_test_schema$;
  `);
}

// Validate SQL-language functions against the test schema at CREATE time too.
// Production files and recorded checksums stay intact; body validation remains on.
export async function runIsolatedMigrations(pool: Pool, directory: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ schema: string }>("SELECT current_schema() AS schema");
    const schema = result.rows[0]?.schema;
    if (!schema || schema === "public" || !/^dart_[a-z0-9_]+$/.test(schema)) throw new Error("Isolated integration-test schema is required");
    const query = (sql: string, values?: unknown[]) => client.query(
      sql.replace(/\bSET\s+search_path\s*=\s*public\s*,\s*pg_temp\b/gi, `SET search_path = "${schema}", pg_catalog, public, pg_temp`), values,
    );
    const migrationPool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    const applied = await runMigrations(migrationPool, directory);
    await bindMigrationFunctionsToIsolatedTestSchema(migrationPool);
    return applied;
  } finally { client.release(); }
}
