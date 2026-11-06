-- Existing beneficiaries do not consume another unique-customer slot.
-- Keep the per-customer usage cap and campaign-row lock authoritative.
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
    IF total_limit > 0 AND current_total >= total_limit
       AND (limit_basis <> 'customers' OR current_customer = 0) THEN
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

