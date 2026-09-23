-- DART CODE GUIDE | backend/migrations/0014_cart_price_review.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
ALTER TABLE cart_reservations
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cart_reservations
  ADD CONSTRAINT cart_reservations_pricing_snapshot_array
  CHECK (jsonb_typeof(pricing_snapshot) = 'array')
  NOT VALID;

ALTER TABLE cart_reservations
  VALIDATE CONSTRAINT cart_reservations_pricing_snapshot_array;
