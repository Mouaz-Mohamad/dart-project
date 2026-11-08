-- DART CODE GUIDE | backend/migrations/0077_whatsapp_birthday_only_send_window.sql
-- الغرض: السماح بإرسال رسائل واتساب غير عيد الميلاد طوال اليوم مع إبقاء موعد متابعة التسليم بعد 7 ساعات.
-- Birthday WhatsApp is the only message constrained to 13:00–22:00 Africa/Cairo.
-- Keep the original trigger: change the existing queue function without replacing any triggers.
CREATE OR REPLACE FUNCTION dart_queue_post_delivery_whatsapp()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  queued_id UUID;
  send_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'Delivered' OR OLD.status = 'Delivered' OR NEW.delivered_at IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;
  send_at := NEW.delivered_at + interval '7 hours';
  INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key,available_at)
  SELECT 'order',NEW.id::text,'CUSTOMER_POST_DELIVERY_REVIEW',
    jsonb_build_object('channel','whatsapp','to',ph.phone_normalized,'category','utility',
      'orderId',NEW.id::text,'deliveredAt',NEW.delivered_at,'expiresAt',send_at+interval '24 hours',
      'consentVersion','post-delivery-whatsapp-v1','parameters',jsonb_build_array(c.full_name,NEW.order_code)),
    'post-delivery-review:'||NEW.id::text,send_at
  FROM customers c JOIN users u ON u.id=c.user_id
  JOIN customer_whatsapp_preferences p ON p.customer_user_id=c.user_id
  JOIN account_phones ph ON ph.user_id=c.user_id AND ph.is_primary AND ph.account_type='customer'
  WHERE c.user_id=NEW.customer_user_id AND u.status='active' AND u.deleted_at IS NULL
    AND p.post_delivery_review AND p.review_consented_at IS NOT NULL
    AND p.review_consented_at<=NEW.delivered_at AND p.review_consent_version='post-delivery-whatsapp-v1'
    AND p.phone_normalized=ph.phone_normalized
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

-- Reschedule only never-attempted review messages from the old shared quiet window.
-- Preserve their original 7-hour delay + 24-hour freshness window.
-- Do not requeue published/unknown/accepted events or bypass recipient eligibility.
UPDATE outbox_events e
   SET available_at = ((e.payload->>'deliveredAt')::timestamptz + interval '7 hours'),
       payload = jsonb_set(
         e.payload, '{expiresAt}',
         to_jsonb((((e.payload->>'deliveredAt')::timestamptz + interval '31 hours'))::text), true
       ),
       updated_at = now()
 WHERE e.event_type = 'CUSTOMER_POST_DELIVERY_REVIEW'
   AND e.status = 'pending'
   AND e.attempts = 0
   AND e.payload ? 'deliveredAt'
   AND NOT EXISTS (
     SELECT 1 FROM outbox_delivery_attempts a WHERE a.event_id = e.id
   );
