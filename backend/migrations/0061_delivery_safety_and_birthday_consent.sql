-- Delivery attempts survive provider acceptance even if acknowledgement fails.
CREATE TABLE outbox_delivery_attempts (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('executing','accepted','retryable','unknown','terminal','suppressed')),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_delivery_attempts_event_idx ON outbox_delivery_attempts(event_id,state);
CREATE UNIQUE INDEX outbox_delivery_attempts_inflight_unique ON outbox_delivery_attempts(event_id)
  WHERE state IN ('executing','accepted','unknown','terminal','suppressed');
ALTER TABLE outbox_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE customer_whatsapp_preferences (
  customer_user_id UUID PRIMARY KEY REFERENCES customers(user_id) ON DELETE CASCADE,
  birthday_marketing BOOLEAN NOT NULL DEFAULT false,
  phone_normalized TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE customer_whatsapp_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_delivery_attempts,customer_whatsapp_preferences FROM PUBLIC;
