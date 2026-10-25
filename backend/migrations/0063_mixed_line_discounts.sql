-- DART CODE GUIDE | backend/migrations/0063_mixed_line_discounts.sql
-- Reserve and finalize each benefit actually allocated to order lines. Legacy
-- single-benefit snapshots retain their existing interpretation and prices.
CREATE OR REPLACE FUNCTION dart_order_benefits(value JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN value IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(value->'benefits')='array' THEN value->'benefits'
    ELSE jsonb_build_array(value) END
$$;
REVOKE ALL ON FUNCTION dart_order_benefits(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION dart_reserve_order_rewards()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  promotion_type TEXT;
  benefit JSONB;
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

  FOR benefit IN SELECT value FROM jsonb_array_elements(dart_order_benefits(NEW.promotion)) LOOP
  promotion_type := COALESCE(benefit->>'type','');
  IF promotion_type='Birthday' THEN
    target_reward_year := COALESCE(dart_reward_year_from_order(benefit), dart_cairo_year(NEW.created_at));
    reward_record := NULLIF(benefit->>'rewardId','');
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
     WHERE code=upper(COALESCE(benefit->>'code','')) FOR UPDATE;
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
    campaign_discount_minor := GREATEST(0,COALESCE(NULLIF(benefit->>'discountMinor','')::bigint,NEW.order_discount_minor));
    INSERT INTO promotion_usages(promotion_record_id,promotion_code,customer_user_id,order_id,status,discount_minor)
    VALUES (campaign.record_id,campaign.code,NEW.customer_user_id,NEW.id,'Reserved',campaign_discount_minor);
  END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION dart_sync_reward_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  reward_id TEXT;
  benefit JSONB;
  expiry_text TEXT;
  next_reward_status TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  FOR benefit IN SELECT value FROM jsonb_array_elements(dart_order_benefits(NEW.promotion)) LOOP
  reward_id := COALESCE(benefit->>'rewardId','');
  IF COALESCE(benefit->>'type','')='Birthday' THEN
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
         AND (now() AT TIME ZONE 'Africa/Cairo')::date <= left(expiry_text,10)::date
        THEN 'Active' ELSE 'Expired' END;
      UPDATE birthday_rewards
         SET payload=(payload - 'orderId' - 'reservedAt') || jsonb_build_object('status',next_reward_status),updated_at=now()
       WHERE record_id=reward_id AND status='Reserved';
    END IF;
  ELSIF COALESCE(benefit->>'type','')='Promotion' THEN
    IF NEW.status='Delivered' THEN
      UPDATE promotion_usages SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,
             discount_minor=COALESCE(NULLIF(benefit->>'discountMinor','')::bigint,discount_minor),updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    ELSIF NEW.status IN ('Cancelled','Refused') THEN
      UPDATE promotion_usages SET status='Released',released_at=now(),updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    END IF;
  END IF;
  END LOOP;
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
  birthday_benefit JSONB;
  expiry_text TEXT;
  remaining_count INTEGER;
  restored BOOLEAN := false;
BEGIN
  SELECT * INTO target_order FROM orders WHERE id=target_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT value INTO birthday_benefit FROM jsonb_array_elements(dart_order_benefits(target_order.promotion))
   WHERE value->>'type'='Birthday' LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

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

  reward_id := COALESCE(birthday_benefit->>'rewardId','');
  SELECT payload->>'expiresAt' INTO expiry_text FROM birthday_rewards WHERE record_id=reward_id FOR UPDATE;
  IF COALESCE(expiry_text,'') !~ '^\d{4}-\d{2}-\d{2}'
     OR (now() AT TIME ZONE 'Africa/Cairo')::date > left(expiry_text,10)::date THEN
    RETURN false;
  END IF;

  UPDATE birthday_discount_usage
     SET status='Released',order_id=NULL,released_at=now(),used_at=NULL,updated_at=now()
   WHERE order_id=target_order_id AND status IN ('Reserved','Used');
  restored := FOUND;
  IF NOT restored THEN RETURN false; END IF;

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
