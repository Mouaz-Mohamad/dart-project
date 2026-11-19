-- DART CODE GUIDE | backend/migrations/0099_admin_status_customer_events.sql
-- الغرض: أحداث ذرية للعملاء الجدد وتغير حالة الطلب، مرة واحدة لكل تغير فعلي فقط.
-- Production: apply after the API accepting the new event types is Ready.
SET LOCAL lock_timeout = '3s';
CREATE FUNCTION dart_admin_order_status_notification() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO admin_notifications(event_type,entity_id,entity_code,metadata)
  VALUES('ORDER_STATUS_CHANGED',gen_random_uuid()::text,NEW.order_code,
    jsonb_build_object('targetId',NEW.id::text,'fromStatus',OLD.status,'toStatus',NEW.status));
  RETURN NEW;
END $$;
CREATE TRIGGER dart_admin_order_status_changed AFTER UPDATE OF status ON orders
FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION dart_admin_order_status_notification();

CREATE FUNCTION dart_admin_customer_created_notification() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO admin_notifications(event_type,entity_id,entity_code)
  VALUES('CUSTOMER_CREATED',NEW.user_id::text,COALESCE(NEW.client_code,''))
  ON CONFLICT(event_type,entity_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER dart_admin_customer_created AFTER INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION dart_admin_customer_created_notification();
REVOKE ALL ON FUNCTION dart_admin_order_status_notification(),dart_admin_customer_created_notification() FROM PUBLIC;
