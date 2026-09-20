CREATE TABLE customer_preferences (
  customer_user_id UUID PRIMARY KEY REFERENCES customers(user_id) ON DELETE CASCADE,
  last_address JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_preferences_last_address_object
    CHECK (last_address IS NULL OR jsonb_typeof(last_address) = 'object')
);

CREATE INDEX IF NOT EXISTS customer_preferences_updated_idx
  ON customer_preferences (updated_at DESC);
