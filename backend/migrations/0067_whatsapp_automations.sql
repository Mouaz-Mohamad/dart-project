-- Explicit consent and durable scheduling for the two approved customer messages.
ALTER TABLE customer_whatsapp_preferences
  ADD COLUMN post_delivery_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN review_consented_at TIMESTAMPTZ,
  ADD COLUMN review_consent_version TEXT;

-- Use civil Cairo time, including daylight-saving transitions, at both queue and send.
CREATE FUNCTION dart_whatsapp_send_at(earliest TIMESTAMPTZ)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE STRICT
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN (earliest AT TIME ZONE 'Africa/Cairo')::time < time '13:00'
      THEN ((earliest AT TIME ZONE 'Africa/Cairo')::date + time '13:00') AT TIME ZONE 'Africa/Cairo'
    WHEN (earliest AT TIME ZONE 'Africa/Cairo')::time >= time '22:00'
      THEN (((earliest AT TIME ZONE 'Africa/Cairo')::date + 1) + time '13:00') AT TIME ZONE 'Africa/Cairo'
    ELSE earliest
  END
$$;

CREATE FUNCTION dart_audit_whatsapp_receipt()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,old_values,new_values,metadata)
    VALUES('system','WHATSAPP_DELIVERY_STATUS_CHANGED','outbox_delivery_attempt',NEW.id::text,
      jsonb_build_object('status',OLD.delivery_status),
      jsonb_build_object('status',NEW.delivery_status,'statusAt',NEW.delivery_status_at,'errorCode',NEW.delivery_error_code),
      jsonb_build_object('source','meta-webhook','outboxEventId',NEW.event_id::text));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER outbox_whatsapp_receipt_audit
AFTER UPDATE OF delivery_status ON outbox_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION dart_audit_whatsapp_receipt();

CREATE FUNCTION dart_queue_post_delivery_whatsapp()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  queued_id UUID;
  send_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'Delivered' OR OLD.status = 'Delivered' OR NEW.delivered_at IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;
  send_at := dart_whatsapp_send_at(NEW.delivered_at + interval '7 hours');
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
-- No historical backfill: only a new, committed transition into Delivered queues a message.
CREATE TRIGGER orders_queue_post_delivery_whatsapp
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION dart_queue_post_delivery_whatsapp();
