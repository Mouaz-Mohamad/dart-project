-- DART CODE GUIDE | backend/migrations/0095_finance_income.sql
-- الغرض: وارد مستقل مع تحصيل طلبات الهدايا، أموال صحيحة بالقروش وسجل تدقيق دائم.
CREATE TABLE finance_income_entries (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('Other Income','Capital','Loan','Order Collection')),
  category text NOT NULL DEFAULT 'Other',
  description text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000000),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency='EGP'),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Received','Void')),
  expected_on date NOT NULL,
  received_on date,
  source_name text NOT NULL DEFAULT '',
  source_phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  request_hash text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='Order Collection') = (order_id IS NOT NULL)),
  CHECK ((status='Received') = (received_on IS NOT NULL))
);
CREATE INDEX finance_income_received_date ON finance_income_entries(received_on) WHERE status='Received';
CREATE INDEX finance_income_expected_date ON finance_income_entries(expected_on) WHERE status='Pending';
ALTER TABLE finance_income_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY dart_income_runtime ON finance_income_entries TO PUBLIC
  USING (current_user='dart_app_runtime') WITH CHECK (current_user='dart_app_runtime');
REVOKE ALL ON finance_income_entries FROM PUBLIC;

INSERT INTO permissions(key,description) VALUES ('finance.manage_incomes','Create, edit pending income and confirm receipt') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
  SELECT r.id,p.id FROM roles r JOIN permissions p ON p.key='finance.manage_incomes'
  WHERE r.name='Owner' ON CONFLICT DO NOTHING;

INSERT INTO domain_state_versions(domain,version) VALUES('finance_income',1) ON CONFLICT DO NOTHING;

CREATE FUNCTION dart_audit_income() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor text := nullif(current_setting('dart.finance_actor_id',true),'');
BEGIN
  INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,old_values,new_values)
    VALUES(CASE WHEN actor IS NULL THEN 'system' ELSE 'staff' END,actor::uuid,
      'INCOME_' || CASE WHEN TG_OP='INSERT' THEN 'CREATED' WHEN NEW.status IS DISTINCT FROM OLD.status THEN upper(NEW.status) ELSE 'UPDATED' END,
      'finance_income',NEW.id,current_setting('dart.finance_request_id',true),
      CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='finance_income';
  RETURN NEW;
END $$;
CREATE TRIGGER finance_income_audit AFTER INSERT OR UPDATE ON finance_income_entries
  FOR EACH ROW EXECUTE FUNCTION dart_audit_income();

-- Order price remains a sale; only the recipient's collection amount is zero.
-- Keep the pending receivable synchronized even when another order command runs.
CREATE FUNCTION dart_sync_order_income() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.legacy->>'collectionMode' IS DISTINCT FROM 'Third Party' THEN RETURN NEW; END IF;
  IF NEW.status IN ('Cancelled','Refused','Returned') OR NEW.is_deleted OR NEW.is_archived THEN
    UPDATE finance_income_entries SET status='Void',version=version+1,updated_at=now()
      WHERE order_id=NEW.id AND status='Pending';
  ELSIF NEW.final_minor <= 0 THEN
    RAISE EXCEPTION 'A gift payer requires a positive order value' USING ERRCODE='23514';
  ELSE
    INSERT INTO finance_income_entries(id,kind,category,description,amount_minor,expected_on,source_name,source_phone,order_id)
      VALUES('gift-' || NEW.id,'Order Collection','Gift order','Payment for ' || NEW.order_code,NEW.final_minor,
        (now() AT TIME ZONE 'Africa/Cairo')::date,COALESCE(NEW.legacy->>'payerName',''),COALESCE(NEW.legacy->>'payerPhone',''),NEW.id)
      ON CONFLICT(order_id) DO UPDATE SET status='Pending',amount_minor=EXCLUDED.amount_minor,
        source_name=EXCLUDED.source_name,source_phone=EXCLUDED.source_phone,version=finance_income_entries.version+1,updated_at=now()
        WHERE finance_income_entries.status='Void' OR (finance_income_entries.status='Pending' AND
          (finance_income_entries.amount_minor,finance_income_entries.source_name,finance_income_entries.source_phone)
          IS DISTINCT FROM (EXCLUDED.amount_minor,EXCLUDED.source_name,EXCLUDED.source_phone));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_third_party_income AFTER INSERT OR UPDATE OF final_minor,status,legacy,is_deleted,is_archived ON orders
  FOR EACH ROW EXECUTE FUNCTION dart_sync_order_income();
REVOKE ALL ON FUNCTION dart_audit_income(),dart_sync_order_income() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dart_app_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON finance_income_entries TO dart_app_runtime;
    GRANT EXECUTE ON FUNCTION dart_audit_income(),dart_sync_order_income() TO dart_app_runtime;
  END IF;
END $$;
