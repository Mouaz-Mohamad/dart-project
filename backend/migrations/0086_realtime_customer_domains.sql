-- DART | Live domain invalidations for relational customer and staff changes.
-- Signals contain only a domain and monotonic version, never identity data.
INSERT INTO domain_state_versions(domain,version) VALUES ('news',1),('staff',1)
ON CONFLICT(domain) DO NOTHING;

CREATE FUNCTION dart_realtime_touch_dashboard_domain() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  -- Dashboard JSON-adapter writes can invoke the identity upsert inside their
  -- own BEFORE trigger. Do not mutate the locked dashboard tuple recursively.
  IF pg_trigger_depth() = 1 AND (TG_OP <> 'UPDATE' OR NEW IS DISTINCT FROM OLD) THEN
    UPDATE dashboard_domain_state SET version=version+1, updated_at=now()
     WHERE domain=TG_ARGV[0];
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION dart_realtime_touch_account_phone() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE account_kind TEXT;
BEGIN
  IF pg_trigger_depth()=1 AND (TG_OP <> 'UPDATE' OR NEW IS DISTINCT FROM OLD) THEN
    IF TG_OP='DELETE' THEN account_kind := OLD.account_type;
    ELSE account_kind := NEW.account_type; END IF;
    IF account_kind IN ('customer','representative') THEN
      UPDATE dashboard_domain_state SET version=version+1,updated_at=now()
       WHERE domain=CASE WHEN account_kind='customer' THEN 'customers' ELSE 'representatives' END;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION dart_realtime_touch_identity_user() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF pg_trigger_depth()=1 AND
     (OLD.email IS DISTINCT FROM NEW.email OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
    IF NEW.account_type='customer' THEN
      UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='customers';
    ELSIF NEW.account_type='representative' THEN
      UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='representatives';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION dart_realtime_touch_order_customer() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  -- The existing orders trigger captures contact numbers and address history.
  IF pg_trigger_depth()=1 AND NEW.customer_user_id IS NOT NULL THEN
    IF TG_OP='INSERT' THEN
      UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='customers';
    ELSIF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
      OR NEW.contact_snapshot IS DISTINCT FROM OLD.contact_snapshot
      OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address THEN
      UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='customers';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION dart_realtime_touch_version_domain() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF pg_trigger_depth()=1 AND (TG_OP <> 'UPDATE' OR NEW IS DISTINCT FROM OLD) THEN
    UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain=TG_ARGV[0];
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER dart_live_customers AFTER INSERT OR UPDATE OR DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_customer_profile_details AFTER INSERT OR UPDATE OR DELETE ON customer_profile_details
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_customer_contact_phones AFTER INSERT OR UPDATE OR DELETE ON customer_contact_phones
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_customer_address_history AFTER INSERT OR UPDATE OR DELETE ON customer_address_history
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_customer_identity_aliases AFTER INSERT OR UPDATE OR DELETE ON customer_identity_aliases
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_customer_preferences AFTER INSERT OR UPDATE OR DELETE ON customer_preferences
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('customers');
CREATE TRIGGER dart_live_account_phones AFTER INSERT OR UPDATE OR DELETE ON account_phones
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_account_phone();
CREATE TRIGGER dart_live_identity_user AFTER UPDATE OF email,status,deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_identity_user();
CREATE TRIGGER dart_live_orders_customer AFTER INSERT OR UPDATE OF customer_user_id,contact_snapshot,delivery_address ON orders
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_order_customer();
CREATE TRIGGER dart_live_representatives AFTER INSERT OR UPDATE OR DELETE ON representatives
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_dashboard_domain('representatives');
CREATE TRIGGER dart_live_news AFTER INSERT OR UPDATE OR DELETE ON news_articles
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_version_domain('news');
CREATE TRIGGER dart_live_staff_users AFTER INSERT OR DELETE ON staff_users
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_version_domain('staff');
CREATE TRIGGER dart_live_staff_invitations AFTER INSERT OR UPDATE OR DELETE ON staff_invitations
FOR EACH ROW EXECUTE FUNCTION dart_realtime_touch_version_domain('staff');

REVOKE ALL ON FUNCTION dart_realtime_touch_dashboard_domain(),
 dart_realtime_touch_account_phone(),dart_realtime_touch_identity_user(),
 dart_realtime_touch_order_customer(),dart_realtime_touch_version_domain() FROM PUBLIC;
