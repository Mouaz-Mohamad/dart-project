-- DART CODE GUIDE | backend/migrations/0058_sets_data_api_rls.sql
-- الغرض: تطبيق عزل بيانات أطقم Dart على الجداول التي أضيفت بعد قفل Data API.
-- The backend connects as table owner; do not FORCE RLS or grant client roles here.

DO $$
DECLARE
  table_name TEXT;
  target_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'catalog_sets', 'catalog_set_components', 'set_discount_settings',
    'cart_set_groups', 'cart_set_components',
    'order_set_groups', 'order_set_components', 'set_waiting_entries',
    'set_loyalty_usage', 'set_loyalty_returned_items', 'set_loyalty_cart_reservations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, target_role);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
