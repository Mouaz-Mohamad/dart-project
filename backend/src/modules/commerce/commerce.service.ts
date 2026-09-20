import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

export interface CartLineInput {
  modelId: string;
  color: string;
  size: string;
  quantity: number;
}

export interface CheckoutInput {
  reservationId: string;
  contact: {
    name: string;
    phone1: string;
    phone2?: string | undefined;
    email: string;
  };
  address: {
    country: string;
    governorate: string;
    area: string;
    street: string;
    building: string;
    floor: string;
    latitude: string;
    longitude: string;
    fullAddress?: string | undefined;
    addressSource?: string | undefined;
  };
  deliveryNotes?: string | undefined;
}

interface LockedItem {
  id: string;
  item_code: string;
  model_id: string;
  color: string;
  size: string;
  model_name: string;
  cost_minor: string;
  selling_minor: string;
  discount_percent: string;
}

function normalized(value: string): string {
  return String(value || "").trim();
}

function finalModelPriceMinor(sellingMinor: number, discountPercent: number): number {
  return Math.max(0, Math.round(sellingMinor * (1 - Math.min(100, Math.max(0, discountPercent)) / 100)));
}

function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function activeSiteDiscountPercent(settings: Record<string, unknown>): number {
  const raw = settings.siteDiscount;
  if (!raw || typeof raw !== "object") return 0;
  const discount = raw as Record<string, unknown>;
  if (discount.enabled !== true) return 0;
  const percent = Math.min(100, Math.max(0, Number(discount.percent) || 0));
  if (!percent) return 0;
  const today = cairoDateKey();
  const startsAt = String(discount.startsAt || "");
  const endsAt = String(discount.endsAt || "");
  if (startsAt && today < startsAt) return 0;
  if (endsAt && today > endsAt) return 0;
  return percent;
}

export class CommerceService {
  public constructor(private readonly pool: Pool) {}

