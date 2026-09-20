import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

const STATUS_MAP: Record<string, string> = {
  Pending: "New",
  Accepted: "Preparing",
  "Out for Delivery": "Out With Representative",
};

function normalizeStatus(value: unknown): string {
  return STATUS_MAP[String(value || "")] || String(value || "New");
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function minor(value: unknown): number {
  return Math.max(0, Math.round(num(value) * 100));
}

export class AdminOrdersService {
  public constructor(private readonly pool: Pool) {}

  public async state(): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      const version = await this.version(client);
      const orders = await this.readOrders(client);
      return { version, orders };
    } finally {
      client.release();
    }
  }

  public async replace(
    expectedVersion: number,
    orders: Record<string, unknown>[],
    actorId: string,
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentVersion = await this.version(client, true);
      if (currentVersion !== expectedVersion) {
        throw new AppError(409, "ORDERS_VERSION_CONFLICT", "Orders changed on another device; reload and retry");
      }

      const existing = await client.query<{ order_code: string }>(
        "SELECT order_code FROM orders WHERE NOT is_deleted FOR UPDATE",
      );
      const existingCodes = new Set(existing.rows.map((row) => row.order_code));
      const incomingCodes = new Set<string>();

      for (const raw of orders) {
        const orderCode = String(raw.orderId || raw.order_code || raw.id || "").trim();
        if (!orderCode) continue;
        incomingCodes.add(orderCode);
        await this.upsertOrder(client, raw, orderCode);
      }

      for (const code of existingCodes) {
        if (!incomingCodes.has(code)) {
          await client.query(
            "UPDATE orders SET is_archived=true, version=version+1, updated_at=now() WHERE order_code=$1",
            [code],
          );
        }
      }

      const nextVersion = currentVersion + 1;
      await client.query(
        `UPDATE domain_state_versions
            SET version=$1, updated_at=now()
          WHERE domain='orders'`,
        [nextVersion],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'ORDERS_STATE_REPLACED','orders','orders',$2,$3::jsonb)`,
        [
          actorId,
          requestId,
          JSON.stringify({ previousVersion: currentVersion, newVersion: nextVersion, count: incomingCodes.size }),
        ],
      );
      await client.query("COMMIT");
      return { version: nextVersion, orders: await this.readOrders(this.pool) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async version(client: PoolClient | Pool, lock = false): Promise<number> {
    const result = await client.query<{ version: string }>(
      `SELECT version::text
         FROM domain_state_versions
        WHERE domain='orders'
        ${lock ? "FOR UPDATE" : ""}`,
    );
    return Number(result.rows[0]?.version || 1);
  }

  private async readOrders(client: PoolClient | Pool): Promise<Record<string, unknown>[]> {
    const result = await client.query<{
      id: string;
      order_code: string;
      status: string;
      payment_method: string;
      payment_status: string;
      subtotal_minor: string;
      order_discount_minor: string;
      final_minor: string;
      amount_paid_minor: string;
      amount_refunded_minor: string;
      promotion: Record<string, unknown> | null;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      delivery_notes: string;
      order_source: string;
      legacy: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
      delivered_at: Date | null;
      items: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id, o.order_code, o.status, o.payment_method, o.payment_status,
              o.subtotal_minor::text, o.order_discount_minor::text, o.final_minor::text,
              o.amount_paid_minor::text, o.amount_refunded_minor::text, o.promotion,
              o.contact_snapshot, o.delivery_address, o.delivery_notes, o.order_source,
              o.legacy, o.created_at, o.updated_at, o.delivered_at,
              COALESCE(
                jsonb_agg(
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
                  ) ORDER BY oi.created_at, oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id=o.id
        WHERE NOT o.is_deleted
        GROUP BY o.id
        ORDER BY o.created_at DESC`,
    );

    return result.rows.map((row) => {
      const legacy = row.legacy || {};
      const contact = row.contact_snapshot || {};
      const address = row.delivery_address || {};
      const subtotal = Number(row.subtotal_minor) / 100;
      const discountAmount = Number(row.order_discount_minor) / 100;
      return {
        ...legacy,
        id: row.id,
        orderId: row.order_code,
        status: row.status,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        totalPrice: subtotal,
        orderLevelDiscountAmount: discountAmount,
        finalAmount: Number(row.final_minor) / 100,
        amountPaid: Number(row.amount_paid_minor) / 100,
        amountRefunded: Number(row.amount_refunded_minor) / 100,
        discount: num(row.promotion?.percent),
        promotionType: String(row.promotion?.type || legacy.promotionType || ""),
        name: String(contact.name || legacy.name || ""),
        phone1: String(contact.phone1 || legacy.phone1 || ""),
        phone2: String(contact.phone2 || legacy.phone2 || ""),
        email: String(contact.email || legacy.email || ""),
        country: String(address.country || legacy.country || ""),
        governorate: String(address.governorate || legacy.governorate || ""),
        area: String(address.area || legacy.area || ""),
        street: String(address.street || legacy.street || ""),
        building: String(address.building || legacy.building || ""),
        floor: String(address.floor || legacy.floor || ""),
        latitude: String(address.latitude || legacy.latitude || ""),
        longitude: String(address.longitude || legacy.longitude || ""),
        fullAddress: String(address.fullAddress || legacy.fullAddress || ""),
        deliveryNotes: row.delivery_notes,
        orderSource: row.order_source,
        priceSnapshot: row.items,
        items: row.items.map((item) => item.itemCode),
        totalProducts: row.items.length,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        ...(row.delivered_at ? { deliveredAt: row.delivered_at.toISOString() } : {}),
      };
    });
  }

  private async upsertOrder(
    client: PoolClient,
    raw: Record<string, unknown>,
    orderCode: string,
  ): Promise<void> {
    const existing = await client.query<{ id: string; status: string; customer_user_id: string }>(
      "SELECT id, status, customer_user_id FROM orders WHERE order_code=$1 FOR UPDATE",
      [orderCode],
    );
    const status = normalizeStatus(raw.status);
    const contact = {
      name: String(raw.name || ""),
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
    const subtotalMinor = minor(raw.totalPrice);
    const discountMinor = minor(raw.orderLevelDiscountAmount);
    const finalMinor = minor(raw.finalAmount ?? Math.max(0, num(raw.totalPrice) - num(raw.orderLevelDiscountAmount)));
    const deliveredAt = status === "Delivered"
      ? String(raw.deliveredAt || raw.updatedAt || new Date().toISOString())
      : null;

    if (existing.rows[0]) {
      const before = existing.rows[0].status;
      await client.query(
        `UPDATE orders SET
           status=$2, payment_method=$3, payment_status=$4,
           subtotal_minor=$5, order_discount_minor=$6, final_minor=$7,
           amount_paid_minor=$8, amount_refunded_minor=$9,
           promotion=$10::jsonb, contact_snapshot=$11::jsonb, delivery_address=$12::jsonb,
           delivery_notes=$13, order_source=$14, legacy=$15::jsonb,
           delivered_at=$16, is_archived=$17, version=version+1, updated_at=now()
         WHERE order_code=$1`,
        [
          orderCode,
          status,
          String(raw.paymentMethod || "Cash on Delivery"),
          String(raw.paymentStatus || "Unpaid"),
          subtotalMinor,
          discountMinor,
          finalMinor,
          minor(raw.amountPaid),
          minor(raw.amountRefunded),
          JSON.stringify(raw.promotionType || raw.discount ? { type: raw.promotionType || "", percent: num(raw.discount) } : null),
          JSON.stringify(contact),
          JSON.stringify(address),
          String(raw.deliveryNotes || ""),
          String(raw.orderSource || "Manual"),
          JSON.stringify(raw),
          deliveredAt,
          Boolean(raw.isArchived || raw.isDeleted),
        ],
      );
      if (before !== status) {
        await client.query(
          `INSERT INTO order_events (
             order_id, event_type, from_status, to_status, actor_type, metadata
           ) VALUES ($1,'STATUS_CHANGED',$2,$3,'staff',$4::jsonb)`,
          [existing.rows[0].id, before, status, JSON.stringify({ source: "dashboard" })],
        );
      }
      return;
    }

    const customerUserId = await this.resolveCustomer(client, contact);
    await client.query(
      `INSERT INTO orders (
         order_code, customer_user_id, status, payment_method, payment_status,
         subtotal_minor, order_discount_minor, final_minor, amount_paid_minor,
         amount_refunded_minor, promotion, contact_snapshot, delivery_address,
         delivery_notes, order_source, legacy, delivered_at, is_archived
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,
         $14,$15,$16::jsonb,$17,$18
       )`,
      [
        orderCode,
        customerUserId,
        status,
        String(raw.paymentMethod || "Cash on Delivery"),
        String(raw.paymentStatus || "Unpaid"),
        subtotalMinor,
        discountMinor,
        finalMinor,
        minor(raw.amountPaid),
        minor(raw.amountRefunded),
        JSON.stringify(raw.promotionType || raw.discount ? { type: raw.promotionType || "", percent: num(raw.discount) } : null),
        JSON.stringify(contact),
        JSON.stringify(address),
        String(raw.deliveryNotes || ""),
        String(raw.orderSource || "Manual"),
        JSON.stringify(raw),
        deliveredAt,
        Boolean(raw.isArchived || raw.isDeleted),
      ],
    );
  }

  private async resolveCustomer(
    client: PoolClient,
    contact: Record<string, string>,
  ): Promise<string> {
    const email = String(contact.email || "").trim().toLowerCase();
    const phone = String(contact.phone1 || "").trim();
    const found = await client.query<{ user_id: string }>(
      `SELECT user_id FROM customers
        WHERE ($1 <> '' AND lower(email)=lower($1))
           OR ($2 <> '' AND (phone_primary=$2 OR phone_secondary=$2))
        ORDER BY created_at
        LIMIT 1`,
      [email, phone],
    );
    if (found.rows[0]) return found.rows[0].user_id;
    throw new AppError(
      422,
      "ORDER_CUSTOMER_REQUIRED",
      "Manual orders must reference an existing customer account before they can be synchronized",
    );
  }
}
