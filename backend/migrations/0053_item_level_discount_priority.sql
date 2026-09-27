-- DART CODE GUIDE | backend/migrations/0053_item_level_discount_priority.sql
-- الغرض: حفظ مصدر الخصم لكل قطعة، وضبط حدود الحملات المتزامنة، وإعادة Birthday بعد الإرجاع الكامل فقط.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS discount_source TEXT NOT NULL DEFAULT 'None'
    CHECK (discount_source IN ('None','Model','Campaign','Birthday','Dart Card')),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS discount_minor BIGINT NOT NULL DEFAULT 0
    CHECK (discount_minor >= 0),
  ADD COLUMN IF NOT EXISTS discount_reference TEXT;

UPDATE order_items oi
   SET discount_source = CASE
         WHEN oi.model_discount_percent <= 0 THEN 'None'
         WHEN COALESCE(o.promotion->>'type','')='Promotion' THEN 'Campaign'
         WHEN COALESCE(o.promotion->>'type','')='Birthday' THEN 'Birthday'
         WHEN COALESCE(o.promotion->>'type','')='Dart Card' THEN 'Dart Card'
         ELSE 'Model'
       END,
       discount_percent = oi.model_discount_percent,
       discount_minor = GREATEST(0, oi.original_unit_minor - oi.final_unit_minor),
       discount_reference = COALESCE(
         NULLIF(o.promotion->>'code',''),
         NULLIF(o.promotion->>'rewardId',''),
         NULLIF(o.promotion->>'cardId','')
       )
  FROM orders o
 WHERE o.id=oi.order_id
   AND oi.discount_source='None'
   AND oi.discount_percent=0;

CREATE INDEX IF NOT EXISTS order_items_discount_source_idx
  ON order_items(order_id, discount_source) WHERE discount_source <> 'None';

