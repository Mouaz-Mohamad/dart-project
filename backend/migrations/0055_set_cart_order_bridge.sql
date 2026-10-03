-- DART CODE GUIDE | backend/migrations/0055_set_cart_order_bridge.sql
-- الغرض: ربط Set snapshot بحجز السلة والأوردر من غير تعديل دورة حياة inventory_items أو اختراع مخزون موازٍ.

ALTER TABLE cart_set_groups
  ADD COLUMN discount_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN benefit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(benefit_metadata)='object');

ALTER TABLE cart_set_components
  ADD COLUMN original_model_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (original_model_discount_percent BETWEEN 0 AND 100);

ALTER TABLE order_set_groups
  ADD COLUMN unit_index INTEGER NOT NULL DEFAULT 1 CHECK (unit_index BETWEEN 1 AND 20),
  ADD COLUMN cart_group_id UUID UNIQUE REFERENCES cart_set_groups(id) ON DELETE SET NULL,
  ADD COLUMN discount_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN benefit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(benefit_metadata)='object');

ALTER TABLE order_set_groups
  ADD CONSTRAINT order_set_groups_order_set_unit_unique UNIQUE(order_id,set_id,unit_index);

ALTER TABLE order_set_components
  ADD COLUMN original_model_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (original_model_discount_percent BETWEEN 0 AND 100);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_discount_source_check;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_discount_source_check
  CHECK (discount_source IN ('None','Model','Set','Campaign','Birthday','Dart Card'));

-- Relational ledger for Set-only Dart Card usage. The existing card aggregate stays compatible;
-- this ledger is the durable source for per-Set piece consumption and return restoration.
CREATE TABLE set_loyalty_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_set_group_id UUID NOT NULL UNIQUE REFERENCES order_set_groups(id) ON DELETE RESTRICT,
  card_code TEXT NOT NULL,
  piece_count INTEGER NOT NULL CHECK (piece_count > 0),
  returned_piece_count INTEGER NOT NULL DEFAULT 0 CHECK (returned_piece_count >= 0),
  status TEXT NOT NULL DEFAULT 'Reserved' CHECK (status IN ('Reserved','Used','Released')),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (returned_piece_count <= piece_count)
);
CREATE INDEX set_loyalty_usage_card_status_idx ON set_loyalty_usage(card_code,status);

