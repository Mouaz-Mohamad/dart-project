-- DART CODE GUIDE | backend/migrations/0034_rewards_promotions_draw_integrity.sql
-- الغرض: تثبيت Birthday مرة واحدة سنويا، Promotion usage limits، وDart Card monthly draw كحقائق خادمية في PostgreSQL.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS birthday_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_birthday_discount_used_at TIMESTAMPTZ;

ALTER TABLE promotion_records
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL;

DELETE FROM promotion_records older
USING promotion_records newer
WHERE older.code <> ''
  AND older.code = newer.code
  AND (older.position, older.record_id) < (newer.position, newer.record_id);
CREATE UNIQUE INDEX IF NOT EXISTS promotion_records_code_unique_idx
  ON promotion_records(code) WHERE code <> '';

CREATE TABLE IF NOT EXISTS birthday_discount_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  reward_year INTEGER NOT NULL CHECK (reward_year BETWEEN 2000 AND 2200),
  birthday_date DATE,
  reward_record_id TEXT,
  order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('Reserved','Used','Released')),
  reserved_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_user_id, reward_year)
);
CREATE UNIQUE INDEX IF NOT EXISTS birthday_discount_usage_order_idx
  ON birthday_discount_usage(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS birthday_discount_usage_customer_idx
  ON birthday_discount_usage(customer_user_id, reward_year DESC);

CREATE TABLE IF NOT EXISTS promotion_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_record_id TEXT NOT NULL REFERENCES promotion_records(record_id) ON DELETE RESTRICT,
  promotion_code TEXT NOT NULL,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('Reserved','Used','Released')),
  discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotion_usages_campaign_idx
  ON promotion_usages(promotion_record_id, status);
CREATE INDEX IF NOT EXISTS promotion_usages_customer_idx
  ON promotion_usages(customer_user_id, promotion_record_id, status);

CREATE TABLE IF NOT EXISTS dart_card_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key CHAR(7) NOT NULL UNIQUE CHECK (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  status TEXT NOT NULL CHECK (status IN ('Completed','No Eligible Customers')),
  winner_user_id UUID REFERENCES customers(user_id) ON DELETE RESTRICT,
  winner_client_code TEXT,
  winning_piece_count INTEGER NOT NULL DEFAULT 0 CHECK (winning_piece_count >= 0),
  winning_net_spend_minor BIGINT NOT NULL DEFAULT 0 CHECK (winning_net_spend_minor >= 0),
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  exact_tie_count INTEGER NOT NULL DEFAULT 0 CHECK (exact_tie_count >= 0),
  tie_break_method TEXT NOT NULL DEFAULT 'pieces_then_net_spend',
  card_record_id TEXT REFERENCES loyalty_cards(record_id) ON DELETE RESTRICT,
  selection_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selection_snapshot)='array'),
  executed_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dart_card_draws_executed_idx ON dart_card_draws(executed_at DESC);

