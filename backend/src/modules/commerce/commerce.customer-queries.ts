// Read-only commerce projections; SQL and returned field shapes are preserved.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { readRelationalDashboardDomain } from "../dashboard/relational-domain.store.js";
import { cairoDateKey, flexibleDateExpiry } from "./commerce.rewards.js";
import { orderBenefit, orderBenefits } from "./commerce.pricing.js";

export async function readPublicLeaderboard(pool: Pool): Promise<{
    period: string;
    rows: Array<{
      rank: number;
      name: string;
      orders: number;
      items: number;
    }>;
  }> {
    const client = await pool.connect();
    try {
      const deliveredResult = await client.query<{
        client_code: string;
        full_name: string;
        order_code: string;
        final_minor: string;
        amount_refunded_minor: string;
        item_codes: string[];
        legacy: Record<string, unknown> | null;
      }>(
        `SELECT COALESCE(
                  NULLIF(c.client_code,''),
                  NULLIF(o.legacy->>'clientId',''),
                  o.customer_user_id::text,
                  o.id::text
                ) AS client_code,
                COALESCE(
                  NULLIF(c.full_name,''),
                  NULLIF(o.contact_snapshot->>'name',''),
                  NULLIF(o.legacy->>'clientName',''),
                  'Dart Customer'
                ) AS full_name,
                o.order_code,
                o.final_minor::text,
                o.amount_refunded_minor::text,
                COALESCE(
                  array_agg(oi.item_code ORDER BY oi.created_at, oi.id)
                    FILTER (WHERE oi.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS item_codes,
                o.legacy
           FROM orders o
           LEFT JOIN customers c ON c.user_id=o.customer_user_id
           LEFT JOIN order_items oi ON oi.order_id=o.id
          WHERE o.status='Delivered'
            AND NOT o.is_deleted
            AND NOT o.is_archived
            AND COALESCE(o.delivered_at, o.updated_at) >=
                (date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo')
            AND COALESCE(o.delivered_at, o.updated_at) <
                ((date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') + interval '1 month') AT TIME ZONE 'Africa/Cairo')
          GROUP BY c.client_code, c.full_name, o.id
          ORDER BY COALESCE(o.delivered_at, o.updated_at), o.order_code`,
      );

      // A single pg PoolClient must execute statements sequentially.
      // Running both reads with Promise.all on the same client triggers pg's
      // "client already executing a query" deprecation warning and can become
      // an error in pg@9, so keep these domain reads intentionally ordered.
      const returnRows = await readRelationalDashboardDomain(client, "returns");
      const cardRows = await readRelationalDashboardDomain(client, "cards");

      const nowMs = Date.now();
      const activeDartCardClients = new Set(
        cardRows
          .map((raw) => raw as Record<string, unknown>)
          .filter((card) => {
            if (
              String(card.status || "").trim().toLowerCase() !== "active" ||
              Boolean(card.isArchived) ||
              Boolean(card.isDeleted)
            ) {
              return false;
            }
            const limit = Math.max(1, Number(card.itemLimit || card.purchasedLimit || 10));
            const purchasedItems = Math.max(0, Number(card.purchasedItems || 0));
            const expiry = flexibleDateExpiry(card.expDate);
            return purchasedItems < limit && (!expiry || expiry >= nowMs);
          })
          .map((card) => String(card.clientId || card.customerId || "").trim())
          .filter(Boolean),
      );

      const completedRefundItems = new Set(
        returnRows
          .map((raw) => raw as Record<string, unknown>)
          .filter((record) => {
            const status = String(record.status || "").trim().toLowerCase();
            const requestType = String(record.requestType || "").trim().toLowerCase();
            const completed = Boolean(
              record.completedAt ||
                ["completed", "good", "damaged", "bad"].includes(status),
            );
            return (
              record.isPostDeliveryReturn === true &&
              !record.isDeleted &&
              requestType !== "exchange" &&
              completed
            );
          })
          .map((record) => String(record.itemCode || ""))
          .filter(Boolean),
      );

      const byCustomer = new Map<
        string,
        {
          name: string;
          orders: number;
          items: number;
          spentMinor: number;
        }
      >();

      for (const order of deliveredResult.rows) {
        const current = byCustomer.get(order.client_code) || {
          name: order.full_name,
          orders: 0,
          items: 0,
          spentMinor: 0,
        };
        current.orders += 1;
        const legacy = order.legacy && typeof order.legacy === "object" ? order.legacy : {};
        const legacyItems = Array.isArray(legacy.items)
          ? legacy.items.map((itemCode) => String(itemCode || "")).filter(Boolean)
          : [];
        const legacySnapshots = Array.isArray(legacy.priceSnapshot)
          ? (legacy.priceSnapshot as Record<string, unknown>[])
              .map((line) => String(line.itemCode || ""))
              .filter(Boolean)
          : [];
        const itemCodes = (order.item_codes || []).length
          ? order.item_codes
          : legacyItems.length
            ? legacyItems
            : legacySnapshots;
        current.items += itemCodes.filter(
          (itemCode) => !completedRefundItems.has(String(itemCode)),
        ).length;
        current.spentMinor += Math.max(
          0,
          Number(order.final_minor || 0) - Number(order.amount_refunded_minor || 0),
        );
        byCustomer.set(order.client_code, current);
      }

      const publicName = (value: string) => {
        const parts = String(value || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3);
        return parts.length ? parts.join(" ") : "Dart Customer";
      };

      const rows = [...byCustomer.entries()]
        .filter(
          ([clientCode, row]) =>
            row.items > 0 && !activeDartCardClients.has(clientCode),
        )
        .sort(
          ([, left], [, right]) =>
            right.items - left.items ||
            right.spentMinor - left.spentMinor ||
            right.orders - left.orders,
        )
        .map(([, row], index) => ({
          rank: index + 1,
          name: publicName(row.name),
          orders: row.orders,
          items: Math.max(0, row.items),
        }));

      return {
        period: cairoDateKey().slice(0, 7),
        rows,
      };
    } finally {
      client.release();
    }
  }

