// DART CODE GUIDE | backend/tests/integration-schema.ts
// الغرض: إبقاء دوال migrations المقيدة بـ public آمنة في الإنتاج مع ربطها فقط داخل اختبارات PostgreSQL بالـschema المعزول لكل Suite.
import type { Pool } from "pg";

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