  public async reserveCart(
    reservationId: string,
    lines: CartLineInput[],
    customerUserId?: string,
  ): Promise<{ reservationId: string; expiresAt: Date; reservedItems: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      await client.query(
        `UPDATE inventory_items
            SET status='In stock', cart_reservation_id=NULL, reservation_until=NULL,
                version=version+1, updated_at=now()
          WHERE cart_reservation_id=$1 AND lower(status)='cart reserved'`,
        [reservationId],
      );
      await client.query("DELETE FROM cart_reservations WHERE id=$1", [reservationId]);

      const expiresResult = await client.query<{ expires_at: Date }>(
        "SELECT now() + interval '15 minutes' AS expires_at",
      );
      const expiresAt = expiresResult.rows[0]!.expires_at;

      await client.query(
        `INSERT INTO cart_reservations (id, customer_user_id, expires_at)
         VALUES ($1,$2,$3)`,
        [reservationId, customerUserId ?? null, expiresAt],
      );

      let reservedItems = 0;
      for (const input of lines) {
        const modelId = normalized(input.modelId);
        const color = normalized(input.color);
        const size = normalized(input.size);
        const quantity = Number(input.quantity);

        const modelResult = await client.query<{
          size_options: Array<{ name?: string; active?: boolean }> | null;
          color_options: Array<{ name?: string; active?: boolean }> | null;
        }>(
          `SELECT size_options, color_options
             FROM catalog_models
            WHERE model_id=$1 AND active AND NOT is_archived AND NOT is_deleted
            FOR SHARE`,
          [modelId],
        );
        const model = modelResult.rows[0];
        if (!model) {
          throw new AppError(409, "MODEL_UNAVAILABLE", "A product in your cart is no longer available");
        }
        const sizeOk = (model.size_options || []).some(
          (option) => String(option?.name) === size && option?.active !== false,
        );
        const colorOk = (model.color_options || []).some(
          (option) => String(option?.name) === color && option?.active !== false,
        );
        if (!sizeOk || !colorOk) {
          throw new AppError(409, "VARIANT_UNAVAILABLE", "A selected size or color is no longer available");
        }

        const available = await client.query<{ id: string }>(
          `SELECT id
             FROM inventory_items
            WHERE model_id=$1
              AND color=$2
              AND size=$3
              AND active
              AND NOT is_archived
              AND NOT is_deleted
              AND lower(status)='in stock'
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT $4`,
          [modelId, color, size, quantity],
        );
        if (available.rows.length !== quantity) {
          throw new AppError(
            409,
            "STOCK_INSUFFICIENT",
            `Only ${available.rows.length} item(s) are currently available for ${modelId} / ${color} / ${size}`,
          );
        }
        const ids = available.rows.map((row) => row.id);
        await client.query(
          `UPDATE inventory_items
              SET status='Cart Reserved',
                  cart_reservation_id=$1,
                  reservation_until=$2,
                  version=version+1,
                  updated_at=now()
            WHERE id = ANY($3::text[])`,
          [reservationId, expiresAt, ids],
        );
        reservedItems += ids.length;
      }

      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
      await client.query("COMMIT");
      return { reservationId, expiresAt, reservedItems };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async releaseCart(reservationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE inventory_items
            SET status='In stock', cart_reservation_id=NULL, reservation_until=NULL,
                version=version+1, updated_at=now()
          WHERE cart_reservation_id=$1 AND lower(status)='cart reserved'`,
        [reservationId],
      );
      await client.query("DELETE FROM cart_reservations WHERE id=$1", [reservationId]);
      if ((result.rowCount ?? 0) > 0) {
        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async checkout(
    customerUserId: string,
    input: CheckoutInput,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      const reservationResult = await client.query<{
        customer_user_id: string | null;
        expires_at: Date;
      }>(
        `SELECT customer_user_id, expires_at
           FROM cart_reservations
          WHERE id=$1
          FOR UPDATE`,
        [input.reservationId],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation || reservation.expires_at.getTime() <= Date.now()) {
        throw new AppError(409, "RESERVATION_EXPIRED", "Your cart reservation has expired");
      }
      if (reservation.customer_user_id && reservation.customer_user_id !== customerUserId) {
        throw new AppError(403, "RESERVATION_OWNERSHIP_INVALID", "This cart reservation belongs to another account");
      }
      await client.query(
        "UPDATE cart_reservations SET customer_user_id=$2, updated_at=now() WHERE id=$1",
        [input.reservationId, customerUserId],
      );

      const itemResult = await client.query<LockedItem>(
        `SELECT i.id, i.item_code, i.model_id, i.color, i.size,
                m.name AS model_name, m.cost_minor::text, m.selling_minor::text,
                m.discount_percent::text
           FROM inventory_items i
           JOIN catalog_models m ON m.model_id=i.model_id
          WHERE i.cart_reservation_id=$1
            AND lower(i.status)='cart reserved'
            AND i.reservation_until > now()
            AND i.active AND NOT i.is_archived AND NOT i.is_deleted
            AND m.active AND NOT m.is_archived AND NOT m.is_deleted
          ORDER BY i.created_at, i.id
          FOR UPDATE OF i`,
        [input.reservationId],
      );
      if (!itemResult.rows.length) {
        throw new AppError(409, "RESERVATION_EMPTY", "No reserved items remain in this cart");
      }

      const settingsResult = await client.query<{ data: Record<string, unknown> }>(
        "SELECT data FROM site_settings WHERE id='main'",
      );
      const siteDiscountPercent = activeSiteDiscountPercent(settingsResult.rows[0]?.data || {});

      let subtotalMinor = 0;
      let finalMinor = 0;
      const itemSnapshots = itemResult.rows.map((row) => {
        const sellingMinor = Number(row.selling_minor);
        const modelDiscountPercent = Number(row.discount_percent || 0);
        const effectiveDiscountPercent = siteDiscountPercent || modelDiscountPercent;
        const finalUnitMinor = finalModelPriceMinor(sellingMinor, effectiveDiscountPercent);
        subtotalMinor += sellingMinor;
        finalMinor += finalUnitMinor;
        return {
          row,
          sellingMinor,
          modelDiscountPercent,
          effectiveDiscountPercent,
          finalUnitMinor,
          costMinor: Number(row.cost_minor),
        };
      });
      const orderDiscountMinor = Math.max(0, subtotalMinor - finalMinor);
      const promotion = siteDiscountPercent
        ? { type: "Site", percent: siteDiscountPercent }
        : null;

      const orderResult = await client.query<{ id: string; order_code: string; created_at: Date }>(
        `INSERT INTO orders (
           customer_user_id, subtotal_minor, order_discount_minor, final_minor, promotion,
           contact_snapshot, delivery_address, delivery_notes, order_source, legacy
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,'Website',$9::jsonb)
         RETURNING id, order_code, created_at`,
        [
          customerUserId,
          subtotalMinor,
          orderDiscountMinor,
          finalMinor,
          promotion ? JSON.stringify(promotion) : null,
          JSON.stringify(input.contact),
          JSON.stringify(input.address),
          input.deliveryNotes || "",
          JSON.stringify({ reservationId: input.reservationId }),
        ],
      );
      const order = orderResult.rows[0]!;

      for (const snapshot of itemSnapshots) {
        const row = snapshot.row;
        await client.query(
          `INSERT INTO order_items (
             order_id, inventory_item_id, item_code, model_id, model_name, color, size,
             original_unit_minor, model_discount_percent, final_unit_minor, cost_snapshot_minor
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            order.id,
            row.id,
            row.item_code,
            row.model_id,
            row.model_name,
            row.color,
            row.size,
            snapshot.sellingMinor,
            snapshot.modelDiscountPercent,
            snapshot.finalUnitMinor,
            snapshot.costMinor,
          ],
        );
      }