CREATE TABLE IF NOT EXISTS dart_card_draw_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id UUID NOT NULL REFERENCES dart_card_draws(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system','staff')),
  actor_id UUID,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dart_card_draw_events_draw_idx ON dart_card_draw_events(draw_id, created_at);

INSERT INTO permissions(key, description) VALUES
  ('promotions.read', 'Read promotion campaigns and analytics'),
  ('promotions.manage', 'Create, edit, pause and end promotion campaigns'),
  ('dart_card_draws.read', 'Read Dart Card draw previews and history'),
  ('dart_card_draws.manage', 'Run the server-authoritative Dart Card monthly draw')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.key IN ('promotions.read','promotions.manage','dart_card_draws.read','dart_card_draws.manage')
WHERE r.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION dart_cairo_year(value TIMESTAMPTZ DEFAULT now())
RETURNS INTEGER LANGUAGE SQL STABLE AS $$
  SELECT EXTRACT(YEAR FROM value AT TIME ZONE 'Africa/Cairo')::integer
$$;

CREATE OR REPLACE FUNCTION dart_reward_year_from_order(value JSONB)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  reward_id TEXT := COALESCE(value->>'rewardId','');
  parsed_year INTEGER;
BEGIN
  IF reward_id ~ '[0-9]{4}$' THEN
    parsed_year := right(reward_id,4)::integer;
    IF parsed_year BETWEEN 2000 AND 2200 THEN RETURN parsed_year; END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION dart_reserve_order_rewards()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  promotion_type TEXT := COALESCE(NEW.promotion->>'type','');
  target_reward_year INTEGER;
  existing_status TEXT;
  existing_order UUID;
  customer_birthday DATE;
  reward_record TEXT;
  campaign promotion_records%ROWTYPE;
  total_limit INTEGER;
  customer_limit INTEGER;
  current_total INTEGER;
  current_customer INTEGER;
  starts_on DATE;
  ends_on DATE;
BEGIN
  IF NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;

  IF promotion_type='Birthday' THEN
    target_reward_year := COALESCE(dart_reward_year_from_order(NEW.promotion), dart_cairo_year(NEW.created_at));
    reward_record := NULLIF(NEW.promotion->>'rewardId','');
    SELECT birthday INTO customer_birthday FROM customers WHERE user_id=NEW.customer_user_id FOR SHARE;

    INSERT INTO birthday_discount_usage(
      customer_user_id,reward_year,birthday_date,reward_record_id,order_id,status,reserved_at
    ) VALUES (
      NEW.customer_user_id,target_reward_year,customer_birthday,reward_record,NEW.id,'Reserved',now()
    ) ON CONFLICT (customer_user_id,reward_year) DO NOTHING;

    IF NOT FOUND THEN
      SELECT bdu.status,bdu.order_id INTO existing_status,existing_order
        FROM birthday_discount_usage bdu
       WHERE bdu.customer_user_id=NEW.customer_user_id AND bdu.reward_year=target_reward_year
       FOR UPDATE;
      IF existing_status='Used' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='BIRTHDAY_DISCOUNT_ALREADY_USED_THIS_YEAR';
      END IF;
      IF existing_status='Reserved' AND existing_order IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='BIRTHDAY_DISCOUNT_ALREADY_RESERVED';
      END IF;
      UPDATE birthday_discount_usage bdu
         SET birthday_date=customer_birthday,reward_record_id=reward_record,order_id=NEW.id,
             status='Reserved',reserved_at=now(),released_at=NULL,updated_at=now()
       WHERE bdu.customer_user_id=NEW.customer_user_id AND bdu.reward_year=target_reward_year;
    END IF;
  ELSIF promotion_type='Promotion' THEN
    SELECT * INTO campaign FROM promotion_records
     WHERE code=upper(COALESCE(NEW.promotion->>'code','')) FOR UPDATE;
    IF NOT FOUND OR lower(campaign.status) <> 'active' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_NOT_ACTIVE';
    END IF;
    starts_on := CASE WHEN COALESCE(campaign.payload->>'startsAt',campaign.payload->>'startDate','') ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(COALESCE(campaign.payload->>'startsAt',campaign.payload->>'startDate'),10)::date ELSE NULL END;
    ends_on := CASE WHEN COALESCE(campaign.payload->>'endsAt',campaign.payload->>'endDate','') ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(COALESCE(campaign.payload->>'endsAt',campaign.payload->>'endDate'),10)::date ELSE NULL END;
    IF starts_on IS NOT NULL AND (now() AT TIME ZONE 'Africa/Cairo')::date < starts_on THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_NOT_STARTED';
    END IF;
    IF ends_on IS NOT NULL AND (now() AT TIME ZONE 'Africa/Cairo')::date > ends_on THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_EXPIRED';
    END IF;

    total_limit := GREATEST(0,COALESCE(NULLIF(campaign.payload->>'totalUsageLimit','')::integer,0));
    customer_limit := GREATEST(0,COALESCE(NULLIF(campaign.payload->>'perCustomerUsageLimit','')::integer,0));
    SELECT count(*)::integer INTO current_total FROM promotion_usages pu
     WHERE pu.promotion_record_id=campaign.record_id AND pu.status IN ('Reserved','Used');
    SELECT count(*)::integer INTO current_customer FROM promotion_usages pu
     WHERE pu.promotion_record_id=campaign.record_id AND pu.customer_user_id=NEW.customer_user_id
       AND pu.status IN ('Reserved','Used');
    IF total_limit > 0 AND current_total >= total_limit THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_TOTAL_USAGE_LIMIT_REACHED';
    END IF;
    IF customer_limit > 0 AND current_customer >= customer_limit THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_CUSTOMER_USAGE_LIMIT_REACHED';
    END IF;
    INSERT INTO promotion_usages(promotion_record_id,promotion_code,customer_user_id,order_id,status,discount_minor)
    VALUES (campaign.record_id,campaign.code,NEW.customer_user_id,NEW.id,'Reserved',NEW.order_discount_minor);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS orders_reward_reservation_guard ON orders;
CREATE TRIGGER orders_reward_reservation_guard
BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION dart_reserve_order_rewards();

CREATE OR REPLACE FUNCTION dart_sync_reward_order_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  reward_id TEXT := COALESCE(NEW.promotion->>'rewardId','');
  expiry_text TEXT;
  next_reward_status TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF COALESCE(NEW.promotion->>'type','')='Birthday' THEN
    IF NEW.status='Delivered' THEN
      UPDATE birthday_discount_usage
         SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,updated_at=now()
       WHERE order_id=NEW.id AND status <> 'Used';
      UPDATE customers
         SET last_birthday_discount_used_at=COALESCE(NEW.delivered_at,now()),updated_at=now()
       WHERE user_id=NEW.customer_user_id;
      UPDATE birthday_rewards
         SET payload=payload || jsonb_build_object('status','Used','usedCount',1,'usedAt',COALESCE(NEW.delivered_at,now()),'orderId',NEW.order_code),
             updated_at=now()
       WHERE record_id=reward_id;
    ELSIF NEW.status IN ('Cancelled','Refused') THEN
      UPDATE birthday_discount_usage SET status='Released',released_at=now(),order_id=NULL,updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
      SELECT payload->>'expiresAt' INTO expiry_text FROM birthday_rewards WHERE record_id=reward_id;
      next_reward_status := CASE
        WHEN COALESCE(expiry_text,'') ~ '^\d{4}-\d{2}-\d{2}'
         AND (now() AT TIME ZONE 'Africa/Cairo')::date < left(expiry_text,10)::date
        THEN 'Active' ELSE 'Expired' END;
      UPDATE birthday_rewards
         SET payload=(payload - 'orderId' - 'reservedAt') || jsonb_build_object('status',next_reward_status),updated_at=now()
       WHERE record_id=reward_id AND status='Reserved';
    END IF;
  ELSIF COALESCE(NEW.promotion->>'type','')='Promotion' THEN
    IF NEW.status='Delivered' THEN
      UPDATE promotion_usages SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,
             discount_minor=NEW.order_discount_minor,updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    ELSIF NEW.status IN ('Cancelled','Refused') THEN
      UPDATE promotion_usages SET status='Released',released_at=now(),updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS orders_reward_status_sync ON orders;
CREATE TRIGGER orders_reward_status_sync
AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION dart_sync_reward_order_status();

CREATE OR REPLACE FUNCTION dart_customer_birthday_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_reward_year INTEGER := dart_cairo_year(now());
  has_locked_reward BOOLEAN;
BEGIN
  IF NEW.birthday IS NOT DISTINCT FROM OLD.birthday THEN RETURN NEW; END IF;
  UPDATE customers SET birthday_updated_at=now(),updated_at=now() WHERE user_id=NEW.user_id;
  SELECT EXISTS(
    SELECT 1 FROM birthday_discount_usage bdu
     WHERE bdu.customer_user_id=NEW.user_id AND bdu.reward_year=current_reward_year
       AND bdu.status IN ('Reserved','Used')
  ) INTO has_locked_reward;
  IF NOT has_locked_reward THEN
    DELETE FROM birthday_discount_usage bdu
     WHERE bdu.customer_user_id=NEW.user_id AND bdu.reward_year=current_reward_year AND bdu.status='Released';
    DELETE FROM birthday_rewards br
     WHERE br.customer_code=NEW.client_code
       AND br.record_id LIKE '%-' || current_reward_year::text
       AND br.status <> 'Reserved';
    DELETE FROM message_records mr
     WHERE mr.domain='birthday_messages' AND mr.customer_code=NEW.client_code
       AND lower(COALESCE(mr.payload->>'status','')) NOT IN ('sent','delivered');
  END IF;
  INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata)
  VALUES ('system',NULL,'CUSTOMER_BIRTHDAY_CHANGED','customers',NEW.user_id::text,
    jsonb_build_object('previousBirthday',OLD.birthday,'newBirthday',NEW.birthday,'currentYearDiscountLocked',has_locked_reward));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS customers_birthday_change_guard ON customers;
