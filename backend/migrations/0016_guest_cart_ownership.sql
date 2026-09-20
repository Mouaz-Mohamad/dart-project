ALTER TABLE cart_reservations
  ADD COLUMN IF NOT EXISTS guest_owner_hash CHAR(64);

CREATE INDEX IF NOT EXISTS cart_reservations_guest_owner_idx
  ON cart_reservations (guest_owner_hash)
  WHERE customer_user_id IS NULL AND guest_owner_hash IS NOT NULL;
