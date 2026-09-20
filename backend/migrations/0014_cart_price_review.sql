ALTER TABLE cart_reservations
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cart_reservations
  ADD CONSTRAINT cart_reservations_pricing_snapshot_array
  CHECK (jsonb_typeof(pricing_snapshot) = 'array')
  NOT VALID;

ALTER TABLE cart_reservations
  VALIDATE CONSTRAINT cart_reservations_pricing_snapshot_array;