CREATE TRIGGER customers_birthday_change_guard
AFTER UPDATE OF birthday ON customers FOR EACH ROW EXECUTE FUNCTION dart_customer_birthday_changed();

CREATE OR REPLACE FUNCTION dart_parse_card_expiry(value JSONB)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE raw TEXT := COALESCE(value->>'expDate',value->>'expiresAt','');
BEGIN
  IF raw ~ '^\d{4}-\d{2}-\d{2}' THEN RETURN left(raw,10)::date; END IF;
  IF raw ~ '^\d{2}[-/]\d{2}[-/]\d{4}$' THEN RETURN to_date(replace(raw,'/','-'),'DD-MM-YYYY'); END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION dart_guard_active_loyalty_card()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  code TEXT := COALESCE(NEW.payload->>'clientId',NEW.payload->>'customerId','');
  new_status TEXT := COALESCE(NEW.payload->>'status','');
  new_limit INTEGER := GREATEST(1,COALESCE(NULLIF(NEW.payload->>'itemLimit','')::integer,NULLIF(NEW.payload->>'purchasedLimit','')::integer,10));
  new_used INTEGER := GREATEST(0,COALESCE(NULLIF(NEW.payload->>'purchasedItems','')::integer,0));
  new_reserved INTEGER := GREATEST(0,COALESCE(NULLIF(NEW.payload->>'reservedItems','')::integer,0));
