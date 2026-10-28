-- Delivery receipts for WhatsApp Cloud API. Outbox remains source of truth.
ALTER TABLE outbox_delivery_attempts
  ADD COLUMN delivery_status TEXT CHECK (delivery_status IN ('sent','delivered','read','failed')),
  ADD COLUMN delivery_status_at TIMESTAMPTZ,
  ADD COLUMN delivery_error_code TEXT;
CREATE INDEX outbox_delivery_attempts_provider_message_idx
  ON outbox_delivery_attempts(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
