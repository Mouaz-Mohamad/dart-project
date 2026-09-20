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

  public async adminOrders(): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const versionResult = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
    );
    const result = await this.pool.query<any>(
      `SELECT o.*, c.client_code,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'itemId', oi.inventory_item_id,
                'itemCode', oi.item_code,
                'modelCode', oi.model_id,
                'name', oi.model_name,
                'color', oi.color,
                'size', oi.size,
                'qty', 1,
                'originalUnitPrice', oi.original_unit_minor / 100.0,
                'discountPercent', oi.model_discount_percent,
                'discountAmount', (oi.original_unit_minor - oi.final_unit_minor) / 100.0,
                'finalUnitPrice', oi.final_unit_minor / 100.0,
                'costSnapshot', oi.cost_snapshot_minor / 100.0
              )
              ORDER BY oi.created_at
            )
            FROM order_items oi
            WHERE oi.order_id=o.id
          ), '[]'::jsonb) AS item_rows
        FROM orders o
        LEFT JOIN customers c ON c.user_id=o.customer_user_id
        ORDER BY o.created_at DESC`,
    );
    return {
      version: Number(versionResult.rows[0]?.version || 1),
      orders: result.rows.map((row: any) => {
        const legacy = row.legacy && typeof row.legacy === "object" ? row.legacy : {};
        const contact = row.contact_snapshot || {};
        const address = row.delivery_address || {};
        const snapshots = Array.isArray(row.item_rows) && row.item_rows.length
          ? row.item_rows
          : Array.isArray(legacy.priceSnapshot) ? legacy.priceSnapshot : [];
        return {
          ...legacy,
          id: row.id,
          orderId: row.order_code,
          status: row.status,
          createdAt: row.created_at,
          orderCreatedAt: row.created_at,
          deliveredAt: row.delivered_at || legacy.deliveredAt,
          clientId: row.client_code || legacy.clientId || "",
          clientName: contact.name || legacy.clientName || "",
          phone1: contact.phone1 || legacy.phone1 || "",
          phone2: contact.phone2 || legacy.phone2 || "-",
          email: contact.email || legacy.email || "",
          items: snapshots.length ? snapshots.map((line: any) => line.itemCode) : legacy.items || [],
          totalProducts: snapshots.length ? snapshots.length : Number(legacy.totalProducts || 0),
          priceSnapshot: snapshots,
          totalPrice: Number(row.subtotal_minor || 0) / 100,
          orderLevelDiscountAmount: Number(row.order_discount_minor || 0) / 100,
          finalAmount: Number(row.final_minor || 0) / 100,
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          amountPaid: Number(row.amount_paid_minor || 0) / 100,
          amountRefunded: Number(row.amount_refunded_minor || 0) / 100,
          promotionType: row.promotion?.type || legacy.promotionType || "",
          discount: Number(row.promotion?.percent || legacy.discount || 0),
          country: address.country || legacy.country || "",
          governorate: address.governorate || legacy.governorate || "",
          area: address.area || legacy.area || "",
          street: address.street || legacy.street || "",
          building: address.building || legacy.building || "",
          floor: address.floor || legacy.floor || "",
          latitude: address.latitude || legacy.latitude || "",
          longitude: address.longitude || legacy.longitude || "",
          fullAddress: address.fullAddress || legacy.fullAddress || "",
          addressSource: address.addressSource || legacy.addressSource || "",
          deliveryNotes: row.delivery_notes || legacy.deliveryNotes || "",
          orderSource: row.order_source || legacy.orderSource || "Website",
          isArchived: row.is_archived,
          isDeleted: row.is_deleted,
          version: Number(row.version || 1),
        };
      }),
    };
  }

  public async replaceAdminOrders(
    expectedVersion: number,
    orders: Record<string, unknown>[],
    actorId: string,
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    const allowedStatuses = new Set([
      "New",
      "Accepted",
      "Preparing",
      "Out With Representative",
      "Representative On The Way",
      "Delivered",
      "Refused",
      "Cancelled",
      "Returned",
      "Needs Attention",
    ]);
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain='orders' FOR UPDATE",
      );
      const currentVersion = Number(locked.rows[0]?.version || 1);
      if (currentVersion !== expectedVersion) {
        throw new AppError(409, "ORDERS_VERSION_CONFLICT", "Orders changed on another device; reload and retry");
      }

      for (const raw of orders) {
        const orderCode = String(raw.orderId || "").trim();
        if (!orderCode) continue;
        const rawStatus = String(raw.status || "New");
        const status = allowedStatuses.has(rawStatus) ? rawStatus : "Needs Attention";
        const clientCode = String(raw.clientId || "").trim();
        const customerResult = clientCode
          ? await client.query<{ user_id: string }>(
              "SELECT user_id FROM customers WHERE client_code=$1",
              [clientCode],
            )
          : { rows: [] as { user_id: string }[] };
        const customerUserId = customerResult.rows[0]?.user_id || null;
        const subtotalMinor = Math.max(0, Math.round((Number(raw.totalPrice) || 0) * 100));
        const discountMinor = Math.max(
          0,
          Math.round((Number(raw.orderLevelDiscountAmount) || 0) * 100),
        );
        const finalMinor = Math.max(
          0,
          Math.round(
            (Number.isFinite(Number(raw.finalAmount))
              ? Number(raw.finalAmount)
              : Number(raw.totalPrice || 0) - Number(raw.orderLevelDiscountAmount || 0)) * 100,
          ),
        );
        const contact = {
          name: String(raw.clientName || ""),
          phone1: String(raw.phone1 || ""),
          phone2: String(raw.phone2 || ""),
          email: String(raw.email || ""),
        };
        const address = {
          country: String(raw.country || ""),
          governorate: String(raw.governorate || ""),
          area: String(raw.area || ""),
          street: String(raw.street || ""),
          building: String(raw.building || ""),
          floor: String(raw.floor || ""),
          latitude: String(raw.latitude || ""),
          longitude: String(raw.longitude || ""),
          fullAddress: String(raw.fullAddress || ""),
          addressSource: String(raw.addressSource || ""),
        };
        const promotion = raw.promotionType
          ? { type: String(raw.promotionType), percent: Number(raw.discount || 0) }
          : null;
        const deliveredAt = raw.deliveredAt ? String(raw.deliveredAt) : null;

        await client.query(
          `INSERT INTO orders (
             order_code, customer_user_id, status, payment_method, payment_status,
             subtotal_minor, order_discount_minor, final_minor,
             amount_paid_minor, amount_refunded_minor, promotion, contact_snapshot,
             delivery_address, delivery_notes, order_source, is_archived, is_deleted,
             legacy, created_at, updated_at, delivered_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,
             $18::jsonb,COALESCE($19::timestamptz,now()),now(),$20::timestamptz
           )
           ON CONFLICT (order_code) DO UPDATE SET
             customer_user_id=COALESCE(EXCLUDED.customer_user_id, orders.customer_user_id),
             status=EXCLUDED.status,
             payment_method=EXCLUDED.payment_method,
             payment_status=EXCLUDED.payment_status,
             subtotal_minor=EXCLUDED.subtotal_minor,
             order_discount_minor=EXCLUDED.order_discount_minor,
             final_minor=EXCLUDED.final_minor,
             amount_paid_minor=EXCLUDED.amount_paid_minor,
             amount_refunded_minor=EXCLUDED.amount_refunded_minor,
             promotion=EXCLUDED.promotion,
             contact_snapshot=EXCLUDED.contact_snapshot,
             delivery_address=EXCLUDED.delivery_address,
             delivery_notes=EXCLUDED.delivery_notes,
             order_source=EXCLUDED.order_source,
             is_archived=EXCLUDED.is_archived,
             is_deleted=EXCLUDED.is_deleted,
             legacy=EXCLUDED.legacy,
             delivered_at=COALESCE(EXCLUDED.delivered_at, orders.delivered_at),
             version=orders.version+1,
             updated_at=now()`,
          [
            orderCode,
            customerUserId,
            status,
            String(raw.paymentMethod || "Cash on Delivery"),
            String(raw.paymentStatus || "Unpaid"),
            subtotalMinor,
            discountMinor,
            finalMinor,
            Math.max(0, Math.round((Number(raw.amountPaid) || 0) * 100)),
            Math.max(0, Math.round((Number(raw.amountRefunded) || 0) * 100)),
            promotion ? JSON.stringify(promotion) : null,
            JSON.stringify(contact),
            JSON.stringify(address),
            String(raw.deliveryNotes || ""),
            String(raw.orderSource || "Manual"),
            Boolean(raw.isArchived),
            Boolean(raw.isDeleted),
            JSON.stringify(raw),
            raw.createdAt ? String(raw.createdAt) : null,
            deliveredAt,
          ],
        );
      }

      const nextVersion = currentVersion + 1;
      await client.query(
        "UPDATE domain_state_versions SET version=$2, updated_at=now() WHERE domain=$1",
        ["orders", nextVersion],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'ORDER_STATE_SYNCED','orders','bulk',$2,$3::jsonb)`,
        [
          actorId,
          requestId,
          JSON.stringify({ previousVersion: currentVersion, newVersion: nextVersion, count: orders.length }),
        ],
      );
      await client.query("COMMIT");
      return await this.adminOrders();
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
