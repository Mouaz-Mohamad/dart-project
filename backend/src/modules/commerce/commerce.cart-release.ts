// DART CODE GUIDE | backend/src/modules/commerce/commerce.cart-release.ts
// Release one physical cart item under the same locks used by checkout and cart edits.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export async function releaseAdminCartItem(
  pool: Pool,
  actorId: string,
  itemId: string,
  expectedVersion: number,
  reservationId: string,
  requestId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ customer_user_id: string | null }>(
      "SELECT customer_user_id::text FROM cart_reservations WHERE id=$1", [reservationId],
    );
    if (owner.rows[0]?.customer_user_id) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `dart:customer-rewards:${owner.rows[0].customer_user_id}`,
      ]);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:cart:${reservationId}`]);
    const reservation = await client.query(
      "SELECT id FROM cart_reservations WHERE id=$1 FOR UPDATE", [reservationId],
    );
    const items = await client.query<{
      id: string; status: string; version: string; cart_reservation_id: string | null;
      reservation_until: Date | null; order_id: string | null;
    }>(
      `SELECT id,status,version::text,cart_reservation_id,reservation_until,order_id
         FROM inventory_items WHERE id=$1 FOR UPDATE`, [itemId],
    );
    const item = items.rows[0];
    if (!item) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");

    // Bind retries to the original physical-item version and cart. A retry must
    // never release a subsequent reservation (even if it reused the same cart ID).
    const oldValues = { status: "Cart Reserved", version: expectedVersion, cartReservationId: reservationId };
    const completed = await client.query(
      `SELECT 1 FROM audit_logs WHERE action='CART_ITEM_RELEASED' AND entity_type='items'
        AND entity_id=$1 AND old_values @> $2::jsonb LIMIT 1`, [itemId, JSON.stringify(oldValues)],
    );
    if (completed.rows.length) {
      await client.query("COMMIT");
      return { itemId, released: true, alreadyReleased: true };
    }
    if (!reservation.rows.length || item.order_id || item.status.toLowerCase() !== "cart reserved" ||
        item.cart_reservation_id !== reservationId || Number(item.version) !== expectedVersion) {
      throw new AppError(409, "CART_ITEM_CHANGED", "The item or its reservation changed. Refresh inventory before retrying");
    }

    // An incomplete Set cannot retain its bundle price or Dart Card slot hold.
    // Dissolve only that Set unit; its other physical pieces stay in the cart.
    const dissolved = await client.query<{ id: string; set_id: string }>(
      `DELETE FROM cart_set_groups g WHERE g.reservation_id=$1 AND EXISTS (
         SELECT 1 FROM cart_set_components c WHERE c.group_id=g.id AND c.inventory_item_id=$2
       ) RETURNING g.id::text,g.set_id`, [reservationId, itemId],
    );

    // This explicit override makes the piece publicly available, rather than
    // immediately allocating it to the next Waiting customer via the stock trigger.
    await client.query("SELECT set_config('dart.skip_waitlist_allocation','1',true)");
    const waiting = await client.query<{ waitlist_entry_id: string }>(
      `UPDATE waitlist_allocations SET status='expired',released_at=now(),
         release_reason='admin_cart_item_released',version=version+1,updated_at=now()
       WHERE inventory_item_id=$1 AND cart_reservation_id=$2 AND status IN ('active','cart','confirmed')
       RETURNING waitlist_entry_id::text`, [itemId, reservationId],
    );
    const waitingIds = [...new Set(waiting.rows.map((row) => row.waitlist_entry_id))];
    if (waitingIds.length) {
      await client.query(
        `UPDATE waitlist_entries SET status='expired',reserved_until=NULL,version=version+1,updated_at=now()
          WHERE id=ANY($1::uuid[]) AND status IN ('reserved','confirmed')`, [waitingIds],
      );
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,new_values)
         SELECT 'staff',$1,'WAITLIST_CART_ITEM_RELEASED','waitlist',id::text,$2,$3::jsonb
           FROM unnest($4::uuid[]) AS entries(id)`,
        [actorId, requestId, JSON.stringify({ itemId, reservationId }), waitingIds],
      );
      await client.query("UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='waiting'");
    }
    await client.query(
      `UPDATE inventory_items SET status='In stock',cart_reservation_id=NULL,reservation_until=NULL,
         version=version+1,updated_at=now() WHERE id=$1`, [itemId],
    );
    await client.query("UPDATE cart_reservations SET updated_at=now() WHERE id=$1", [reservationId]);
    await client.query(
      `DELETE FROM cart_reservations r WHERE r.id=$1 AND NOT EXISTS (
         SELECT 1 FROM inventory_items i WHERE i.cart_reservation_id=r.id AND lower(i.status)='cart reserved'
       )`, [reservationId],
    );
    const newValues = { status: "In stock", version: expectedVersion + 1, cartReservationId: null, reservationUntil: null };
    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,old_values,new_values,metadata)
       VALUES('staff',$1,'CART_ITEM_RELEASED','items',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [actorId, itemId, requestId, JSON.stringify({ ...oldValues, reservationUntil: item.reservation_until }),
        JSON.stringify(newValues), JSON.stringify({ dissolvedSetGroups: dissolved.rows, waitingIds })],
    );
    await client.query("UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='catalog_inventory'");
    await client.query("COMMIT");
    return { itemId, released: true, alreadyReleased: false, dissolvedSetGroups: dissolved.rows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
