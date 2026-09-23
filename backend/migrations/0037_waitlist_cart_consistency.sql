-- DART CODE GUIDE | backend/migrations/0031_waitlist_cart_consistency.sql
-- الغرض: يحافظ على اتساق Waiting بعد تأكيد العميل ثم تعديل/تفريغ السلة العادية.

DROP INDEX IF EXISTS waitlist_one_live_allocation_per_item;
CREATE UNIQUE INDEX waitlist_one_live_allocation_per_item
  ON waitlist_allocations(inventory_item_id)
  WHERE status IN ('active','cart');

DROP INDEX IF EXISTS waitlist_one_live_allocation_per_entry;
CREATE UNIQUE INDEX waitlist_one_live_allocation_per_entry
  ON waitlist_allocations(waitlist_entry_id)
  WHERE status IN ('active','cart');

CREATE OR REPLACE FUNCTION dart_waitlist_confirmed_cart_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR lower(OLD.status) <> 'cart reserved'
     OR lower(NEW.status) <> 'in stock'
     OR current_setting('dart.skip_waitlist_allocation', true)='1' THEN
    RETURN NEW;
  END IF;

  SELECT wa.waitlist_entry_id
    INTO v_entry_id
    FROM waitlist_allocations wa
   WHERE wa.inventory_item_id=NEW.id
     AND wa.status='expired'
     AND wa.release_reason='confirmed_cart_released'
   ORDER BY wa.updated_at DESC
   LIMIT 1;

  IF v_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE waitlist_entries
     SET status='expired',
         reserved_until=NULL,
         version=version+1,
         updated_at=now()
   WHERE id=v_entry_id
     AND status='confirmed';

  IF FOUND THEN
    INSERT INTO audit_logs(
      actor_type,action,entity_type,entity_id,new_values,metadata
    ) VALUES (
      'system',
      'WAITLIST_CONFIRMED_CART_RELEASED',
      'waitlist',
      v_entry_id::text,
      jsonb_build_object('itemId',NEW.id),
      jsonb_build_object('reason','confirmed_item_left_cart')
    );

    UPDATE domain_state_versions
       SET version=version+1,
           updated_at=now()
     WHERE domain='waiting';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_inventory_waitlist_confirmed_cart_release
  ON inventory_items;

CREATE TRIGGER zz_inventory_waitlist_confirmed_cart_release
AFTER UPDATE OF status, cart_reservation_id, reservation_until
ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION dart_waitlist_confirmed_cart_release();
