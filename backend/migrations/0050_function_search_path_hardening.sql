-- DART CODE GUIDE | backend/migrations/0050_function_search_path_hardening.sql
-- الغرض: تثبيت مسار بحث دوال التطبيق لمنع تبديل الكائنات عبر search_path قابل للتغيير.

DO $$
DECLARE
  function_row RECORD;
BEGIN
  FOR function_row IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = pg_catalog, public',
      function_row.schema_name,
      function_row.function_name,
      function_row.identity_arguments
    );
  END LOOP;
END
$$;
