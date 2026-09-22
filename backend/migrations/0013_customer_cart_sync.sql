-- DART CODE GUIDE | backend/migrations/0013_customer_cart_sync.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
CREATE INDEX IF NOT EXISTS cart_reservations_customer_active_idx
  ON cart_reservations (customer_user_id, updated_at DESC)
  WHERE customer_user_id IS NOT NULL;
