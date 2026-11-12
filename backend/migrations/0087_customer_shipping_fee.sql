-- DART CODE GUIDE | backend/migrations/0087_customer_shipping_fee.sql
-- الغرض: تكلفة شحن العميل ثابتة لكل طلب، منفصلة عن مستحق المندوب، مع حفظ التاريخ.
ALTER TABLE orders ADD COLUMN shipping_fee_minor BIGINT NOT NULL DEFAULT 0
  CHECK (shipping_fee_minor >= 0);

-- Do not backfill existing orders with today's shipping charge.
UPDATE site_settings
SET data=data || '{"shippingFeePerOrder":100}'::jsonb, version=version+1, updated_at=now()
WHERE id='main' AND NOT (data ? 'shippingFeePerOrder');

-- Set reconciliation must preserve the order's immutable shipping snapshot.
CREATE OR REPLACE FUNCTION dart_reconcile_set_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
DECLARE
  campaign_count INTEGER;
  campaign_discount BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_set_groups WHERE order_id=NEW.order_id) THEN
    RETURN NEW;
  END IF;

  UPDATE orders o
     SET subtotal_minor=totals.subtotal_minor,
         order_discount_minor=totals.discount_minor,
         final_minor=totals.final_minor + o.shipping_fee_minor,
         updated_at=now()
    FROM (
      SELECT order_id,
             COALESCE(sum(original_unit_minor),0)::bigint AS subtotal_minor,
             COALESCE(sum(discount_minor),0)::bigint AS discount_minor,
             COALESCE(sum(final_unit_minor),0)::bigint AS final_minor
        FROM order_items
       WHERE order_id=NEW.order_id
       GROUP BY order_id
    ) totals
   WHERE o.id=totals.order_id;

  SELECT count(*)::integer,COALESCE(sum(discount_minor),0)::bigint
    INTO campaign_count,campaign_discount
    FROM order_items
   WHERE order_id=NEW.order_id AND discount_source='Campaign';

  IF campaign_count = 0 THEN
    DELETE FROM promotion_usages WHERE order_id=NEW.order_id;
    UPDATE orders
       SET promotion=NULL,updated_at=now()
     WHERE id=NEW.order_id
       AND COALESCE(promotion->>'type','')='Promotion';
  ELSE
    UPDATE promotion_usages
       SET discount_minor=campaign_discount,updated_at=now()
     WHERE order_id=NEW.order_id;
  END IF;
  RETURN NEW;
END
$$;
