-- DART CODE GUIDE | backend/migrations/0028_courier_fee_per_order.sql
-- الغرض: تحويل بدل المندوب من تكلفة لكل قطعة إلى مستحق ثابت لكل أوردر ومنع العد المزدوج في Finance.

UPDATE site_settings
SET data =
  (data - 'deliveryCostPerPiece')
  || jsonb_build_object(
       'courierFeePerOrder',
       COALESCE(
         NULLIF(data->>'courierFeePerOrder', '')::numeric,
         NULLIF(data->>'deliveryCostPerPiece', '')::numeric,
         100
       )
     ),
    version = version + 1,
    updated_at = now()
WHERE id = 'main';

-- Legacy orders stored delivery_cost_minor as item_count * courier_fee.
-- Divide multi-item orders once to restore the original per-order snapshot.
WITH order_item_counts AS (
  SELECT order_id, GREATEST(1, count(*))::numeric AS item_count
  FROM order_items
  GROUP BY order_id
)
UPDATE orders o
SET delivery_cost_minor =
      CASE
        WHEN c.item_count > 1 AND o.delivery_cost_minor > 0
          THEN round(o.delivery_cost_minor / c.item_count)
        ELSE o.delivery_cost_minor
      END,
    updated_at = now()
FROM order_item_counts c
WHERE c.order_id = o.id;
