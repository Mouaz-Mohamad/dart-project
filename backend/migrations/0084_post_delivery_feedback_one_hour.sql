-- DART CODE GUIDE | backend/migrations/0084_post_delivery_feedback_one_hour.sql
-- الغرض: إرسال رسالة التقييم بعد ساعة من التسليم للأوردرات من الموقع والداشبورود، دون إعادة إرسال الرسائل المنشورة.
-- The original AFTER UPDATE trigger remains in place; no retroactive Delivered transitions.
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

  send_at := NEW.delivered_at + interval '1 hour';
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

-- Move only unsent, never-attempted pending reviews to the new one-hour schedule.
-- Preserve already-accepted, uncertain, failed, and published provider outcomes.
UPDATE outbox_events e
  SET available_at = (e.payload->>'deliveredAt')::timestamptz + interval '1 hour',
      payload = jsonb_set(e.payload, '{expiresAt}',
        to_jsonb(((e.payload->>'deliveredAt')::timestamptz + interval '25 hours')::text), true),
      updated_at = now()
FROM orders o
WHERE e.event_type = 'CUSTOMER_POST_DELIVERY_REVIEW'
  AND e.aggregate_type = 'order'
  AND e.aggregate_id = o.id::text
  AND o.status = 'Delivered' AND NOT o.is_deleted
  AND o.delivered_at = (e.payload->>'deliveredAt')::timestamptz
  AND e.status = 'pending' AND e.attempts = 0
  AND e.payload ? 'deliveredAt'
  AND e.available_at > o.delivered_at + interval '1 hour'
  AND NOT EXISTS (SELECT 1 FROM outbox_delivery_attempts a WHERE a.event_id = e.id);