CREATE OR REPLACE FUNCTION dart_reserve_order_rewards()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  promotion_type TEXT := COALESCE(NEW.promotion->>'type','');
  target_reward_year INTEGER;
  existing_status TEXT;
  existing_order UUID;
  customer_birthday DATE;
  reward_record TEXT;
  -- RECORD keeps function creation safe while integration workers rebuild domain tables.
  -- The SELECT below still resolves and locks the authoritative campaign row at runtime.
  campaign RECORD;
  total_limit INTEGER;
  customer_limit INTEGER;
  current_total INTEGER;
  current_customer INTEGER;
  limit_basis TEXT;
  audience_type TEXT;
  starts_on DATE;
  ends_on DATE;
  campaign_discount_minor BIGINT;
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
             status='Reserved',reserved_at=now(),used_at=NULL,released_at=NULL,updated_at=now()
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
    limit_basis := lower(COALESCE(NULLIF(campaign.payload->>'limitBasis',''),'orders'));
    audience_type := lower(COALESCE(NULLIF(campaign.payload->>'audience',''),'all'));
    IF audience_type='previouscustomers' AND NOT EXISTS (
      SELECT 1 FROM orders prior
       WHERE prior.customer_user_id=NEW.customer_user_id
         AND prior.status='Delivered' AND NOT prior.is_deleted
         AND (prior.delivered_at AT TIME ZONE 'Africa/Cairo')::date
             < COALESCE(starts_on,(NEW.created_at AT TIME ZONE 'Africa/Cairo')::date)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_REQUIRES_PREVIOUS_CUSTOMER';
    END IF;
    IF audience_type='nopreviousorders' AND EXISTS (
      SELECT 1 FROM orders prior
       WHERE prior.customer_user_id=NEW.customer_user_id
         AND prior.status='Delivered' AND NOT prior.is_deleted
         AND (prior.delivered_at AT TIME ZONE 'Africa/Cairo')::date
             < COALESCE(starts_on,(NEW.created_at AT TIME ZONE 'Africa/Cairo')::date)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_REQUIRES_NEW_CUSTOMER';
    END IF;
    IF limit_basis='customers' THEN
      SELECT count(DISTINCT pu.customer_user_id)::integer INTO current_total
        FROM promotion_usages pu
       WHERE pu.promotion_record_id=campaign.record_id AND pu.status IN ('Reserved','Used');
    ELSE
      SELECT count(*)::integer INTO current_total FROM promotion_usages pu
       WHERE pu.promotion_record_id=campaign.record_id AND pu.status IN ('Reserved','Used');
    END IF;
    SELECT count(*)::integer INTO current_customer FROM promotion_usages pu
     WHERE pu.promotion_record_id=campaign.record_id AND pu.customer_user_id=NEW.customer_user_id
       AND pu.status IN ('Reserved','Used');
    IF total_limit > 0 AND current_total >= total_limit THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_TOTAL_USAGE_LIMIT_REACHED';
    END IF;
    IF customer_limit > 0 AND current_customer >= customer_limit THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='PROMOTION_CUSTOMER_USAGE_LIMIT_REACHED';
    END IF;
    campaign_discount_minor := GREATEST(0,COALESCE(NULLIF(NEW.promotion->>'discountMinor','')::bigint,NEW.order_discount_minor));
    INSERT INTO promotion_usages(promotion_record_id,promotion_code,customer_user_id,order_id,status,discount_minor)
    VALUES (campaign.record_id,campaign.code,NEW.customer_user_id,NEW.id,'Reserved',campaign_discount_minor);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION dart_restore_birthday_discount_after_return(target_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  target_order RECORD;
  reward_id TEXT;
  expiry_text TEXT;
  remaining_count INTEGER;
  restored BOOLEAN := false;
BEGIN
  SELECT * INTO target_order FROM orders WHERE id=target_order_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(target_order.promotion->>'type','') <> 'Birthday' THEN RETURN false; END IF;

  SELECT count(*)::integer INTO remaining_count
    FROM order_items oi
   WHERE oi.order_id=target_order_id
     AND oi.discount_source='Birthday'
     AND NOT EXISTS (
       SELECT 1 FROM return_requests rr
        WHERE rr.order_code=target_order.order_code
          AND rr.item_code=oi.item_code
          AND lower(rr.request_type) IN ('return','refund')
          AND (
            lower(rr.status) IN ('completed','returned','closed','done','good','damaged')
            OR COALESCE(rr.payload->>'completedAt','') <> ''
          )
     );
  IF remaining_count > 0 THEN RETURN false; END IF;

  UPDATE birthday_discount_usage
     SET status='Released',order_id=NULL,released_at=now(),used_at=NULL,updated_at=now()
   WHERE order_id=target_order_id AND status IN ('Reserved','Used');
  restored := FOUND;
  IF NOT restored THEN RETURN false; END IF;

  reward_id := COALESCE(target_order.promotion->>'rewardId','');
  SELECT payload->>'expiresAt' INTO expiry_text FROM birthday_rewards WHERE record_id=reward_id FOR UPDATE;
  UPDATE birthday_rewards
     SET payload=(payload - 'orderId' - 'reservedAt' - 'usedAt') || jsonb_build_object(
           'status', CASE
             WHEN COALESCE(expiry_text,'') ~ '^\d{4}-\d{2}-\d{2}'
              AND (now() AT TIME ZONE 'Africa/Cairo')::date <= left(expiry_text,10)::date
             THEN 'Active' ELSE 'Expired' END,
           'usedCount', 0
         ),
         updated_at=now()
   WHERE record_id=reward_id;
  UPDATE customers SET last_birthday_discount_used_at=NULL,updated_at=now()
   WHERE user_id=target_order.customer_user_id;
  INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
  VALUES ('system','BIRTHDAY_DISCOUNT_RESTORED_AFTER_FULL_RETURN','orders',target_order.order_code,
    jsonb_build_object('rewardId',reward_id));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION dart_restore_birthday_discount_after_return(UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION dart_restore_birthday_discount_after_return(UUID) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION dart_restore_birthday_discount_after_return(UUID) FROM authenticated';
  END IF;
END
$$;