export async function readCustomerLiveTracking(pool: Pool, customerUserId: string): Promise<{
    capturedAt: string;
    orders: Record<string, unknown>[];
    returns: Record<string, unknown>[];
  }> {
    const customerResult = await pool.query<{ client_code: string }>(
      "SELECT client_code FROM customers WHERE user_id=$1",
      [customerUserId],
    );
    const clientCode = customerResult.rows[0]?.client_code;
    if (!clientCode) {
      throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
    }

    const ordersResult = await pool.query<{
      id: string;
      order_code: string;
      status: string;
      delivery_started_at: Date | null;
      representative_user_id: string | null;
      latitude: number | null;
      longitude: number | null;
      accuracy_meters: number | null;
      location_updated_at: Date | null;
    }>(
      `SELECT o.id::text, o.order_code, o.status, o.delivery_started_at,
              o.representative_user_id::text,
              rl.latitude, rl.longitude, rl.accuracy_meters,
              rl.updated_at AS location_updated_at
         FROM orders o
         LEFT JOIN representative_locations rl
           ON rl.representative_user_id=o.representative_user_id
        WHERE o.customer_user_id=$1
          AND o.status='Representative On The Way'
          AND NOT o.is_deleted
          AND NOT o.is_archived
        ORDER BY o.created_at DESC`,
      [customerUserId],
    );

    const returnResult = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload
         FROM return_requests
        WHERE payload->>'clientId'=$1
          AND payload->>'status'='Pickup On The Way'
          AND COALESCE(payload->>'isDeleted','false') <> 'true'
          AND COALESCE(payload->>'isArchived','false') <> 'true'
        ORDER BY position`,
      [clientCode],
    );
    const activeReturns = returnResult.rows.map((row) => row.payload || {});
    const representativeRefs = [
      ...new Set(
        activeReturns.flatMap((record) => [
          String(record.representativeId || "").trim(),
          String(record.representativeBusinessId || "").trim(),
        ]).filter(Boolean),
      ),
    ];

    const returnLocations = representativeRefs.length
      ? await pool.query<{
          user_id: string;
          representative_code: string;
          latitude: number | null;
          longitude: number | null;
          accuracy_meters: number | null;
          location_updated_at: Date | null;
        }>(
          `SELECT r.user_id::text, r.representative_code,
                  rl.latitude, rl.longitude, rl.accuracy_meters,
                  rl.updated_at AS location_updated_at
             FROM representatives r
             LEFT JOIN representative_locations rl
               ON rl.representative_user_id=r.user_id
            WHERE r.user_id::text = ANY($1::text[])
               OR r.representative_code = ANY($1::text[])`,
          [representativeRefs],
        )
      : { rows: [] as Array<{
          user_id: string;
          representative_code: string;
          latitude: number | null;
          longitude: number | null;
          accuracy_meters: number | null;
          location_updated_at: Date | null;
        }> };

    const returnLocationByRepresentative = new Map<string, typeof returnLocations.rows[number]>();
    for (const row of returnLocations.rows) {
      returnLocationByRepresentative.set(String(row.user_id), row);
      returnLocationByRepresentative.set(String(row.representative_code), row);
    }

    const courierLocation = (
      latitude: number | null,
      longitude: number | null,
      accuracy: number | null,
      updatedAt: Date | null,
    ) => latitude !== null && longitude !== null
      ? {
          lat: latitude,
          lng: longitude,
          accuracy,
          updatedAt: updatedAt?.toISOString() || null,
        }
      : null;

    return {
      capturedAt: new Date().toISOString(),
      orders: ordersResult.rows.map((row) => ({
        id: row.id,
        orderId: row.order_code,
        status: row.status,
        deliveryStartedAt: row.delivery_started_at?.toISOString() || null,
        courierLocation: courierLocation(
          row.latitude,
          row.longitude,
          row.accuracy_meters,
          row.location_updated_at,
        ),
      })),
      returns: activeReturns.map((record) => {
        const representative = returnLocationByRepresentative.get(
          String(record.representativeId || record.representativeBusinessId || ""),
        );
        return {
          id: String(record.id || ""),
          returnId: String(record.returnId || ""),
          status: String(record.status || ""),
          pickupStartedAt: record.pickupStartedAt || null,
          courierLocation: representative
            ? courierLocation(
                representative.latitude,
                representative.longitude,
                representative.accuracy_meters,
                representative.location_updated_at,
              )
            : null,
        };
      }),
    };
  }

export async function readCustomerSnapshot(pool: Pool, customerUserId: string): Promise<{
    orders: Record<string, unknown>[];
    returns: unknown[];
    cards: unknown[];
    birthdayRewards: unknown[];
    birthdayMessages: unknown[];
    reviewEligible: boolean;
    purchaseStats: { totalPieces: number; monthlyPieces: number };
    savedAddress: Record<string, unknown> | null;
  }> {
    const customerResult = await pool.query<{ client_code: string }>(
      "SELECT client_code FROM customers WHERE user_id=$1",
      [customerUserId],
    );
    const clientCode = customerResult.rows[0]?.client_code;
    if (!clientCode) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");

    const ordersResult = await pool.query<{
      id: string;
      order_code: string;
      status: string;
      payment_method: string;
      payment_status: string;
      subtotal_minor: string;
      order_discount_minor: string;
      final_minor: string;
      delivery_cost_minor: string;
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
      set_groups: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id, o.order_code, o.status, o.payment_method, o.payment_status,
              o.subtotal_minor::text, o.order_discount_minor::text, o.final_minor::text,
              o.delivery_cost_minor::text, o.amount_paid_minor::text,
              o.amount_refunded_minor::text, o.promotion,
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
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id',osg.id::text,
                  'setId',osg.set_id,
                  'setName',osg.set_name_snapshot,
                  'setImage',osg.set_image_snapshot,
                  'pieceCount',osg.piece_count,
                  'basePrice',osg.set_base_price_minor/100.0,
                  'finalAmount',osg.final_minor/100.0,
                  'discountSource',osg.discount_source,
                  'discountPercent',osg.discount_percent
                ) ORDER BY osg.created_at,osg.id)
                  FROM order_set_groups osg WHERE osg.order_id=o.id
              ),'[]'::jsonb) AS set_groups,
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
                    'discountPercent', oi.discount_percent,
                    'discountAmount', (oi.original_unit_minor - oi.final_unit_minor) / 100.0,
                    'discountSource', oi.discount_source,
                    'discountReference', oi.discount_reference,
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

    const [
      returnRows,
      cardRows,
      birthdayRewardRows,
      birthdayMessageRows,
      preferencesResult,
    ] = await Promise.all([
      readRelationalDashboardDomain(pool, "returns"),
      readRelationalDashboardDomain(pool, "cards"),
      readRelationalDashboardDomain(pool, "birthday_rewards"),
      readRelationalDashboardDomain(pool, "birthday_messages"),
      pool.query<{ last_address: Record<string, unknown> | null }>(
        "SELECT last_address FROM customer_preferences WHERE customer_user_id=$1",
        [customerUserId],
      ),
    ]);
    const stateByDomain = new Map<string, unknown[]>([
      ["returns", returnRows],
      ["cards", cardRows],
      ["birthday_rewards", birthdayRewardRows],
      ["birthday_messages", birthdayMessageRows],
    ]);
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
        deliveryCost: Number(row.delivery_cost_minor || 0) / 100,
        amountPaid: Number(row.amount_paid_minor) / 100,
        amountRefunded: Number(row.amount_refunded_minor) / 100,
        discount: Number(row.promotion?.percent || 0),
        promotionType: String(row.promotion?.type || ""),
        birthdayRewardId: String(orderBenefit(row.promotion, "Birthday")?.rewardId || ""),
        dartCardId: String(orderBenefit(row.promotion, "Dart Card")?.cardId || ""),
        discountBenefits: orderBenefits(row.promotion),
        priceSnapshot: row.items,
        setGroups: row.set_groups || [],
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

    const customerReturns = onlyCustomer(stateByDomain.get("returns") || []);
    const refundedSales = new Set(
      customerReturns
        .filter((raw) => {
          const row = raw as Record<string, unknown>;
          const status = String(row.status || "");
          const completed =
            Boolean(row.completedAt) ||
            ["Completed", "Good", "Damaged", "Bad"].includes(status);
          return String(row.requestType || "") === "Refund" && completed;
        })
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          return JSON.stringify([String(row.orderId || ""), String(row.itemCode || "")]);
        })
        .filter(Boolean),
    );
    const cairoMonthKey = (value: unknown): string => {
      const date = new Date(String(value || ""));
      if (Number.isNaN(date.getTime())) return "";
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(date);
      const year = parts.find((part) => part.type === "year")?.value || "";
      const month = parts.find((part) => part.type === "month")?.value || "";
      return year && month ? `${year}-${month}` : "";
    };
    const currentMonth = cairoMonthKey(new Date());
    const deliveredOrders = orders.filter((order) => order.status === "Delivered");
    const countNetPieces = (rows: typeof deliveredOrders) =>
      rows.reduce(
        (total, order) =>
          total +
          (Array.isArray(order.items) ? order.items : []).filter(
            (itemCode) => !refundedSales.has(JSON.stringify([String(order.orderId), String(itemCode)])),
          ).length,
        0,
      );
    const totalPieces = countNetPieces(deliveredOrders);
    const monthlyPieces = countNetPieces(
      deliveredOrders.filter(
        (order) =>
          cairoMonthKey(order.deliveredAt || order.updatedAt || order.createdAt) ===
          currentMonth,
      ),
    );

    return {
      orders,
      returns: customerReturns,
      cards: onlyCustomer(stateByDomain.get("cards") || []),
      birthdayRewards: onlyCustomer(stateByDomain.get("birthday_rewards") || []),
      birthdayMessages: onlyCustomer(stateByDomain.get("birthday_messages") || []),
      reviewEligible: ordersResult.rows.some((row) => row.status === "Delivered"),
      purchaseStats: { totalPieces, monthlyPieces },
      savedAddress: preferencesResult.rows[0]?.last_address || null,
    };
  }
