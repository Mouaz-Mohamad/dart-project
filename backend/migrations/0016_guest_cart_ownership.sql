-- DART CODE GUIDE | backend/migrations/0016_guest_cart_ownership.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
ALTER TABLE cart_reservations
  ADD COLUMN IF NOT EXISTS guest_owner_hash CHAR(64);

CREATE INDEX IF NOT EXISTS cart_reservations_guest_owner_idx
  ON cart_reservations (guest_owner_hash)
  WHERE customer_user_id IS NULL AND guest_owner_hash IS NOT NULL;
