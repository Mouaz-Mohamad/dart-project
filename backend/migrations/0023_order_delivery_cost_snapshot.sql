-- DART CODE GUIDE | backend/migrations/0017_order_delivery_cost_snapshot.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_cost_minor BIGINT NOT NULL DEFAULT 0
  CHECK (delivery_cost_minor >= 0);

UPDATE orders o
SET delivery_cost_minor = COALESCE((
  SELECT COUNT(*)::bigint * 10000
  FROM order_items oi
  WHERE oi.order_id = o.id
), 0)
WHERE o.delivery_cost_minor = 0;
