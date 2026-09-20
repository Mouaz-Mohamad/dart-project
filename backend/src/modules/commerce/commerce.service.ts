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

interface AdminOrderSnapshot {
  itemId?: string;
  itemCode?: string;
  modelCode?: string;
  name?: string;
  color?: string;
  size?: string;
  qty?: number;
  originalUnitPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  finalUnitPrice?: number;
  costSnapshot?: number;
}

interface AdminOrderRow {
  id: string;
  order_code: string;
  status: string;
  created_at: Date | string;
  delivered_at: Date | string | null;
  client_code: string | null;
  contact_snapshot: Record<string, unknown> | null;
  delivery_address: Record<string, unknown> | null;
  item_rows: AdminOrderSnapshot[] | null;
  subtotal_minor: string | number;
  order_discount_minor: string | number;
  final_minor: string | number;
  payment_method: string;
  payment_status: string;
  amount_paid_minor: string | number;
  amount_refunded_minor: string | number;
  promotion: Record<string, unknown> | null;
  delivery_notes: string;
  order_source: string;
  is_archived: boolean;
  is_deleted: boolean;
  version: string | number;
  legacy: Record<string, unknown> | null;
  representative_user_id: string | null;
  representative_code: string | null;
  representative_name: string | null;
  representative_phone: string | null;
  delivery_started_at: Date | string | null;
  courier_latitude: number | null;
  courier_longitude: number | null;
  courier_accuracy_meters: number | null;
  courier_location_updated_at: Date | string | null;
}

function normalized(value: string): string {
  return String(value || "").trim();
}

function distanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const firstLat = radians(latitude1);
  const secondLat = radians(latitude2);
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLat) *
      Math.cos(secondLat) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
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

