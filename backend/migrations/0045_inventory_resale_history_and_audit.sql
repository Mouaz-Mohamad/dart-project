-- DART CODE GUIDE | backend/migrations/0045_inventory_resale_history_and_audit.sql
-- الغرض: السماح بإعادة بيع القطعة الفعلية بعد رجوعها للمخزون، مع سجل Audit append-only لكل تغير مهم في دورة حياة القطعة.

-- Historical order lines must not make a physical item permanently unsellable.
-- Concurrency safety is enforced by inventory status + row locking/reservations,
-- while order_items remains an immutable historical record of every sale cycle.
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_inventory_item_id_key;

CREATE INDEX IF NOT EXISTS order_items_inventory_item_id_idx
  ON order_items (inventory_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION dart_audit_inventory_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_state JSONB;
  new_state JSONB;
  audit_action TEXT;
BEGIN
  old_state := CASE
    WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
      'status', OLD.status,
      'orderId', OLD.order_id,
      'returnRequestId', OLD.return_request_id,
      'cartReservationId', OLD.cart_reservation_id,
      'reservationUntil', OLD.reservation_until,
      'purchaseDate', OLD.purchase_date,
      'active', OLD.active,
      'isArchived', OLD.is_archived,
      'isDeleted', OLD.is_deleted,
      'costSnapshotMinor', OLD.cost_snapshot_minor
    )
    ELSE NULL
  END;

  new_state := jsonb_build_object(
    'status', NEW.status,
    'orderId', NEW.order_id,
    'returnRequestId', NEW.return_request_id,
    'cartReservationId', NEW.cart_reservation_id,
    'reservationUntil', NEW.reservation_until,
    'purchaseDate', NEW.purchase_date,
    'active', NEW.active,
    'isArchived', NEW.is_archived,
    'isDeleted', NEW.is_deleted,
    'costSnapshotMinor', NEW.cost_snapshot_minor
  );

  IF TG_OP = 'UPDATE' AND old_state IS NOT DISTINCT FROM new_state THEN
    RETURN NEW;
  END IF;

  audit_action := CASE
    WHEN TG_OP = 'INSERT' THEN 'INVENTORY_ITEM_CREATED'
    ELSE 'INVENTORY_ITEM_CHANGED'
  END;

  INSERT INTO audit_logs (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    'system',
    NULL,
    audit_action,
    'items',
    NEW.id::text,
    old_state,
    new_state,
    jsonb_build_object(
      'itemCode', NEW.item_code,
      'modelId', NEW.model_id,
      'color', NEW.color,
      'size', NEW.size,
      'source', 'inventory_items_trigger'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_items_audit_history ON inventory_items;
CREATE TRIGGER inventory_items_audit_history
AFTER INSERT OR UPDATE OF
  status,
  order_id,
  return_request_id,
  cart_reservation_id,
  reservation_until,
  purchase_date,
  active,
  is_archived,
  is_deleted,
  cost_snapshot_minor
ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION dart_audit_inventory_item_change();

-- Give every existing physical item a baseline timeline entry so the History
-- button is useful immediately after this migration, without rewriting old data.
INSERT INTO audit_logs (
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  old_values,
  new_values,
  metadata
)
SELECT
  'system',
  NULL,
  'INVENTORY_ITEM_AUDIT_BASELINE',
  'items',
  i.id::text,
  NULL,
  jsonb_build_object(
    'status', i.status,
    'orderId', i.order_id,
    'returnRequestId', i.return_request_id,
    'cartReservationId', i.cart_reservation_id,
    'reservationUntil', i.reservation_until,
    'purchaseDate', i.purchase_date,
    'active', i.active,
    'isArchived', i.is_archived,
    'isDeleted', i.is_deleted,
    'costSnapshotMinor', i.cost_snapshot_minor
  ),
  jsonb_build_object(
    'itemCode', i.item_code,
    'modelId', i.model_id,
    'color', i.color,
    'size', i.size,
    'source', 'migration_0045_baseline'
  )
FROM inventory_items i
WHERE NOT EXISTS (
  SELECT 1
    FROM audit_logs a
   WHERE a.entity_type = 'items'
     AND a.entity_id = i.id::text
);
