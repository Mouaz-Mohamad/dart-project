-- DART CODE GUIDE | backend/migrations/0082_whatsapp_guest_customer_delivery.sql
-- الغرض: إرسال متابعة التسليم بعد سبع ساعات للأوردرات اليدوية والمتجر، مع التحقق من هاتف الطلب، بدون اشتراط وجود حساب.
-- Require a documented business opt-in before using WhatsApp; signed-in users retain an explicit opt-out.
CREATE OR REPLACE FUNCTION dart_whatsapp_order_phone(raw_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(raw_phone,''),'[^0-9]','','g') ~ '^01(0|1|2|5)[0-9]{8}$'
      THEN '20'||substring(regexp_replace(raw_phone,'[^0-9]','','g') FROM 2)
    WHEN regexp_replace(COALESCE(raw_phone,''),'[^0-9]','','g') ~ '^201(0|1|2|5)[0-9]{8}$'
      THEN regexp_replace(raw_phone,'[^0-9]','','g')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION dart_queue_post_delivery_whatsapp()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  queued_id UUID;
  send_at TIMESTAMPTZ;
  recipient TEXT;
BEGIN
  IF NEW.status <> 'Delivered' OR OLD.status = 'Delivered'
      OR NEW.delivered_at IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;
  recipient := dart_whatsapp_order_phone(NEW.contact_snapshot->>'phone1');
  IF recipient IS NULL THEN
    INSERT INTO audit_logs(actor_type,action,entity_type,entity_id)
      VALUES('system','POST_DELIVERY_WHATSAPP_PHONE_INVALID','order',NEW.id::text);
    RETURN NEW;
  END IF;

  send_at := NEW.delivered_at + interval '7 hours';
  INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key,available_at)
  VALUES('order',NEW.id::text,'CUSTOMER_POST_DELIVERY_REVIEW',
    jsonb_build_object('channel','whatsapp','to',recipient,'category','utility',
      'orderId',NEW.id::text,'deliveredAt',NEW.delivered_at,
      'expiresAt',send_at + interval '24 hours',
      'parameters',jsonb_build_array(
        COALESCE(NULLIF(NEW.contact_snapshot->>'name',''),'عميل دارت'),NEW.order_code)),
    'post-delivery-review:'||NEW.id::text,send_at)
  ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
  RETURNING id INTO queued_id;
  IF queued_id IS NOT NULL THEN
    INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,new_values)
    VALUES('system','POST_DELIVERY_WHATSAPP_QUEUED','order',NEW.id::text,
      jsonb_build_object('outboxEventId',queued_id::text,'scheduledAt',send_at,'category','utility'));
  END IF;
  RETURN NEW;
END
$$;