CREATE TABLE set_loyalty_returned_items (
  order_item_id UUID PRIMARY KEY REFERENCES order_items(id) ON DELETE RESTRICT,
  usage_id UUID NOT NULL REFERENCES set_loyalty_usage(id) ON DELETE RESTRICT,
  return_record_id TEXT,
  returned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A physical item belonging to a Set gets the Set allocation before order_items is persisted.
-- Its standalone Model discount and every Campaign discount are intentionally ignored.
CREATE OR REPLACE FUNCTION dart_apply_set_order_item_pricing()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  bridge RECORD;
BEGIN
  SELECT csc.allocated_base_minor,
         csc.allocated_final_minor,
         csg.discount_source,
         csg.discount_percent,
         csg.discount_reference,
         csg.set_id
    INTO bridge
    FROM cart_set_components csc
    JOIN cart_set_groups csg ON csg.id=csc.group_id
   WHERE csc.inventory_item_id=NEW.inventory_item_id
   LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.original_unit_minor := bridge.allocated_base_minor;
  NEW.model_discount_percent := 0;
  NEW.final_unit_minor := bridge.allocated_final_minor;
  NEW.discount_source := bridge.discount_source;
  NEW.discount_percent := bridge.discount_percent;
  NEW.discount_minor := GREATEST(0,bridge.allocated_base_minor-bridge.allocated_final_minor);
  NEW.discount_reference := CASE
    WHEN bridge.discount_source='Set' THEN bridge.set_id
    ELSE NULLIF(bridge.discount_reference,'')
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_items_set_pricing_guard ON order_items;
CREATE TRIGGER order_items_set_pricing_guard
BEFORE INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION dart_apply_set_order_item_pricing();

-- Copy immutable cart Set data into the order and map the exact physical order item.
CREATE OR REPLACE FUNCTION dart_capture_order_set_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  source_component RECORD;
  target_group_id UUID;
  was_inserted BOOLEAN := false;
BEGIN
  SELECT csc.*,
         csg.set_id,csg.set_version,csg.unit_index,csg.set_name_snapshot,csg.set_image_snapshot,
         csg.components_total_minor,csg.set_base_price_minor,csg.discount_source,
         csg.discount_percent,csg.discount_reference,csg.final_minor,csg.piece_count,
         csg.benefit_metadata
    INTO source_component
    FROM cart_set_components csc
    JOIN cart_set_groups csg ON csg.id=csc.group_id
   WHERE csc.inventory_item_id=NEW.inventory_item_id
   LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO order_set_groups(
    order_id,set_id,set_name_snapshot,set_image_snapshot,set_version_snapshot,
    unit_index,cart_group_id,components_total_minor,set_base_price_minor,
    discount_source,discount_percent,discount_reference,benefit_metadata,final_minor,piece_count
  ) VALUES (
    NEW.order_id,source_component.set_id,source_component.set_name_snapshot,
    source_component.set_image_snapshot,source_component.set_version,
    source_component.unit_index,source_component.group_id,source_component.components_total_minor,
    source_component.set_base_price_minor,source_component.discount_source,
    source_component.discount_percent,source_component.discount_reference,
    source_component.benefit_metadata,source_component.final_minor,source_component.piece_count
  )
  ON CONFLICT (order_id,set_id,unit_index) DO NOTHING
  RETURNING id INTO target_group_id;

  was_inserted := target_group_id IS NOT NULL;
  IF target_group_id IS NULL THEN
    SELECT id INTO target_group_id
      FROM order_set_groups
     WHERE order_id=NEW.order_id
       AND set_id=source_component.set_id
       AND unit_index=source_component.unit_index;
  END IF;

  INSERT INTO order_set_components(
    group_id,order_item_id,model_id,component_unit_index,
    original_model_selling_minor,original_model_discount_percent,
    allocated_base_minor,allocated_final_minor
  ) VALUES (
    target_group_id,NEW.id,source_component.model_id,source_component.component_unit_index,
    source_component.original_model_selling_minor,source_component.original_model_discount_percent,
    source_component.allocated_base_minor,source_component.allocated_final_minor
  ) ON CONFLICT (order_item_id) DO NOTHING;

  IF was_inserted THEN
    INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
    VALUES (
      'system','SET_ORDER_SNAPSHOT_CAPTURED','orders',NEW.order_id::text,
      jsonb_build_object(
        'setId',source_component.set_id,
        'setGroupId',target_group_id,
        'pieceCount',source_component.piece_count,
        'discountSource',source_component.discount_source,
        'discountPercent',source_component.discount_percent
      )
    );
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_items_set_snapshot_capture ON order_items;
CREATE TRIGGER order_items_set_snapshot_capture
AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION dart_capture_order_set_snapshot();

-- Reconcile only orders that contain at least one Set, at transaction end after every order item exists.
-- This also prevents a Campaign from being consumed when every potentially eligible cart line was a Set.
CREATE OR REPLACE FUNCTION dart_reconcile_set_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  campaign_count INTEGER;
  campaign_discount BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_set_groups WHERE order_id=NEW.order_id) THEN
    RETURN NEW;
  END IF;

  UPDATE orders o
     SET subtotal_minor=totals.subtotal_minor,
         order_discount_minor=totals.discount_minor,
         final_minor=totals.final_minor,
         updated_at=now()
    FROM (
      SELECT order_id,
             COALESCE(sum(original_unit_minor),0)::bigint AS subtotal_minor,
             COALESCE(sum(discount_minor),0)::bigint AS discount_minor,
             COALESCE(sum(final_unit_minor),0)::bigint AS final_minor
        FROM order_items
       WHERE order_id=NEW.order_id
       GROUP BY order_id
    ) totals
   WHERE o.id=totals.order_id;

  SELECT count(*)::integer,COALESCE(sum(discount_minor),0)::bigint
    INTO campaign_count,campaign_discount
    FROM order_items
   WHERE order_id=NEW.order_id AND discount_source='Campaign';

  IF campaign_count = 0 THEN
    DELETE FROM promotion_usages WHERE order_id=NEW.order_id;
    UPDATE orders
       SET promotion=NULL,updated_at=now()
     WHERE id=NEW.order_id
       AND COALESCE(promotion->>'type','')='Promotion';
  ELSE
    UPDATE promotion_usages
       SET discount_minor=campaign_discount,updated_at=now()
     WHERE order_id=NEW.order_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_items_set_order_reconcile ON order_items;
