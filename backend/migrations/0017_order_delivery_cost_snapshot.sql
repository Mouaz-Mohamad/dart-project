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
