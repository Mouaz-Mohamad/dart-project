-- Complete Data API isolation for tables added after migration 0049.
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_code_usages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discount_codes, discount_code_usages FROM PUBLIC;
DO $$
DECLARE target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON discount_codes, discount_code_usages FROM %I',target_role);
    END IF;
  END LOOP;
  -- A previously provisioned API role must remain able to serve checkout.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dart_app_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON discount_codes,discount_code_usages TO dart_app_runtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='discount_codes' AND policyname='dart_discount_runtime') THEN
    CREATE POLICY dart_discount_runtime ON discount_codes TO PUBLIC
      USING (current_user='dart_app_runtime') WITH CHECK (current_user='dart_app_runtime');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='discount_code_usages' AND policyname='dart_discount_runtime') THEN
    CREATE POLICY dart_discount_runtime ON discount_code_usages TO PUBLIC
      USING (current_user='dart_app_runtime') WITH CHECK (current_user='dart_app_runtime');
  END IF;
END $$;
