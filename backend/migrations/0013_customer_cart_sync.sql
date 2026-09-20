CREATE INDEX IF NOT EXISTS cart_reservations_customer_active_idx
  ON cart_reservations (customer_user_id, updated_at DESC)
  WHERE customer_user_id IS NOT NULL;
