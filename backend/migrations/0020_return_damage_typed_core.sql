-- Typed relational core for Returns / Exchanges / Damage.
-- Payload remains temporarily for backwards-compatible UI fields while authoritative
-- identifiers, money, address and lifecycle fields become queryable typed columns.

ALTER TABLE return_requests
  ADD COLUMN customer_user_id UUID REFERENCES customers(user_id) ON DELETE SET NULL,
  ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN model_id TEXT,
  ADD COLUMN reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN exchange_chain_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN replacement_item_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN requested_color TEXT NOT NULL DEFAULT '',
  ADD COLUMN requested_size TEXT NOT NULL DEFAULT '',
  ADD COLUMN original_net_minor BIGINT NOT NULL DEFAULT 0 CHECK (original_net_minor >= 0),
  ADD COLUMN refund_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (refund_amount_minor >= 0),
  ADD COLUMN exchange_value_minor BIGINT NOT NULL DEFAULT 0 CHECK (exchange_value_minor >= 0),
  ADD COLUMN customer_courier_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (customer_courier_fee_minor >= 0),
  ADD COLUMN brand_courier_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (brand_courier_fee_minor >= 0),
  ADD COLUMN courier_fee_payer TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_country TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_governorate TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_area TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_street TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_building TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_floor TEXT NOT NULL DEFAULT '',
  ADD COLUMN pickup_latitude DOUBLE PRECISION,
  ADD COLUMN pickup_longitude DOUBLE PRECISION,
  ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE return_requests
  ADD CONSTRAINT return_requests_request_type_typed_check
    CHECK (request_type IN ('', 'Refund', 'Exchange')) NOT VALID,
  ADD CONSTRAINT return_requests_governorate_typed_check
    CHECK (pickup_governorate IN ('', 'Cairo', 'Giza')) NOT VALID,
  ADD CONSTRAINT return_requests_courier_payer_typed_check
    CHECK (courier_fee_payer IN ('', 'Customer', 'Brand', 'None')) NOT VALID;

CREATE INDEX return_requests_customer_user_idx ON return_requests(customer_user_id);
CREATE INDEX return_requests_order_id_idx ON return_requests(order_id);
CREATE INDEX return_requests_inventory_item_idx ON return_requests(inventory_item_id);
CREATE INDEX return_requests_exchange_chain_idx ON return_requests(exchange_chain_id)
  WHERE exchange_chain_id <> '';

ALTER TABLE damage_records
  ADD COLUMN inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN model_id TEXT,
  ADD COLUMN damage_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN client_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN request_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN inspected_at_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE damage_records
  ADD CONSTRAINT damage_records_request_type_typed_check
    CHECK (request_type IN ('', 'Refund', 'Exchange')) NOT VALID;

CREATE INDEX damage_records_inventory_item_idx ON damage_records(inventory_item_id);
CREATE INDEX damage_records_damage_code_idx ON damage_records(damage_code)
  WHERE damage_code <> '';

CREATE OR REPLACE FUNCTION dart_json_money_minor(value TEXT)
RETURNS BIGINT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(value,'') ~ '^[0-9]+([.][0-9]+)?$'
      THEN GREATEST(0, round(value::numeric * 100)::bigint)
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION dart_json_float(value TEXT)
RETURNS DOUBLE PRECISION LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(value,'') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN value::double precision
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION dart_sync_return_typed_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  customer_code_value TEXT := COALESCE(NEW.payload->>'clientId', NEW.payload->>'customerId', '');
  order_code_value TEXT := COALESCE(NEW.payload->>'orderId', '');
  item_code_value TEXT := COALESCE(NEW.payload->>'itemCode', '');