BEGIN
  IF new_status <> 'Active' OR code='' OR new_used + new_reserved >= new_limit THEN RETURN NEW; END IF;
  IF dart_parse_card_expiry(NEW.payload) IS NOT NULL
     AND dart_parse_card_expiry(NEW.payload) < (now() AT TIME ZONE 'Africa/Cairo')::date THEN RETURN NEW; END IF;
  IF EXISTS(
    SELECT 1 FROM loyalty_cards existing
     WHERE existing.record_id <> NEW.record_id
       AND existing.customer_code=code AND existing.status='Active'
       AND COALESCE(NULLIF(existing.payload->>'purchasedItems','')::integer,0)
         + COALESCE(NULLIF(existing.payload->>'reservedItems','')::integer,0)
         < GREATEST(1,COALESCE(NULLIF(existing.payload->>'itemLimit','')::integer,NULLIF(existing.payload->>'purchasedLimit','')::integer,10))
       AND (dart_parse_card_expiry(existing.payload) IS NULL
         OR dart_parse_card_expiry(existing.payload) >= (now() AT TIME ZONE 'Africa/Cairo')::date)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CUSTOMER_ALREADY_HAS_ACTIVE_DART_CARD';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS loyalty_cards_one_active_guard ON loyalty_cards;
CREATE TRIGGER loyalty_cards_one_active_guard
BEFORE INSERT OR UPDATE OF payload ON loyalty_cards
FOR EACH ROW EXECUTE FUNCTION dart_guard_active_loyalty_card();
