-- DART CODE GUIDE | backend/migrations/0064_set_reward_lifecycle_compatibility.sql
-- Preserve Set-only historical reward ownership alongside mixed line benefits.
-- No order prices or historical business records are rewritten.
CREATE OR REPLACE FUNCTION dart_order_reward_benefits(target_order_id UUID, promotion JSONB)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path=public,pg_temp AS $$
  SELECT dart_order_benefits(promotion) || COALESCE((
    SELECT jsonb_build_array(jsonb_build_object('type','Birthday',
      'rewardId',COALESCE(NULLIF(g.benefit_metadata->>'rewardId',''),g.discount_reference,'')))
      FROM order_set_groups g WHERE g.order_id=target_order_id AND g.discount_source='Birthday'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(dart_order_benefits(promotion)) b WHERE b->>'type'='Birthday')
      ORDER BY g.created_at,g.id LIMIT 1
  ),'[]'::jsonb)
$$;
REVOKE ALL ON FUNCTION dart_order_reward_benefits(UUID,JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION dart_sync_reward_order_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  reward_id TEXT;
  benefit JSONB;
  expiry_text TEXT;
  next_reward_status TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  FOR benefit IN SELECT value FROM jsonb_array_elements(dart_order_reward_benefits(NEW.id,NEW.promotion)) LOOP
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
  IF NEW.status='Delivered' THEN
    UPDATE set_loyalty_usage SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  ELSIF NEW.status IN ('Cancelled','Refused') THEN
    UPDATE set_loyalty_usage SET status='Released',released_at=now(),updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  ELSIF OLD.status='Delivered' AND NEW.status<>'Delivered' THEN
    UPDATE set_loyalty_usage SET status='Reserved',used_at=NULL,released_at=NULL,updated_at=now()
     WHERE order_id=NEW.id AND status='Used';
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
  birthday_benefit JSONB;
  expiry_text TEXT;
  remaining_count INTEGER;
  restored BOOLEAN := false;
BEGIN
  SELECT * INTO target_order FROM orders WHERE id=target_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT value INTO birthday_benefit FROM jsonb_array_elements(dart_order_reward_benefits(target_order_id,target_order.promotion))
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
  IF COALESCE(expiry_text,'')='' THEN
    SELECT benefit_metadata->>'expiresAt' INTO expiry_text FROM order_set_groups
     WHERE order_id=target_order_id AND discount_source='Birthday' ORDER BY created_at,id LIMIT 1;
  END IF;
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