BEGIN
  SELECT c.user_id INTO NEW.customer_user_id
    FROM customers c WHERE c.client_code=customer_code_value LIMIT 1;
  SELECT o.id INTO NEW.order_id
    FROM orders o WHERE o.order_code=order_code_value LIMIT 1;
  SELECT i.id INTO NEW.inventory_item_id
    FROM inventory_items i WHERE i.item_code=item_code_value LIMIT 1;

  NEW.model_id := COALESCE(NEW.payload->>'modelId', NEW.payload->>'modelCode', '');
  NEW.reason := COALESCE(NEW.payload->>'reason', '');
  NEW.notes := COALESCE(NEW.payload->>'notes', '');
  NEW.exchange_chain_id := COALESCE(NEW.payload->>'exchangeChainId', '');
  NEW.replacement_item_code := COALESCE(NEW.payload->>'replacementItemCode', '');
  NEW.requested_color := COALESCE(NEW.payload->>'requestedColor', '');
  NEW.requested_size := COALESCE(NEW.payload->>'requestedSize', '');
  NEW.original_net_minor := dart_json_money_minor(NEW.payload->>'originalNetAmount');
  NEW.refund_amount_minor := dart_json_money_minor(NEW.payload->>'refundAmount');
  NEW.exchange_value_minor := dart_json_money_minor(NEW.payload->>'exchangeValue');
  NEW.customer_courier_fee_minor := dart_json_money_minor(NEW.payload->>'customerCourierFee');
  NEW.brand_courier_fee_minor := dart_json_money_minor(NEW.payload->>'brandCourierFee');
  NEW.courier_fee_payer := COALESCE(NEW.payload->>'courierFeePayer', '');
  NEW.pickup_country := COALESCE(NEW.payload->>'country', '');
  NEW.pickup_governorate := COALESCE(NEW.payload->>'governorate', '');
  NEW.pickup_area := COALESCE(NEW.payload->>'area', '');
  NEW.pickup_street := COALESCE(NEW.payload->>'street', '');
  NEW.pickup_building := COALESCE(NEW.payload->>'building', '');
  NEW.pickup_floor := COALESCE(NEW.payload->>'floor', '');
  NEW.pickup_latitude := dart_json_float(NEW.payload->>'latitude');
  NEW.pickup_longitude := dart_json_float(NEW.payload->>'longitude');
  NEW.is_archived := COALESCE((NEW.payload->>'isArchived')::boolean, false);
  NEW.is_deleted := COALESCE((NEW.payload->>'isDeleted')::boolean, false);
  RETURN NEW;
END
$$;

CREATE TRIGGER return_requests_typed_sync
BEFORE INSERT OR UPDATE OF payload ON return_requests
FOR EACH ROW EXECUTE FUNCTION dart_sync_return_typed_fields();

CREATE OR REPLACE FUNCTION dart_sync_damage_typed_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  item_code_value TEXT := COALESCE(NEW.payload->>'itemCode', '');
BEGIN
  SELECT i.id INTO NEW.inventory_item_id
    FROM inventory_items i WHERE i.item_code=item_code_value LIMIT 1;
  NEW.model_id := COALESCE(NEW.payload->>'modelId', NEW.payload->>'modelCode', '');
  NEW.damage_code := COALESCE(NEW.payload->>'damageId', '');
  NEW.reason := COALESCE(NEW.payload->>'reason', '');
  NEW.notes := COALESCE(NEW.payload->>'notes', '');
  NEW.client_code := COALESCE(NEW.payload->>'clientId', NEW.payload->>'customerId', '');
  NEW.request_type := COALESCE(NEW.payload->>'requestType', '');
  NEW.inspected_at_text := COALESCE(NEW.payload->>'inspectedAt', '');
  NEW.is_archived := COALESCE((NEW.payload->>'isArchived')::boolean, false);
  NEW.is_deleted := COALESCE((NEW.payload->>'isDeleted')::boolean, false);
  RETURN NEW;
END
$$;

CREATE TRIGGER damage_records_typed_sync
BEFORE INSERT OR UPDATE OF payload ON damage_records
FOR EACH ROW EXECUTE FUNCTION dart_sync_damage_typed_fields();

-- Backfill typed fields for rows already migrated by 0018/0019.
UPDATE return_requests SET payload=payload;
UPDATE damage_records SET payload=payload;
