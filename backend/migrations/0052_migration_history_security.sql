-- DART CODE GUIDE | backend/migrations/0052_migration_history_security.sql
-- الغرض: حماية سجل migrations المحلي بعد تسويته مع سجل Supabase التشغيلي.

ALTER TABLE dart_schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE dart_schema_migrations FROM anon, authenticated;
