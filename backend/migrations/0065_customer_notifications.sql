-- Additive Phase 1 customer notifications; internal notification_records is unchanged.
CREATE TABLE customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ORDER_PLACED','ORDER_OUT_FOR_DELIVERY','ORDER_DELIVERED')),
  event_key TEXT NOT NULL UNIQUE,
  order_code TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ
);
CREATE INDEX customer_notifications_owner_page_idx ON customer_notifications(customer_user_id,created_at DESC,id DESC);
CREATE INDEX customer_notifications_unread_idx ON customer_notifications(customer_user_id) WHERE read_at IS NULL;

-- Endpoint/auth material is encrypted, never copied to the outbox or API responses.
-- Session binding stops delivery after sign-out, expiry, password change or suspension.
CREATE TABLE web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  -- A login family survives secure token rotation, but ends on logout/revocation.
  session_family_id UUID NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  encrypted_subscription BYTEA NOT NULL,
  credentials_fingerprint TEXT NOT NULL,
  vapid_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_reason TEXT
);
CREATE INDEX web_push_subscriptions_owner_idx ON web_push_subscriptions(customer_user_id) WHERE active;
CREATE INDEX web_push_subscriptions_session_idx ON web_push_subscriptions(session_family_id);
ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_notifications,web_push_subscriptions FROM PUBLIC;
