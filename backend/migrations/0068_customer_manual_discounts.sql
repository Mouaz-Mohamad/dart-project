-- One customer grant belongs permanently to one order, including after refunds.
CREATE TABLE customer_manual_discounts (
  id UUID PRIMARY KEY,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('percent','amount')),
  value INTEGER NOT NULL CHECK (value > 0 AND value <= 1000000000),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL CHECK (ends_on >= starts_on),
  piece_limit INTEGER NOT NULL CHECK (piece_limit BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Used','Cancelled')),
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  used_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES staff_users(user_id),
  updated_by UUID NOT NULL REFERENCES staff_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 10000),
  CHECK ((status='Used' AND order_id IS NOT NULL AND used_at IS NOT NULL)
      OR (status <> 'Used' AND order_id IS NULL AND used_at IS NULL))
);
CREATE INDEX customer_manual_discount_lookup_idx ON customer_manual_discounts(customer_user_id,starts_on,ends_on)
  WHERE status='Active';
CREATE INDEX customer_manual_discount_history_idx ON customer_manual_discounts(customer_user_id,created_at DESC,id DESC);
ALTER TABLE customer_manual_discounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_manual_discounts FROM PUBLIC;
DO $$ DECLARE target_role TEXT; BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON customer_manual_discounts FROM %I',target_role);
    END IF;
  END LOOP;
END $$;

ALTER TABLE order_items DROP CONSTRAINT order_items_discount_source_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_discount_source_check
  CHECK (discount_source IN ('None','Model','Set','Campaign','Manual','Birthday','Dart Card'));

CREATE FUNCTION dart_protect_manual_discount() RETURNS TRIGGER LANGUAGE plpgsql
  SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.status='Used' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MANUAL_DISCOUNT_ALREADY_USED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_manual_discount_used_immutable BEFORE UPDATE OR DELETE ON customer_manual_discounts
  FOR EACH ROW EXECUTE FUNCTION dart_protect_manual_discount();
REVOKE ALL ON FUNCTION dart_protect_manual_discount() FROM PUBLIC;
