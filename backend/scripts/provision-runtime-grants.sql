-- Dedicated API role; never grant it to browsers or Data API users.
-- API authorization remains authoritative for individual customers and staff.
DO $$
DECLARE target RECORD; schema_name TEXT := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dart_app_runtime'
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole) THEN
    RAISE EXCEPTION 'A non-administrative dart_app_runtime role is required';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO dart_app_runtime',schema_name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA %I TO dart_app_runtime',schema_name);
  EXECUTE format('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA %I TO dart_app_runtime',schema_name);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO dart_app_runtime',schema_name);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON %I.dart_schema_migrations FROM dart_app_runtime',schema_name);
  EXECUTE format('REVOKE UPDATE,DELETE ON %I.audit_logs FROM dart_app_runtime',schema_name);
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname=schema_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=schema_name AND tablename=target.tablename
      AND policyname='dart_api_runtime') THEN
      EXECUTE format('CREATE POLICY dart_api_runtime ON %I.%I TO dart_app_runtime USING(true) WITH CHECK(true)',schema_name,target.tablename);
    END IF;
  END LOOP;
END $$;
