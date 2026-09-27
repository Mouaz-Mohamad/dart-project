-- DART CODE GUIDE | backend/migrations/0052_migration_history_security.sql
-- الغرض: حماية سجل migrations المحلي بعد تسويته مع سجل Supabase التشغيلي.

ALTER TABLE dart_schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE dart_schema_migrations FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE dart_schema_migrations FROM authenticated';
  END IF;
END
$$;