      await client.query(
        `UPDATE inventory_items
            SET status='Processing/Held',
                order_id=$2,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE cart_reservation_id=$1`,
        [input.reservationId, order.order_code],
      );
      await client.query("DELETE FROM cart_reservations WHERE id=$1", [input.reservationId]);

      await client.query(
        `INSERT INTO order_events (
           order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
         ) VALUES ($1,'ORDER_CREATED',NULL,'New','customer',$2,$3::jsonb)`,
        [order.id, customerUserId, JSON.stringify({ requestId })],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('customer',$1,'ORDER_CREATED','orders',$2,$3,$4::jsonb)`,
        [
          customerUserId,
          order.id,
          requestId,
          JSON.stringify({ orderCode: order.order_code, itemCount: itemSnapshots.length }),
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           aggregate_type, aggregate_id, event_type, payload, deduplication_key
         ) VALUES ('order',$1,'order.created',$2::jsonb,$3)
         ON CONFLICT (deduplication_key) DO NOTHING`,
        [
          order.id,
          JSON.stringify({
            orderId: order.id,
            orderCode: order.order_code,
            customerUserId,
            totalMinor: finalMinor,
          }),
          `order.created:${order.id}`,
        ],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
      await client.query("COMMIT");

      return {
        id: order.id,
        orderId: order.order_code,
        status: "New",
        createdAt: order.created_at.toISOString(),
        totalProducts: itemSnapshots.length,
        totalPrice: subtotalMinor / 100,
        discount: siteDiscountPercent,
        orderLevelDiscountAmount: orderDiscountMinor / 100,
        finalAmount: finalMinor / 100,
        promotionType: promotion?.type || "",
        paymentMethod: "Cash on Delivery",
        paymentStatus: "Unpaid",
        items: itemSnapshots.map((snapshot) => snapshot.row.item_code),
        priceSnapshot: itemSnapshots.map((snapshot) => ({
          itemId: snapshot.row.id,
          itemCode: snapshot.row.item_code,
          modelCode: snapshot.row.model_id,
          name: snapshot.row.model_name,
          color: snapshot.row.color,
          size: snapshot.row.size,
          qty: 1,
          originalUnitPrice: snapshot.sellingMinor / 100,
          discountPercent: snapshot.effectiveDiscountPercent,
          discountAmount: (snapshot.sellingMinor - snapshot.finalUnitMinor) / 100,
          finalUnitPrice: snapshot.finalUnitMinor / 100,
          costSnapshot: snapshot.costMinor / 100,
        })),
        ...input.contact,
        ...input.address,
        deliveryNotes: input.deliveryNotes || "",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseExpired(client: PoolClient): Promise<void> {
    const result = await client.query(
      `UPDATE inventory_items
          SET status='In stock', cart_reservation_id=NULL, reservation_until=NULL,
              version=version+1, updated_at=now()
        WHERE lower(status)='cart reserved' AND reservation_until <= now()`,
    );
    await client.query("DELETE FROM cart_reservations WHERE expires_at <= now()");
    if ((result.rowCount ?? 0) > 0) {
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
    }
  }
}