function birthdayWindow(
  birthday: string | null | undefined,
  reference = new Date(),
): { year: number; startsAt: string; expiresAt: string } | null {
  const match = String(birthday || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const today = cairoDateKey(reference).split("-").map(Number);
  const currentYear = today[0]!;
  const todayUtc = Date.UTC(today[0]!, today[1]! - 1, today[2]!);
  const month = Number(match[1]);
  const day = Number(match[2]);
  for (const year of [currentYear, currentYear - 1]) {
    const start = Date.UTC(year, month - 1, day);
    const end = start + 7 * 86_400_000;
    if (todayUtc >= start && todayUtc < end) {
      const key = (value: number) => new Date(value).toISOString().slice(0, 10);
      return { year, startsAt: key(start), expiresAt: key(end) };
    }
  }
  return null;
}

function flexibleDateExpiry(value: unknown): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const parts = text.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [a, b, d] = parts;
  const year = a! > 999 ? a! : d!;
  const month = b!;
  const day = a! > 999 ? d! : a!;
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
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
      const settings = settingsResult.rows[0]?.data || {};
      const siteDiscountPercent = activeSiteDiscountPercent(settings);

      const customerPromotionResult = await client.query<{
        client_code: string;
        birthday: string | null;
      }>(
        "SELECT client_code, birthday::text FROM customers WHERE user_id=$1 FOR SHARE",
        [customerUserId],
      );
      const customerPromotion = customerPromotionResult.rows[0];
      if (!customerPromotion) {
        throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
      }

      const promotionStatesResult = await client.query<{
        domain: string;
        version: string;
        data: unknown[];
      }>(
        `SELECT domain, version::text, data
           FROM dashboard_domain_state
          WHERE domain IN ('birthday_rewards','cards')
          FOR UPDATE`,
      );
      const promotionStates = new Map(
        promotionStatesResult.rows.map((row) => [
          row.domain,
          {
            version: Number(row.version || 1),
            data: Array.isArray(row.data) ? row.data : [],
          },
        ]),
      );
      const birthdayState = promotionStates.get("birthday_rewards");
      const cardState = promotionStates.get("cards");
      if (!birthdayState || !cardState) {
        throw new AppError(500, "PROMOTION_STATE_MISSING", "Promotion state is not initialized");
      }

      let promotion: Record<string, unknown> | null = null;
      let promotionPercent = 0;
      let birthdayReward: Record<string, unknown> | null = null;
      let appliedCard: Record<string, unknown> | null = null;

      const birthday = birthdayWindow(customerPromotion.birthday);
      if (birthday) {
        const rewardId = `BDAY-${customerPromotion.client_code}-${birthday.year}`;
        birthdayReward = (birthdayState.data as Record<string, unknown>[]).find(
          (row) => String(row.id || "") === rewardId,
        ) || null;
        if (!birthdayReward) {
          birthdayReward = {
            id: rewardId,
            customerId: customerPromotion.client_code,
            type: "Birthday",
            discountPercent: Math.min(
              100,
              Math.max(0, Number(settings.birthdayDiscountPercent) || 30),
            ),
            startsAt: birthday.startsAt,
            expiresAt: birthday.expiresAt,
            status: "Active",
            usedCount: 0,
            createdAt: new Date().toISOString(),
          };
          birthdayState.data.unshift(birthdayReward);
        }
        if (String(birthdayReward.status || "Active") === "Active") {
          promotionPercent = Math.min(
            100,
            Math.max(0, Number(birthdayReward.discountPercent) || 30),
          );
          promotion = {
            type: "Birthday",
            percent: promotionPercent,
            rewardId,
          };
        }
      }

      if (!promotion && siteDiscountPercent > 0) {
        promotionPercent = siteDiscountPercent;
        promotion = { type: "Site", percent: promotionPercent };
      }

      if (!promotion) {
        const nowMs = Date.now();
        appliedCard = (cardState.data as Record<string, unknown>[]).find((row) => {
          if (
            String(row.clientId || "") !== customerPromotion.client_code ||
            String(row.status || "") !== "Active" ||
            Boolean(row.isArchived) ||
            Boolean(row.isDeleted)
          ) return false;
          const limit = Number(row.itemLimit || row.purchasedLimit || 10);
          const used = Number(row.purchasedItems || 0);
          const reserved = Number(row.reservedItems || 0);
          const expiry = flexibleDateExpiry(row.expDate);
          return (
            limit - used - reserved >= itemResult.rows.length &&
            (!expiry || expiry >= nowMs)
          );
        }) || null;
        if (appliedCard) {
          promotionPercent = Math.min(
            100,
            Math.max(
              0,
              Number(appliedCard.discountPercent ?? settings.dartCardDiscountPercent) || 40,
            ),
          );
          promotion = {
            type: "Dart Card",
            percent: promotionPercent,
            cardId: String(appliedCard.cardId || appliedCard.id || ""),
          };
        }
      }

      let subtotalMinor = 0;
      let finalMinor = 0;
      const itemSnapshots = itemResult.rows.map((row) => {
        const sellingMinor = Number(row.selling_minor);
        const modelDiscountPercent = Number(row.discount_percent || 0);
        const effectiveDiscountPercent = promotionPercent || modelDiscountPercent;
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
          JSON.stringify({
            reservationId: input.reservationId,
            birthdayRewardId: promotion?.type === "Birthday" ? promotion.rewardId : "",
            dartCardId: promotion?.type === "Dart Card" ? promotion.cardId : "",
          }),
        ],
      );
      const order = orderResult.rows[0]!;

      if (promotion?.type === "Birthday" && birthdayReward) {
        birthdayReward.status = "Reserved";
        birthdayReward.orderId = order.order_code;
        birthdayReward.reservedAt = new Date().toISOString();
        await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb, version=$3, updated_at=now()
            WHERE domain=$1`,
          [
            "birthday_rewards",
            JSON.stringify(birthdayState.data),
            birthdayState.version + 1,
          ],
        );
      }

      if (promotion?.type === "Dart Card" && appliedCard) {
        const reservedItems = Number(appliedCard.reservedItems || 0) + itemResult.rows.length;
        appliedCard.reservedItems = reservedItems;
        const reservedOrders = Array.isArray(appliedCard.reservedOrders)
          ? appliedCard.reservedOrders as Record<string, unknown>[]
          : [];
        reservedOrders.push({
          orderId: order.order_code,
          itemCount: itemResult.rows.length,
          itemCodes: itemResult.rows.map((row) => row.item_code),
          reservedAt: new Date().toISOString(),
        });
        appliedCard.reservedOrders = reservedOrders;
        await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb, version=$3, updated_at=now()
            WHERE domain=$1`,
          [
            "cards",
            JSON.stringify(cardState.data),
            cardState.version + 1,
          ],
        );
      }

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
            snapshot.effectiveDiscountPercent,
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
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );
      await client.query("COMMIT");

      return {
        id: order.id,
        orderId: order.order_code,
        status: "New",
        createdAt: order.created_at.toISOString(),
        totalProducts: itemSnapshots.length,
        totalPrice: subtotalMinor / 100,
        discount: promotionPercent,
        orderLevelDiscountAmount: orderDiscountMinor / 100,
        finalAmount: finalMinor / 100,
        promotionType: promotion?.type || "",
        birthdayRewardId: promotion?.type === "Birthday" ? String(promotion.rewardId || "") : "",
        dartCardId: promotion?.type === "Dart Card" ? String(promotion.cardId || "") : "",
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

  public async representativeWork(
    representativeUserId: string,
  ): Promise<{ orders: Record<string, unknown>[]; returns: Record<string, unknown>[] }> {
    const ordersResult = await this.pool.query<{
      id: string;
      order_code: string;
      status: string;
      payment_method: string;
      payment_status: string;
      final_minor: string;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      delivery_notes: string;
      created_at: Date;
      delivery_started_at: Date | null;
      item_rows: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id::text, o.order_code, o.status, o.payment_method, o.payment_status,
              o.final_minor::text, o.contact_snapshot, o.delivery_address,
              o.delivery_notes, o.created_at, o.delivery_started_at,
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
                    'finalUnitPrice', oi.final_unit_minor / 100.0
                  )
                  ORDER BY oi.created_at
                )
                FROM order_items oi
                WHERE oi.order_id=o.id
              ), '[]'::jsonb) AS item_rows
         FROM orders o
        WHERE o.representative_user_id=$1
          AND NOT o.is_deleted
          AND NOT o.is_archived
          AND o.status NOT IN ('Delivered','Refused','Cancelled','Returned')
        ORDER BY o.created_at`,
      [representativeUserId],
    );

    const representative = await this.pool.query<{ representative_code: string }>(
      "SELECT representative_code FROM representatives WHERE user_id=$1",
      [representativeUserId],
    );
    const repCode = representative.rows[0]?.representative_code || "";
    const returnsState = await this.pool.query<{ data: unknown[] }>(
      "SELECT data FROM dashboard_domain_state WHERE domain='returns'",
    );
    const returns = (Array.isArray(returnsState.rows[0]?.data)
      ? returnsState.rows[0]!.data
      : []
    ).filter((raw) => {
      const row = raw as Record<string, unknown>;
      return (
        [representativeUserId, repCode].includes(String(row.representativeId || "")) &&
        !row.isDeleted &&
        !row.isArchived &&
        ["Representative Assigned", "Pickup On The Way"].includes(String(row.status || ""))
      );
    }) as Record<string, unknown>[];

    return {
      orders: ordersResult.rows.map((row) => {
        const contact = row.contact_snapshot || {};
        const address = row.delivery_address || {};
        return {
          id: row.id,
          orderId: row.order_code,
          status: row.status,
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          finalAmount: Number(row.final_minor) / 100,
          clientName: contact.name || "Customer",
          phone1: contact.phone1 || "",
          phone2: contact.phone2 || "",
          email: contact.email || "",
          country: address.country || "",
          governorate: address.governorate || "",
          area: address.area || "",
          street: address.street || "",
          building: address.building || "",
          floor: address.floor || "",
          latitude: address.latitude || "",
          longitude: address.longitude || "",
          fullAddress: address.fullAddress || "",
          deliveryNotes: row.delivery_notes,
          createdAt: row.created_at.toISOString(),
          deliveryStartedAt: row.delivery_started_at?.toISOString() || null,
          priceSnapshot: row.item_rows || [],
          items: (row.item_rows || []).map((item) => item.itemCode),
        };
      }),
      returns,
    };
  }

  public async updateRepresentativeLocation(
    representativeUserId: string,
    latitude: number,
    longitude: number,
    accuracyMeters: number | null,
  ): Promise<{ updatedAt: string }> {
    const active = await this.pool.query(
      `SELECT 1
         FROM orders
        WHERE representative_user_id=$1
          AND status='Representative On The Way'
          AND NOT is_deleted
        LIMIT 1`,
      [representativeUserId],
    );
    const activeReturns = await this.pool.query<{ data: unknown[] }>(
      "SELECT data FROM dashboard_domain_state WHERE domain='returns'",
    );
    const repCodeResult = await this.pool.query<{ representative_code: string }>(
      "SELECT representative_code FROM representatives WHERE user_id=$1 AND approval_status='approved'",
      [representativeUserId],
    );
    const repCode = repCodeResult.rows[0]?.representative_code || "";
    const hasActiveReturn = (Array.isArray(activeReturns.rows[0]?.data)
      ? activeReturns.rows[0]!.data
      : []
    ).some((raw) => {
      const row = raw as Record<string, unknown>;
      return (
        [representativeUserId, repCode].includes(String(row.representativeId || "")) &&
        String(row.status || "") === "Pickup On The Way"
      );
    });
    if (!active.rowCount && !hasActiveReturn) {
      throw new AppError(409, "NO_ACTIVE_TRIP", "Start an assigned delivery or pickup before sharing location");
    }

    const result = await this.pool.query<{ updated_at: Date }>(
      `INSERT INTO representative_locations (
         representative_user_id, latitude, longitude, accuracy_meters, updated_at
       ) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (representative_user_id) DO UPDATE SET
         latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude,
         accuracy_meters=EXCLUDED.accuracy_meters,
         updated_at=now()
       RETURNING updated_at`,
      [representativeUserId, latitude, longitude, accuracyMeters],
    );
    return { updatedAt: result.rows[0]!.updated_at.toISOString() };
  }

  public async representativeOrderAction(
    representativeUserId: string,
    orderCode: string,
    action: "start" | "cancel" | "delivered",
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query<{
        id: string;
        status: string;
        promotion: Record<string, unknown> | null;
        delivery_address: Record<string, unknown>;
        payment_method: string;
        final_minor: string;
      }>(
        `SELECT id::text, status, promotion, delivery_address,
                payment_method, final_minor::text
           FROM orders
          WHERE order_code=$1
            AND representative_user_id=$2
            AND NOT is_deleted
          FOR UPDATE`,
        [orderCode, representativeUserId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        throw new AppError(404, "ASSIGNED_ORDER_NOT_FOUND", "This order is not assigned to your account");
      }

      let nextStatus: string;
      if (action === "start") {
        if (!["Out With Representative", "Representative On The Way"].includes(order.status)) {
          throw new AppError(409, "ORDER_STATE_INVALID", "This delivery cannot be started from its current status");
        }
        nextStatus = "Representative On The Way";
      } else if (action === "cancel") {
        if (order.status !== "Representative On The Way") {
          throw new AppError(409, "ORDER_STATE_INVALID", "This delivery is not currently active");
        }
        nextStatus = "Out With Representative";
      } else {
        if (order.status !== "Representative On The Way") {
          throw new AppError(409, "ORDER_STATE_INVALID", "Start delivery before confirming it");
        }
        const locationResult = await client.query<{
          latitude: number;
          longitude: number;
          updated_at: Date;
        }>(
          `SELECT latitude, longitude, updated_at
             FROM representative_locations
            WHERE representative_user_id=$1
            FOR UPDATE`,
          [representativeUserId],
        );
        const location = locationResult.rows[0];
        if (!location || Date.now() - location.updated_at.getTime() > 2 * 60_000) {
          throw new AppError(409, "LOCATION_STALE", "Refresh your location before confirming delivery");
        }
        const destinationLat = Number(order.delivery_address?.latitude);
        const destinationLng = Number(order.delivery_address?.longitude);
        if (
          !Number.isFinite(destinationLat) ||
          !Number.isFinite(destinationLng) ||
          !destinationLat ||
          !destinationLng
        ) {
          throw new AppError(409, "DELIVERY_COORDINATES_MISSING", "Customer delivery coordinates are missing");
        }
        const distance = distanceKm(
          location.latitude,
          location.longitude,
          destinationLat,
          destinationLng,
        );
        if (distance > 1) {
          throw new AppError(
            409,
            "DELIVERY_TOO_FAR",
            `You must be within 1 km of the delivery address; current distance is ${distance.toFixed(2)} km`,
          );
        }
        nextStatus = "Delivered";
      }

      await client.query(
        `UPDATE orders SET
           status=$2,
           delivery_started_at=CASE
             WHEN $2='Representative On The Way'
               THEN COALESCE(delivery_started_at, now())
             ELSE NULL
           END,
           delivered_at=CASE WHEN $2='Delivered' THEN now() ELSE NULL END,
           payment_status=CASE
             WHEN $2='Delivered' AND lower(payment_method) LIKE '%cash%' THEN 'Paid'
             ELSE payment_status
           END,
           amount_paid_minor=CASE
             WHEN $2='Delivered' AND lower(payment_method) LIKE '%cash%' THEN final_minor
             WHEN $2<>'Delivered' AND lower(payment_method) LIKE '%cash%' THEN 0
             ELSE amount_paid_minor
           END,
           version=version+1,
           updated_at=now()
         WHERE id=$1`,
        [order.id, nextStatus],
      );
      await this.applyOrderStatusTransition(
        client,
        order.id,
        orderCode,
        order.status,
        nextStatus,
        order.promotion,
        representativeUserId,
        "representative",
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, metadata
         ) VALUES ('representative',$1,$2,'orders',$3,$4::jsonb)`,
        [
          representativeUserId,
          `REPRESENTATIVE_ORDER_${action.toUpperCase()}`,
          orderCode,
          JSON.stringify({ from: order.status, to: nextStatus }),
        ],
      );
      await client.query("COMMIT");
      return {
        orderId: orderCode,
        status: nextStatus,
        finalAmount: Number(order.final_minor) / 100,
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
    const result = await this.pool.query<AdminOrderRow>(
      `SELECT o.*, c.client_code,
          r.user_id::text AS representative_user_id,
          r.representative_code,
          r.full_name AS representative_name,
          (
            SELECT p.phone_display
              FROM account_phones p
             WHERE p.user_id=r.user_id
               AND p.account_type='representative'
             ORDER BY p.is_primary DESC, p.created_at
             LIMIT 1
          ) AS representative_phone,
          rl.latitude AS courier_latitude,
          rl.longitude AS courier_longitude,
          rl.accuracy_meters AS courier_accuracy_meters,
          rl.updated_at AS courier_location_updated_at,
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
        LEFT JOIN representatives r ON r.user_id=o.representative_user_id
        LEFT JOIN representative_locations rl ON rl.representative_user_id=r.user_id
        ORDER BY o.created_at DESC`,
    );
    return {
      version: Number(versionResult.rows[0]?.version || 1),
      orders: result.rows.map((row) => {
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
          items: snapshots.length ? snapshots.map((line) => line.itemCode) : legacy.items || [],
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
          birthdayRewardId: row.promotion?.type === "Birthday"
            ? String(row.promotion?.rewardId || legacy.birthdayRewardId || "")
            : String(legacy.birthdayRewardId || ""),
          dartCardId: row.promotion?.type === "Dart Card"
            ? String(row.promotion?.cardId || legacy.dartCardId || "")
            : String(legacy.dartCardId || ""),
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
          representativeId: row.representative_user_id || "",
          representativeBusinessId: row.representative_code || "",
          representativeName: row.representative_name || "",
          representativePhone: row.representative_phone || "",
          deliveryStartedAt: row.delivery_started_at || legacy.deliveryStartedAt || null,
          courierLocation:
            row.status === "Representative On The Way" &&
            row.courier_latitude !== null &&
            row.courier_longitude !== null
              ? {
                  lat: row.courier_latitude,
                  lng: row.courier_longitude,
                  accuracy: row.courier_accuracy_meters,
                  updatedAt: row.courier_location_updated_at,
                }
              : null,
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
        const existingOrderResult = await client.query<{
          id: string;
          status: string;
          promotion: Record<string, unknown> | null;
        }>(
          "SELECT id::text, status, promotion FROM orders WHERE order_code=$1 FOR UPDATE",
          [orderCode],
        );
        const existingOrder = existingOrderResult.rows[0] || null;
        const clientCode = String(raw.clientId || "").trim();
        const customerResult = clientCode
          ? await client.query<{ user_id: string }>(
              "SELECT user_id FROM customers WHERE client_code=$1",
              [clientCode],
            )
          : { rows: [] as { user_id: string }[] };
        const customerUserId = customerResult.rows[0]?.user_id || null;
        const representativeRef = String(
          raw.representativeId || raw.representativeBusinessId || "",
        ).trim();
        const representativeResult = representativeRef
          ? await client.query<{ user_id: string }>(
              `SELECT user_id::text
                 FROM representatives
                WHERE user_id::text=$1 OR representative_code=$1
                LIMIT 1`,
              [representativeRef],
            )
          : { rows: [] as { user_id: string }[] };
        const representativeUserId = representativeResult.rows[0]?.user_id || null;
        const deliveryStartedAt =
          status === "Representative On The Way"
            ? String(raw.deliveryStartedAt || raw.representativeOnWayAt || new Date().toISOString())
            : null;
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
          ? {
              type: String(raw.promotionType),
              percent: Number(raw.discount || 0),
              ...(String(raw.promotionType) === "Birthday"
                ? { rewardId: String(raw.birthdayRewardId || existingOrder?.promotion?.rewardId || "") }
                : {}),
              ...(String(raw.promotionType) === "Dart Card"
                ? { cardId: String(raw.dartCardId || existingOrder?.promotion?.cardId || "") }
                : {}),
            }
          : existingOrder?.promotion || null;
        const deliveredAt = status === "Delivered"
          ? String(raw.deliveredAt || new Date().toISOString())
          : null;

        const upserted = await client.query<{ id: string }>(
          `INSERT INTO orders (
             order_code, customer_user_id, status, payment_method, payment_status,
             subtotal_minor, order_discount_minor, final_minor,
             amount_paid_minor, amount_refunded_minor, promotion, contact_snapshot,
             delivery_address, delivery_notes, order_source, representative_user_id,
             delivery_started_at, is_archived, is_deleted, legacy,
             created_at, updated_at, delivered_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,
             $17::timestamptz,$18,$19,$20::jsonb,COALESCE($21::timestamptz,now()),now(),$22::timestamptz
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
             representative_user_id=EXCLUDED.representative_user_id,
             delivery_started_at=EXCLUDED.delivery_started_at,
             is_archived=EXCLUDED.is_archived,
             is_deleted=EXCLUDED.is_deleted,
             legacy=EXCLUDED.legacy,
             delivered_at=EXCLUDED.delivered_at,
             version=orders.version+1,
             updated_at=now()
           RETURNING id::text`,
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
            representativeUserId,
            deliveryStartedAt,
            Boolean(raw.isArchived),
            Boolean(raw.isDeleted),
            JSON.stringify(raw),
            raw.createdAt ? String(raw.createdAt) : null,
            deliveredAt,
          ],
        );
        const orderDbId = upserted.rows[0]?.id;
        if (orderDbId) {
          await this.applyOrderStatusTransition(
            client,
            orderDbId,
            orderCode,
            existingOrder?.status || null,
            status,
            promotion,
            actorId,
          );
        }
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

  private async applyOrderStatusTransition(
    client: PoolClient,
    orderId: string,
    orderCode: string,
    previousStatus: string | null,
    nextStatus: string,
    promotion: Record<string, unknown> | null,
    actorId: string,
    actorType: "staff" | "representative" = "staff",
  ): Promise<void> {
    if (previousStatus === nextStatus) return;

    const itemRows = await client.query<{ item_code: string }>(
      "SELECT item_code FROM order_items WHERE order_id=$1 ORDER BY created_at, id",
      [orderId],
    );
    const itemCodes = itemRows.rows.map((row) => row.item_code);
    const itemCount = itemCodes.length;

    let inventoryChanged = 0;
    if (nextStatus === "Delivered") {
      const updated = await client.query(
        `UPDATE inventory_items i
            SET status='Sold',
                purchase_date=$2,
                order_id=$1,
                version=version+1,
                updated_at=now()
           FROM order_items oi
          WHERE oi.order_id=$3
            AND oi.inventory_item_id=i.id`,
        [orderCode, new Date().toISOString().slice(0, 10), orderId],
      );
      inventoryChanged = updated.rowCount ?? 0;
    } else if (["Cancelled", "Refused"].includes(nextStatus)) {
      const updated = await client.query(
        `UPDATE inventory_items i
            SET status='In stock',
                purchase_date=NULL,
                order_id=NULL,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
           FROM order_items oi
          WHERE oi.order_id=$1
            AND oi.inventory_item_id=i.id`,
        [orderId],
      );
      inventoryChanged = updated.rowCount ?? 0;
    } else if (
      ["New","Accepted","Preparing","Out With Representative","Representative On The Way","Needs Attention"].includes(nextStatus)
    ) {
      const updated = await client.query(
        `UPDATE inventory_items i
            SET status='Processing/Held',
                purchase_date=NULL,
                order_id=$2,
                version=version+1,
                updated_at=now()
           FROM order_items oi
          WHERE oi.order_id=$1
            AND oi.inventory_item_id=i.id`,
        [orderId, orderCode],
      );
      inventoryChanged = updated.rowCount ?? 0;
    }

    if (inventoryChanged > 0) {
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
    }

    const promotionType = String(promotion?.type || "");
    if (promotionType === "Birthday" && promotion?.rewardId) {
      const stateResult = await client.query<{ version: string; data: unknown[] }>(
        "SELECT version::text, data FROM dashboard_domain_state WHERE domain='birthday_rewards' FOR UPDATE",
      );
      const state = stateResult.rows[0];
      const data = Array.isArray(state?.data) ? state.data as Record<string, unknown>[] : [];
      const reward = data.find((row) => String(row.id || "") === String(promotion.rewardId));
      if (reward) {
        if (nextStatus === "Delivered") {
          reward.status = "Used";
          reward.usedCount = 1;
          reward.usedAt = new Date().toISOString();
          reward.orderId = orderCode;
        } else if (["Cancelled", "Refused"].includes(nextStatus)) {
          reward.status = String(reward.expiresAt || "") > cairoDateKey() ? "Active" : "Expired";
          reward.usedCount = 0;
          reward.usedAt = null;
          reward.orderId = "";
          reward.reservedAt = null;
        } else if (previousStatus === "Delivered" || ["Cancelled", "Refused"].includes(String(previousStatus || ""))) {
          reward.status = "Reserved";
          reward.usedCount = 0;
          reward.usedAt = null;
          reward.orderId = orderCode;
          reward.reservedAt = new Date().toISOString();
        }
        await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb, version=$3, updated_at=now()
            WHERE domain='birthday_rewards'`,
          [JSON.stringify(data), Number(state?.version || 1) + 1],
        );
      }
    }

    if (promotionType === "Dart Card" && promotion?.cardId) {
      const stateResult = await client.query<{ version: string; data: unknown[] }>(
        "SELECT version::text, data FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE",
      );
      const state = stateResult.rows[0];
      const data = Array.isArray(state?.data) ? state.data as Record<string, unknown>[] : [];
      const card = data.find(
        (row) => String(row.cardId || row.id || "") === String(promotion.cardId),
      );
      if (card) {
        const reservations = Array.isArray(card.reservedOrders)
          ? card.reservedOrders as Record<string, unknown>[]
          : [];
        const reservation = reservations.find((row) => String(row.orderId || "") === orderCode);
        const reservedCount = Number(reservation?.itemCount || itemCount || 0);
        const removeReservation = () => {
          card.reservedOrders = reservations.filter((row) => String(row.orderId || "") !== orderCode);
          card.reservedItems = Math.max(0, Number(card.reservedItems || 0) - reservedCount);
        };

        if (nextStatus === "Delivered" && previousStatus !== "Delivered") {
          removeReservation();
          card.purchasedItems = String(Number(card.purchasedItems || 0) + reservedCount);
          card.requestedProducts = [
            ...new Set([...(Array.isArray(card.requestedProducts) ? card.requestedProducts : []), ...itemCodes]),
          ];
        } else if (["Cancelled", "Refused"].includes(nextStatus)) {
          removeReservation();
          if (previousStatus === "Delivered") {
            card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - itemCount));
          }
        } else if (previousStatus === "Delivered" && nextStatus !== "Delivered") {
          card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - itemCount));
          if (!reservations.some((row) => String(row.orderId || "") === orderCode)) {
            reservations.push({
              orderId: orderCode,
              itemCount,
              itemCodes,
              reservedAt: new Date().toISOString(),
            });
            card.reservedOrders = reservations;
            card.reservedItems = Number(card.reservedItems || 0) + itemCount;
          }
        }

        const limit = Number(card.itemLimit || card.purchasedLimit || 10);
        const expiry = flexibleDateExpiry(card.expDate);
        const unavailable =
          Number(card.purchasedItems || 0) >= limit ||
          Boolean(expiry && expiry < Date.now());
        card.status = unavailable ? "Expired" : "Active";

        await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb, version=$3, updated_at=now()
            WHERE domain='cards'`,
          [JSON.stringify(data), Number(state?.version || 1) + 1],
        );
      }
    }

    await client.query(
      `INSERT INTO order_events (
         order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
       ) VALUES ($1,'STATUS_CHANGED',$2,$3,$4,$5,$6::jsonb)`,
      [
        orderId,
        previousStatus,
        nextStatus,
        actorType,
        actorId,
        JSON.stringify({ orderCode }),
      ],
    );
  }

  public async customerSnapshot(customerUserId: string): Promise<{
    orders: Record<string, unknown>[];
    returns: unknown[];
    cards: unknown[];
    birthdayRewards: unknown[];
    birthdayMessages: unknown[];
  }> {
    const customerResult = await this.pool.query<{ client_code: string }>(
      "SELECT client_code FROM customers WHERE user_id=$1",
      [customerUserId],
    );
    const clientCode = customerResult.rows[0]?.client_code;
    if (!clientCode) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");

    const ordersResult = await this.pool.query<{
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
      created_at: Date;
      updated_at: Date;
      delivered_at: Date | null;
      delivery_started_at: Date | null;
      representative_user_id: string | null;
      representative_code: string | null;
      representative_name: string | null;
      representative_phone: string | null;
      courier_latitude: number | null;
      courier_longitude: number | null;
      courier_accuracy_meters: number | null;
      courier_updated_at: Date | null;
      items: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id, o.order_code, o.status, o.payment_method, o.payment_status,
              o.subtotal_minor::text, o.order_discount_minor::text, o.final_minor::text,
              o.amount_paid_minor::text, o.amount_refunded_minor::text, o.promotion,
              o.contact_snapshot, o.delivery_address, o.delivery_notes,
              o.created_at, o.updated_at, o.delivered_at, o.delivery_started_at,
              r.user_id::text AS representative_user_id,
              r.representative_code,
              r.full_name AS representative_name,
              rp.phone_display AS representative_phone,
              rl.latitude AS courier_latitude,
              rl.longitude AS courier_longitude,
              rl.accuracy_meters AS courier_accuracy_meters,
              rl.updated_at AS courier_updated_at,
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
         LEFT JOIN representatives r ON r.user_id=o.representative_user_id
         LEFT JOIN representative_locations rl ON rl.representative_user_id=r.user_id
         LEFT JOIN LATERAL (
           SELECT p.phone_display
             FROM account_phones p
            WHERE p.user_id=r.user_id
              AND p.account_type='representative'
            ORDER BY p.is_primary DESC, p.created_at
            LIMIT 1
         ) rp ON true
        WHERE o.customer_user_id=$1 AND NOT o.is_deleted
        GROUP BY o.id, r.user_id, r.representative_code, r.full_name,
                 rp.phone_display, rl.latitude, rl.longitude,
                 rl.accuracy_meters, rl.updated_at
        ORDER BY o.created_at DESC`,
      [customerUserId],
    );

    const states = await this.pool.query<{ domain: string; data: unknown[] }>(
      "SELECT domain, data FROM dashboard_domain_state WHERE domain IN ('returns','cards','birthday_rewards','birthday_messages')",
    );
    const stateByDomain = new Map(states.rows.map((row) => [row.domain, Array.isArray(row.data) ? row.data : []]));
    const onlyCustomer = (rows: unknown[]) => rows.filter((raw) => {
      const row = raw as Record<string, unknown>;
      return String(row.clientId || row.customerId || "") === clientCode && !row.isDeleted;
    });

    const orders = ordersResult.rows.map((row) => {
      const subtotal = Number(row.subtotal_minor) / 100;
      const discountAmount = Number(row.order_discount_minor) / 100;
      const contact = row.contact_snapshot || {};
      const address = row.delivery_address || {};
      return {
        id: row.id,
        orderId: row.order_code,
        clientId: clientCode,
        status: row.status,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        totalPrice: subtotal,
        orderLevelDiscountAmount: discountAmount,
        finalAmount: Number(row.final_minor) / 100,
        amountPaid: Number(row.amount_paid_minor) / 100,
        amountRefunded: Number(row.amount_refunded_minor) / 100,
        discount: Number(row.promotion?.percent || 0),
        promotionType: String(row.promotion?.type || ""),
        birthdayRewardId: row.promotion?.type === "Birthday" ? String(row.promotion?.rewardId || "") : "",
        dartCardId: row.promotion?.type === "Dart Card" ? String(row.promotion?.cardId || "") : "",
        priceSnapshot: row.items,
        items: row.items.map((item) => item.itemCode),
        totalProducts: row.items.length,
        name: contact.name || "",
        phone1: contact.phone1 || "",
        phone2: contact.phone2 || "",
        email: contact.email || "",
        country: address.country || "",
        governorate: address.governorate || "",
        area: address.area || "",
        street: address.street || "",
        building: address.building || "",
        floor: address.floor || "",
        latitude: address.latitude || "",
        longitude: address.longitude || "",
        fullAddress: address.fullAddress || "",
        deliveryNotes: row.delivery_notes,
        representativeId: row.representative_user_id || "",
        representativeBusinessId: row.representative_code || "",
        representativeName: row.representative_name || "",
        representativePhone: row.representative_phone || "",
        deliveryStartedAt: row.delivery_started_at?.toISOString() || null,
        courierLocation:
          row.status === "Representative On The Way" &&
          row.courier_latitude !== null &&
          row.courier_longitude !== null
            ? {
                lat: row.courier_latitude,
                lng: row.courier_longitude,
                accuracy: row.courier_accuracy_meters,
                updatedAt: row.courier_updated_at?.toISOString() || null,
              }
            : null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        ...(row.delivered_at ? { deliveredAt: row.delivered_at.toISOString() } : {}),
      };
    });

    return {
      orders,
      returns: onlyCustomer(stateByDomain.get("returns") || []),
      cards: onlyCustomer(stateByDomain.get("cards") || []),
      birthdayRewards: onlyCustomer(stateByDomain.get("birthday_rewards") || []),
      birthdayMessages: onlyCustomer(stateByDomain.get("birthday_messages") || []),
    };
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
