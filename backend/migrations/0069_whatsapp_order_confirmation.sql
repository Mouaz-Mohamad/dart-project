-- Bind customer decisions to the immutable checkout version; no historical backfill.
CREATE TABLE order_whatsapp_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  phone_normalized TEXT NOT NULL CHECK (phone_normalized ~ '^201[0125][0-9]{8}$'),
  expected_version BIGINT NOT NULL,
  final_minor BIGINT NOT NULL CHECK (final_minor >= 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE order_whatsapp_replies (
  message_id TEXT PRIMARY KEY CHECK (length(message_id) BETWEEN 1 AND 255),
  confirmation_id UUID NOT NULL REFERENCES order_whatsapp_confirmations(id),
  action TEXT NOT NULL CHECK (action IN ('confirm','cancel')),
  outcome TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE order_whatsapp_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_whatsapp_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_whatsapp_confirmations,order_whatsapp_replies FROM PUBLIC;
DO $$ DECLARE target_role TEXT; BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON order_whatsapp_confirmations,order_whatsapp_replies FROM %I',target_role);
    END IF;
  END LOOP;
END $$;