CREATE CONSTRAINT TRIGGER order_items_set_order_reconcile
AFTER INSERT ON order_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION dart_reconcile_set_order_totals();

-- Birthday used by a Set is reserved even if ordinary pieces in the same order use a Campaign.
CREATE OR REPLACE FUNCTION dart_reserve_set_birthday_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  target_customer_id UUID;
  target_reward_year INTEGER;
  target_reward_record TEXT;
  existing_status TEXT;
  existing_order_id UUID;
BEGIN
  IF NEW.discount_source <> 'Birthday' THEN RETURN NEW; END IF;
  SELECT customer_user_id INTO target_customer_id FROM orders WHERE id=NEW.order_id FOR SHARE;
  IF target_customer_id IS NULL THEN RETURN NEW; END IF;
  target_reward_year := COALESCE(
    NULLIF(NEW.benefit_metadata->>'rewardYear','')::integer,
    dart_cairo_year(now())
  );
  target_reward_record := COALESCE(
    NULLIF(NEW.discount_reference,''),
    NULLIF(NEW.benefit_metadata->>'rewardId','')
  );

  INSERT INTO birthday_discount_usage(
    customer_user_id,reward_year,reward_record_id,order_id,status,reserved_at
  ) VALUES (
    target_customer_id,target_reward_year,target_reward_record,NEW.order_id,'Reserved',now()
  ) ON CONFLICT (customer_user_id,reward_year) DO NOTHING;

  IF NOT FOUND THEN
    SELECT status,order_id INTO existing_status,existing_order_id
      FROM birthday_discount_usage
     WHERE customer_user_id=target_customer_id
       AND reward_year=target_reward_year
     FOR UPDATE;
    IF existing_order_id IS DISTINCT FROM NEW.order_id
       AND existing_status IN ('Reserved','Used') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BIRTHDAY_DISCOUNT_ALREADY_USED_OR_RESERVED';
    END IF;
    UPDATE birthday_discount_usage
       SET order_id=NEW.order_id,status='Reserved',reserved_at=now(),released_at=NULL,updated_at=now()
     WHERE customer_user_id=target_customer_id
       AND reward_year=target_reward_year;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_set_groups_birthday_reservation ON order_set_groups;
CREATE TRIGGER order_set_groups_birthday_reservation
AFTER INSERT ON order_set_groups
FOR EACH ROW EXECUTE FUNCTION dart_reserve_set_birthday_usage();

-- Set Dart Card usage ledger. Card aggregate synchronization and returned-slot restoration
-- are handled by the Set loyalty bridge added with the return/status integration.
CREATE OR REPLACE FUNCTION dart_create_set_loyalty_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NEW.discount_source <> 'Dart Card' OR COALESCE(NEW.discount_reference,'')='' THEN RETURN NEW; END IF;
  INSERT INTO set_loyalty_usage(order_id,order_set_group_id,card_code,piece_count,status)
  VALUES (NEW.order_id,NEW.id,NEW.discount_reference,NEW.piece_count,'Reserved')
  ON CONFLICT(order_set_group_id) DO NOTHING;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_set_groups_loyalty_usage ON order_set_groups;
CREATE TRIGGER order_set_groups_loyalty_usage
AFTER INSERT ON order_set_groups
FOR EACH ROW EXECUTE FUNCTION dart_create_set_loyalty_usage();
