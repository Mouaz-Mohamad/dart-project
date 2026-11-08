-- DART CODE GUIDE | backend/migrations/0079_discount_codes.sql
-- خصومات الأكواد مستقلة عن الحملات، وتُسجّل مرة لكل أوردر حتى لو رُجعت القطع بعد التسليم.
CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Active','Paused','Expired')),
  kind TEXT NOT NULL CHECK (kind IN ('percent','amount')),
  percent NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor BETWEEN 0 AND 1000000000),
  max_discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (max_discount_minor BETWEEN 0 AND 1000000000),
  min_order_minor BIGINT NOT NULL DEFAULT 0 CHECK (min_order_minor BETWEEN 0 AND 1000000000),
  starts_on DATE,
  ends_on DATE,
  total_usage_limit INTEGER NOT NULL DEFAULT 0 CHECK (total_usage_limit BETWEEN 0 AND 10000000),
  per_customer_usage_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_usage_limit BETWEEN 0 AND 100000),
  customer_user_id UUID REFERENCES customers(user_id) ON DELETE RESTRICT,
  product_scope JSONB NOT NULL DEFAULT '{"mode":"all","values":[]}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  CONSTRAINT discount_code_date_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT discount_code_value_check CHECK (
    (kind='percent' AND percent > 0) OR (kind='amount' AND amount_minor > 0)
  ),
  CONSTRAINT discount_code_format_check CHECK (code ~ '^[A-Z0-9_-]{2,60}$'),
  CONSTRAINT discount_code_scope_check CHECK (jsonb_typeof(product_scope)='object')
);
CREATE INDEX IF NOT EXISTS discount_codes_status_idx ON discount_codes(status);

CREATE TABLE IF NOT EXISTS discount_code_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id UUID NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('Reserved','Used','Released')),
  discount_minor BIGINT NOT NULL CHECK (discount_minor > 0),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discount_code_usages_limits_idx
  ON discount_code_usages(discount_code_id,status,customer_user_id);

-- Keep original item/set/campaign/manual/birthday/Dart Card sources intact.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_discount_source_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_discount_source_check
  CHECK (discount_source IN ('None','Model','Set','Campaign','Manual','Discount Code','Birthday','Dart Card'));

CREATE OR REPLACE FUNCTION dart_sync_discount_code_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status='Delivered' THEN
    UPDATE discount_code_usages
       SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  ELSIF NEW.status IN ('Cancelled','Refused') THEN
    -- Only pending reservations are released. A delivered code is permanently used.
    UPDATE discount_code_usages
       SET status='Released',released_at=now(),updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS orders_sync_discount_code_order_status ON orders;
CREATE TRIGGER orders_sync_discount_code_order_status
  AFTER UPDATE OF status ON orders FOR EACH ROW
  EXECUTE FUNCTION dart_sync_discount_code_order_status();
