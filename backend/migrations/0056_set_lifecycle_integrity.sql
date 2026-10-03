-- DART CODE GUIDE | backend/migrations/0056_set_lifecycle_integrity.sql
-- الغرض: إكمال دورة حياة Sets: Waiting ذري، حجز Dart Card عبر السلال، مزامنة حالة الولاء، واسترجاع Birthday بعد الإرجاع الكامل.

CREATE TABLE IF NOT EXISTS set_loyalty_cart_reservations (
  cart_set_group_id UUID PRIMARY KEY REFERENCES cart_set_groups(id) ON DELETE CASCADE,
  customer_user_id UUID REFERENCES customers(user_id) ON DELETE CASCADE,
  card_code TEXT NOT NULL,
  piece_count INTEGER NOT NULL CHECK (piece_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS set_loyalty_cart_reservations_card_expiry_idx
  ON set_loyalty_cart_reservations(card_code,expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS set_waiting_entries_active_unique
  ON set_waiting_entries(customer_user_id,set_id,md5(selections::text))
  WHERE status IN ('waiting','reserved','confirmed');

CREATE OR REPLACE FUNCTION dart_mark_set_waiting_converted()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  source_reservation TEXT;
BEGIN
  IF NEW.cart_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT reservation_id INTO source_reservation
    FROM cart_set_groups
   WHERE id=NEW.cart_group_id;
  IF source_reservation IS NULL THEN RETURN NEW; END IF;

  UPDATE set_waiting_entries
     SET status='converted',order_id=NEW.order_id,converted_at=now(),updated_at=now(),version=version+1
   WHERE cart_reservation_id=source_reservation
     AND set_id=NEW.set_id
     AND status='confirmed';
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS order_set_groups_waiting_conversion ON order_set_groups;
CREATE TRIGGER order_set_groups_waiting_conversion
AFTER INSERT ON order_set_groups
FOR EACH ROW EXECUTE FUNCTION dart_mark_set_waiting_converted();

-- Birthday may belong to a Set even when the parent order promotion is a Campaign or NULL.
-- Keep Campaign lifecycle independent so Set Birthday never consumes/restores a Campaign.
CREATE OR REPLACE FUNCTION dart_sync_reward_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  reward_id TEXT := COALESCE(NEW.promotion->>'rewardId','');
  set_reward_id TEXT := '';
  expiry_text TEXT;
  next_reward_status TEXT;
  has_birthday BOOLEAN := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT COALESCE(discount_reference,'') INTO set_reward_id
    FROM order_set_groups
   WHERE order_id=NEW.id AND discount_source='Birthday'
   ORDER BY created_at,id
   LIMIT 1;
  set_reward_id := COALESCE(set_reward_id,'');
  has_birthday := COALESCE(NEW.promotion->>'type','')='Birthday' OR set_reward_id<>'';
  IF reward_id='' THEN reward_id := set_reward_id; END IF;

  IF has_birthday THEN
    IF NEW.status='Delivered' THEN
      UPDATE birthday_discount_usage
         SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,updated_at=now()
       WHERE order_id=NEW.id AND status <> 'Used';
      UPDATE customers
         SET last_birthday_discount_used_at=COALESCE(NEW.delivered_at,now()),updated_at=now()
       WHERE user_id=NEW.customer_user_id;
      UPDATE birthday_rewards
         SET payload=payload || jsonb_build_object(
               'status','Used','usedCount',1,'usedAt',COALESCE(NEW.delivered_at,now()),'orderId',NEW.order_code
             ),updated_at=now()
       WHERE record_id=reward_id;
    ELSIF NEW.status IN ('Cancelled','Refused') THEN
      UPDATE birthday_discount_usage
         SET status='Released',released_at=now(),order_id=NULL,updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
      SELECT payload->>'expiresAt' INTO expiry_text
        FROM birthday_rewards WHERE record_id=reward_id;
      next_reward_status := CASE
        WHEN COALESCE(expiry_text,'') ~ '^\d{4}-\d{2}-\d{2}'
         AND (now() AT TIME ZONE 'Africa/Cairo')::date <= left(expiry_text,10)::date
        THEN 'Active' ELSE 'Expired' END;
      UPDATE birthday_rewards
         SET payload=(payload - 'orderId' - 'reservedAt' - 'usedAt') || jsonb_build_object(
               'status',next_reward_status,'usedCount',0
             ),updated_at=now()
       WHERE record_id=reward_id;
    END IF;
  END IF;

  IF COALESCE(NEW.promotion->>'type','')='Promotion' THEN
    IF NEW.status='Delivered' THEN
      UPDATE promotion_usages
         SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,
             discount_minor=NEW.order_discount_minor,updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    ELSIF NEW.status IN ('Cancelled','Refused') THEN
      UPDATE promotion_usages
         SET status='Released',released_at=now(),updated_at=now()
       WHERE order_id=NEW.id AND status='Reserved';
    END IF;
  END IF;

  IF NEW.status='Delivered' THEN
    UPDATE set_loyalty_usage
       SET status='Used',used_at=COALESCE(NEW.delivered_at,now()),released_at=NULL,updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  ELSIF NEW.status IN ('Cancelled','Refused') THEN
    UPDATE set_loyalty_usage
       SET status='Released',released_at=now(),updated_at=now()
     WHERE order_id=NEW.id AND status='Reserved';
  ELSIF OLD.status='Delivered' AND NEW.status<>'Delivered' THEN
    UPDATE set_loyalty_usage
       SET status='Reserved',used_at=NULL,released_at=NULL,updated_at=now()
     WHERE order_id=NEW.id AND status='Used';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION dart_restore_birthday_discount_after_return(target_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  target_order RECORD;
  reward_id TEXT := '';
  expiry_text TEXT;
  remaining_count INTEGER;
  restored BOOLEAN := false;
BEGIN
  SELECT * INTO target_order FROM orders WHERE id=target_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF COALESCE(target_order.promotion->>'type','')='Birthday' THEN
    reward_id := COALESCE(target_order.promotion->>'rewardId','');
  ELSE
    SELECT COALESCE(discount_reference,'') INTO reward_id
      FROM order_set_groups
     WHERE order_id=target_order_id AND discount_source='Birthday'
     ORDER BY created_at,id
     LIMIT 1;
    reward_id := COALESCE(reward_id,'');
  END IF;
  IF reward_id='' THEN RETURN false; END IF;

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

  SELECT payload->>'expiresAt' INTO expiry_text
    FROM birthday_rewards WHERE record_id=reward_id FOR UPDATE;
  UPDATE birthday_rewards
     SET payload=(payload - 'orderId' - 'reservedAt' - 'usedAt') || jsonb_build_object(
           'status', CASE
             WHEN COALESCE(expiry_text,'') ~ '^\d{4}-\d{2}-\d{2}'
              AND (now() AT TIME ZONE 'Africa/Cairo')::date <= left(expiry_text,10)::date
             THEN 'Active' ELSE 'Expired' END,
           'usedCount',0
         ),updated_at=now()
   WHERE record_id=reward_id;
  UPDATE customers
     SET last_birthday_discount_used_at=NULL,updated_at=now()
   WHERE user_id=target_order.customer_user_id;
  INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
  VALUES ('system','BIRTHDAY_DISCOUNT_RESTORED_AFTER_FULL_RETURN','orders',target_order.order_code,
    jsonb_build_object('rewardId',reward_id,'includesSet',true));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION dart_mark_set_waiting_converted() FROM PUBLIC;
REVOKE ALL ON FUNCTION dart_restore_birthday_discount_after_return(UUID) FROM PUBLIC;

INSERT INTO domain_state_versions(domain,version)
VALUES ('set_waiting',1)
ON CONFLICT (domain) DO NOTHING;
