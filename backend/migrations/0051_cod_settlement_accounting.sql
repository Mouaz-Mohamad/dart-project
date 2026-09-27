-- DART CODE GUIDE | backend/migrations/0051_cod_settlement_accounting.sql
-- الغرض: حفظ رصيد تحصيل المندوب على الطلب بالقروش ودعم التسوية الجزئية والنهائية.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cod_settled_minor BIGINT NOT NULL DEFAULT 0
    CHECK (cod_settled_minor >= 0),
  ADD COLUMN IF NOT EXISTS cod_settled_at TIMESTAMPTZ;

WITH settlement_totals AS (
  SELECT order_code,
         sum(
           CASE
             WHEN COALESCE(payload->>'amountReceivedMinor','') ~ '^[0-9]+$'
               THEN (payload->>'amountReceivedMinor')::bigint
             WHEN COALESCE(payload->>'amountReceived','') ~ '^[0-9]+([.][0-9]{1,2})?$'
               THEN round((payload->>'amountReceived')::numeric * 100)::bigint
             ELSE 0
           END
         ) AS settled_minor
    FROM finance_records
   WHERE domain='finance_settlements'
     AND COALESCE((payload->>'isDeleted')::boolean,false)=false
     AND COALESCE((payload->>'isArchived')::boolean,false)=false
     AND NULLIF(payload->>'archivedAt','') IS NULL
   GROUP BY order_code
)
UPDATE orders o
   SET cod_settled_minor=LEAST(
         GREATEST(0, o.final_minor-o.amount_refunded_minor-o.delivery_cost_minor),
         GREATEST(0, settlement_totals.settled_minor)
       ),
       cod_settled_at=CASE
         WHEN settlement_totals.settled_minor >=
              GREATEST(0, o.final_minor-o.amount_refunded_minor-o.delivery_cost_minor)
           THEN COALESCE(o.cod_settled_at, now())
         ELSE NULL
       END
  FROM settlement_totals
 WHERE settlement_totals.order_code=o.order_code;

CREATE INDEX IF NOT EXISTS orders_cod_settlement_outstanding_idx
  ON orders(representative_user_id, delivered_at, order_code)
  WHERE status='Delivered'
    AND NOT is_deleted
    AND NOT is_archived
    AND cod_settled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_settlement_reference_unique_idx
  ON finance_records(lower(payload->>'reference'))
  WHERE domain='finance_settlements'
    AND NULLIF(btrim(payload->>'reference'),'') IS NOT NULL
    AND NULLIF(payload->>'archivedAt','') IS NULL;
