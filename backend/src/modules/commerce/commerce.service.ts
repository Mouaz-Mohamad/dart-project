// DART CODE GUIDE | backend/src/modules/commerce/commerce.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { readRelationalDashboardDomain } from "../dashboard/relational-domain.store.js";
import {
  evaluateCodRisk,
  resolveCodRiskPolicy,
  type CodRiskLevel,
  type CodVerificationStatus,
} from "./cod-risk.js";

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
  promotionCode?: string | undefined;
  acceptPriceChanges?: boolean | undefined;
}

interface LockedItem {
  id: string;
  item_code: string;
  model_id: string;
  color: string;
  size: string;
  model_name: string;
  cost_snapshot_minor: string;
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
  cod_risk_level: CodRiskLevel;
  cod_risk_score: string | number;
  cod_risk_reasons: string[] | null;
  cod_refusals_in_window: string | number;
  cod_risk_policy_version: string | number;
  cod_verification_required: boolean;
  cod_verification_status: CodVerificationStatus;
  cod_verification_reason: string;
  cod_verified_at: Date | string | null;
  customer_cod_risk_level: CodRiskLevel | null;
  customer_cod_risk_score: string | number | null;
  customer_cod_refusals_in_window: string | number | null;
  refusal_history: Array<{
    orderId: string;
    refusedAt: Date | string;
    reason: string;
  }> | null;
  created_at: Date | string;
  delivered_at: Date | string | null;
  client_code: string | null;
  contact_snapshot: Record<string, unknown> | null;
  delivery_address: Record<string, unknown> | null;
  item_rows: AdminOrderSnapshot[] | null;
  subtotal_minor: string | number;
  order_discount_minor: string | number;
  final_minor: string | number;
  delivery_cost_minor: string | number;
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

function suggestedStopOrder<T extends { latitude: number; longitude: number }>(
  startLatitude: number | null,
  startLongitude: number | null,
  stops: T[],
): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let latitude = Number.isFinite(startLatitude) ? Number(startLatitude) : null;
  let longitude = Number.isFinite(startLongitude) ? Number(startLongitude) : null;

  while (remaining.length) {
    if (latitude === null || longitude === null) {
      const next = remaining.shift()!;
      ordered.push(next);
      latitude = next.latitude;
      longitude = next.longitude;
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const stop = remaining[index]!;
      const distance = distanceKm(latitude, longitude, stop.latitude, stop.longitude);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next!);
    latitude = next!.latitude;
    longitude = next!.longitude;
  }
  return ordered;
}

function finalModelPriceMinor(sellingMinor: number, discountPercent: number): number {
  return Math.max(0, Math.round(sellingMinor * (1 - Math.min(100, Math.max(0, discountPercent)) / 100)));
}

export function detectCartPriceChanges(
  reservedPricing: Array<Record<string, unknown>>,
  items: Array<Pick<LockedItem, "model_id" | "color" | "size" | "selling_minor" | "discount_percent">>,
  siteDiscountPercent: number,
): Array<Record<string, unknown>> {
  const changes: Array<Record<string, unknown>> = [];
  const currentByVariant = new Map<
    string,
    { discountPercent: number; finalUnitMinor: number }
  >();

  for (const row of items) {
    const key = JSON.stringify([row.model_id, row.color, row.size]);
    if (currentByVariant.has(key)) continue;
    const sellingMinor = Number(row.selling_minor || 0);
    const modelDiscountPercent = Number(row.discount_percent || 0);
    const discountPercent = siteDiscountPercent || modelDiscountPercent;
    currentByVariant.set(key, {
      discountPercent,
      finalUnitMinor: finalModelPriceMinor(sellingMinor, discountPercent),
    });
  }

  for (const snapshot of reservedPricing) {
    const key = JSON.stringify([
      String(snapshot.modelId || ""),
      String(snapshot.color || ""),
      String(snapshot.size || ""),
    ]);
    const current = currentByVariant.get(key);
    if (!current) continue;
    const previousFinalMinor = Number(snapshot.finalUnitMinor || 0);
    if (previousFinalMinor === current.finalUnitMinor) continue;
    changes.push({
      modelId: snapshot.modelId,
      color: snapshot.color,
      size: snapshot.size,
      quantity: Number(snapshot.quantity || 1),
      previousUnitPrice: previousFinalMinor / 100,
      currentUnitPrice: current.finalUnitMinor / 100,
      previousDiscountPercent: Number(snapshot.discountPercent || 0),
      currentDiscountPercent: current.discountPercent,
    });
  }
  return changes;
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

function promotionPercentage(row: Record<string, unknown>): number {
  return Math.min(
    100,
    Math.max(
      0,
      Number(row.percent ?? row.discountPercent ?? row.discount ?? 0) || 0,
    ),
  );
}

function promotionDateActive(row: Record<string, unknown>, today = cairoDateKey()): boolean {
  const startsAt = String(row.startsAt || row.startDate || "").slice(0, 10);
  const endsAt = String(row.endsAt || row.endDate || "").slice(0, 10);
  return (!startsAt || today >= startsAt) && (!endsAt || today <= endsAt);
}

async function customerPurchaseStats(
  client: PoolClient,
  customerUserId: string,
): Promise<{ deliveredOrders: number; deliveredItems: number }> {
  const result = await client.query<{
    delivered_orders: string;
    delivered_items: string;
  }>(
    `SELECT
       count(DISTINCT o.id)::text AS delivered_orders,
       count(oi.id)::text AS delivered_items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.customer_user_id=$1
        AND o.status='Delivered'
        AND NOT o.is_deleted`,
    [customerUserId],
  );
  return {
    deliveredOrders: Number(result.rows[0]?.delivered_orders || 0),
    deliveredItems: Number(result.rows[0]?.delivered_items || 0),
  };
}

function promotionTargetsCustomer(
  row: Record<string, unknown>,
  stats: { deliveredOrders: number; deliveredItems: number },
): boolean {
  const type = String(
    row.targetType || row.targetSegment || row.segment || "all",
  ).trim().toLowerCase();
  const value = Number(row.targetValue ?? row.minimumPurchasedItems ?? row.minPurchasedItems ?? 0);

  if (["", "all", "everyone", "all_customers"].includes(type)) return true;
  if (["zero_orders", "0_orders", "no_orders", "customers_with_0_orders"].includes(type)) {
    return stats.deliveredOrders === 0;
  }
  if (["min_purchased_items", "purchased_items_at_least", "minimum_items"].includes(type)) {
    return stats.deliveredItems >= Math.max(0, value);
  }
  if (["exact_purchased_items", "purchased_items_exact"].includes(type)) {
    return stats.deliveredItems === Math.max(0, value);
  }
  return false;
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


  private async refreshCodRiskForOrder(
    client: PoolClient,
    orderId: string,
    customerUserId: string | null,
    finalMinor: number,
    options: {
      preserveVerification?: boolean;
      actorType?: "system" | "customer" | "staff";
      actorId?: string | null;
      reason?: string;
      requestId?: string | undefined;
    } = {},
  ): Promise<{
    riskLevel: CodRiskLevel;
    riskScore: number;
    riskReasons: string[];
    verificationRequired: boolean;
    verificationStatus: CodVerificationStatus;
    policyVersion: number;
    refusalsInWindow: number;
    changed: boolean;
  }> {
    const settingsResult = await client.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM site_settings WHERE id='main'",
    );
    const settings = settingsResult.rows[0]?.data || {};
    const policy = resolveCodRiskPolicy(settings.codRisk);

    let priorOrderCount = 0;
    let refusalsInWindow = 0;
    let recentPriorOrders = 0;
    let verifiedPhone = false;

    if (customerUserId) {
      const statsResult = await client.query<{
        prior_orders: string;
        refusals_in_window: string;
        recent_prior_orders: string;
        verified_phone: boolean;
      }>(
        `SELECT
           (
             SELECT count(*)::text
               FROM orders prior
              WHERE prior.customer_user_id=$1
                AND prior.id<>$2
                AND NOT prior.is_deleted
           ) AS prior_orders,
           (
             SELECT count(*)::text
               FROM orders refused
              WHERE refused.customer_user_id=$1
                AND refused.status='Refused'
                AND NOT refused.is_deleted
                AND refused.updated_at >= now() - ($3::int * interval '1 day')
           ) AS refusals_in_window,
           (
             SELECT count(*)::text
               FROM orders recent
              WHERE recent.customer_user_id=$1
                AND recent.id<>$2
                AND NOT recent.is_deleted
                AND recent.created_at >= now() - ($4::int * interval '1 minute')
           ) AS recent_prior_orders,
           EXISTS (
             SELECT 1
               FROM account_phones phone
              WHERE phone.user_id=$1
                AND phone.account_type='customer'
                AND phone.verified_at IS NOT NULL
           ) AS verified_phone`,
        [
          customerUserId,
          orderId,
          policy.refusalWindowDays,
          policy.rapidRepeatWindowMinutes,
        ],
      );
      const stats = statsResult.rows[0];
      priorOrderCount = Number(stats?.prior_orders || 0);
      refusalsInWindow = Number(stats?.refusals_in_window || 0);
      recentPriorOrders = Number(stats?.recent_prior_orders || 0);
      verifiedPhone = Boolean(stats?.verified_phone);
    }

    const decision = evaluateCodRisk(
      {
        priorOrderCount,
        refusalsInWindow,
        recentOrderCount: recentPriorOrders + 1,
        verifiedPhone,
        orderValueMinor: Math.max(0, Math.round(finalMinor)),
      },
      policy,
    );
    const customerDecision = evaluateCodRisk(
      {
        priorOrderCount,
        refusalsInWindow,
        recentOrderCount: recentPriorOrders + 1,
        verifiedPhone,
        orderValueMinor: 0,
      },
      policy,
    );

    const currentResult = await client.query<{
      cod_risk_level: CodRiskLevel;
      cod_risk_score: number;
      cod_risk_reasons: string[];
      cod_refusals_in_window: number;
      cod_risk_policy_version: number;
      cod_verification_required: boolean;
      cod_verification_status: CodVerificationStatus;
    }>(
      `SELECT cod_risk_level, cod_risk_score, cod_risk_reasons,
              cod_refusals_in_window, cod_risk_policy_version,
              cod_verification_required, cod_verification_status
         FROM orders
        WHERE id=$1
        FOR UPDATE`,
      [orderId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");

    let verificationStatus = decision.recommendedVerificationStatus;
    const preserveVerification = options.preserveVerification !== false;
    if (
      preserveVerification &&
      Number(current.cod_risk_policy_version) === policy.version &&
      current.cod_verification_status === "Verified" &&
      decision.recommendedVerificationStatus !== "Manual Review"
    ) {
      verificationStatus = "Verified";
    } else if (
      preserveVerification &&
      Number(current.cod_risk_policy_version) === policy.version &&
      current.cod_verification_status === "Failed" &&
      decision.verificationRequired
    ) {
      verificationStatus = "Failed";
    }

    const riskReasons = decision.riskReasons;
    const reason =
      riskReasons.length > 0 ? riskReasons.join(", ") : "No elevated COD risk signals";
    const currentReasons = Array.isArray(current.cod_risk_reasons)
      ? current.cod_risk_reasons
      : [];
    const changed =
      current.cod_risk_level !== decision.riskLevel ||
      Number(current.cod_risk_score) !== decision.riskScore ||
      JSON.stringify(currentReasons) !== JSON.stringify(riskReasons) ||
      Number(current.cod_refusals_in_window) !== refusalsInWindow ||
      Number(current.cod_risk_policy_version) !== policy.version ||
      Boolean(current.cod_verification_required) !== decision.verificationRequired ||
      current.cod_verification_status !== verificationStatus;

    if (changed) {
      await client.query(
        `UPDATE orders
            SET cod_risk_level=$2,
                cod_risk_score=$3,
                cod_risk_reasons=$4::jsonb,
                cod_refusals_in_window=$5,
                cod_risk_policy_version=$6,
                cod_verification_required=$7,
                cod_verification_status=$8,
                cod_verification_reason=$9,
                cod_verified_at=CASE WHEN $8='Verified' THEN cod_verified_at ELSE NULL END,
                cod_verified_by=CASE WHEN $8='Verified' THEN cod_verified_by ELSE NULL END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [
          orderId,
          decision.riskLevel,
          decision.riskScore,
          JSON.stringify(riskReasons),
          refusalsInWindow,
          policy.version,
          decision.verificationRequired,
          verificationStatus,
          reason,
        ],
      );
      await client.query(
        `INSERT INTO cod_verification_events (
           order_id, customer_user_id, event_type, risk_level, risk_score,
           verification_status, policy_version, reason, actor_type, actor_id, metadata
         ) VALUES ($1,$2,'RISK_EVALUATED',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          orderId,
          customerUserId,
          decision.riskLevel,
          decision.riskScore,
          verificationStatus,
          policy.version,
          options.reason || reason,
          options.actorType || "system",
          options.actorId || null,
          JSON.stringify({
            riskReasons,
            refusalsInWindow,
            priorOrderCount,
            recentOrderCount: recentPriorOrders + 1,
            verifiedPhone,
            orderValueMinor: Math.max(0, Math.round(finalMinor)),
          }),
        ],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ($1,$2,'COD_RISK_EVALUATED','orders',$3,$4,$5::jsonb)`,
        [
          options.actorType || "system",
          options.actorId || null,
          orderId,
          options.requestId || null,
          JSON.stringify({
            riskLevel: decision.riskLevel,
            riskScore: decision.riskScore,
            verificationStatus,
            policyVersion: policy.version,
            refusalsInWindow,
            reason: options.reason || "",
          }),
        ],
      );
    }

    if (customerUserId) {
      await client.query(
        `UPDATE customers
            SET cod_risk_level=$2,
                cod_risk_score=$3,
                cod_risk_reasons=$4::jsonb,
                cod_refusals_in_window=$5,
                cod_risk_policy_version=$6,
                cod_risk_updated_at=now(),
                updated_at=now()
          WHERE user_id=$1`,
        [
          customerUserId,
          customerDecision.riskLevel,
          customerDecision.riskScore,
          JSON.stringify(customerDecision.riskReasons),
          refusalsInWindow,
          policy.version,
        ],
      );
    }

    return {
      riskLevel: decision.riskLevel,
      riskScore: decision.riskScore,
      riskReasons,
      verificationRequired: decision.verificationRequired,
      verificationStatus,
      policyVersion: policy.version,
      refusalsInWindow,
      changed,
    };
  }

  private async refreshActiveCustomerCodRisk(
    client: PoolClient,
    customerUserId: string,
    excludedOrderId: string,
    actorId: string | null,
    requestId?: string,
  ): Promise<void> {
    const rows = await client.query<{ id: string; final_minor: string }>(
      `SELECT id::text, final_minor::text
         FROM orders
        WHERE customer_user_id=$1
          AND id<>$2
          AND status IN ('New','Accepted')
          AND NOT is_deleted
          AND lower(payment_method) LIKE '%cash%'
        ORDER BY created_at
        FOR UPDATE`,
      [customerUserId, excludedOrderId],
    );
    for (const row of rows.rows) {
      await this.refreshCodRiskForOrder(
        client,
        row.id,
        customerUserId,
        Number(row.final_minor || 0),
        {
          preserveVerification: false,
          actorType: actorId ? "staff" : "system",
          actorId,
          requestId,
          reason: "CUSTOMER_REFUSAL_PROFILE_CHANGED",
        },
      );
    }
  }

  public async publicLeaderboard(): Promise<{
    period: string;
    rows: Array<{
      rank: number;
      name: string;
      orders: number;
      items: number;
    }>;
  }> {
    const client = await this.pool.connect();
    try {
      const deliveredResult = await client.query<{
        client_code: string;
        full_name: string;
        order_code: string;
        final_minor: string;
        item_codes: string[];
      }>(
        `SELECT c.client_code,
                c.full_name,
                o.order_code,
                o.final_minor::text,
                COALESCE(
                  array_agg(oi.item_code ORDER BY oi.created_at, oi.id)
                    FILTER (WHERE oi.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS item_codes
           FROM orders o
           JOIN customers c ON c.user_id=o.customer_user_id
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
      const states = new Map<string, unknown[]>([
        ["returns", returnRows],
        ["cards", cardRows],
      ]);

      const excludedClients = new Set(
        (states.get("cards") || [])
          .map((raw) => raw as Record<string, unknown>)
          .filter((card) => {
            if (
              String(card.status || "").toLowerCase() !== "active" ||
              card.isArchived ||
              card.isDeleted
            ) {
              return false;
            }
            const limit = Number(card.itemLimit || card.purchasedLimit || 10);
            const used = Number(card.purchasedItems || 0);
            const expiry = flexibleDateExpiry(card.expDate);
            return used < limit && (!expiry || expiry >= Date.now());
          })
          .map((card) => String(card.clientId || "")),
      );

      const completedRefundItems = new Set(
        (states.get("returns") || [])
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
        if (excludedClients.has(order.client_code)) continue;
        const current = byCustomer.get(order.client_code) || {
          name: order.full_name,
          orders: 0,
          items: 0,
          spentMinor: 0,
        };
        current.orders += 1;
        current.items += (order.item_codes || []).filter(
          (itemCode) => !completedRefundItems.has(String(itemCode)),
        ).length;
        current.spentMinor += Number(order.final_minor || 0);
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

      const rows = [...byCustomer.values()]
        .filter((row) => row.orders > 0)
        .sort(
          (left, right) =>
            right.orders - left.orders ||
            right.items - left.items ||
            right.spentMinor - left.spentMinor,
        )
        .slice(0, 3)
        .map((row, index) => ({
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

  public async validatePromotionCode(
    customerUserId: string,
    code: string,
  ): Promise<{
    valid: boolean;
    promotion: Record<string, unknown> | null;
    message?: string;
  }> {
    const client = await this.pool.connect();
    try {
      const rows = await readRelationalDashboardDomain(
        client,
        "promotions",
      ) as Record<string, unknown>[];
      const normalizedCode = String(code || "").trim().toUpperCase();
      const row = rows.find((item) =>
        String(item.code || "").trim().toUpperCase() === normalizedCode &&
        String(item.status || "Active").toLowerCase() === "active" &&
        !item.isArchived &&
        !item.isDeleted,
      );
      if (!row || !promotionDateActive(row)) {
        return { valid: false, promotion: null, message: "Promotion code is invalid or expired" };
      }
      const percent = promotionPercentage(row);
      if (!percent) {
        return { valid: false, promotion: null, message: "Promotion has no active discount" };
      }
      const stats = await customerPurchaseStats(client, customerUserId);
      if (!promotionTargetsCustomer(row, stats)) {
        return { valid: false, promotion: null, message: "This promotion is not available for this account" };
      }
      return {
        valid: true,
        promotion: {
          id: String(row.id || ""),
          code: normalizedCode,
          type: "Promotion",
          percent,
          startsAt: row.startsAt || row.startDate || "",
          endsAt: row.endsAt || row.endDate || "",
        },
      };
    } finally {
      client.release();
    }
  }

  public async reserveCart(
    reservationId: string,
    lines: CartLineInput[],
    customerUserId?: string,
    guestOwnerHash?: string,
  ): Promise<{ reservationId: string; expiresAt: Date; reservedItems: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      await client.query(
        "SELECT set_config('dart.skip_waitlist_allocation','1',true)",
      );

      const currentReservation = await client.query<{
        customer_user_id: string | null;
        guest_owner_hash: string | null;
      }>(
        `SELECT customer_user_id::text, guest_owner_hash
           FROM cart_reservations
          WHERE id=$1
            AND source='cart'
          FOR UPDATE`,
        [reservationId],
      );
      const current = currentReservation.rows[0];
      if (current) {
        if (customerUserId) {
          if (
            current.customer_user_id &&
            current.customer_user_id !== customerUserId
          ) {
            throw new AppError(
              403,
              "RESERVATION_OWNERSHIP_INVALID",
              "This cart reservation belongs to another account",
            );
          }
          if (
            !current.customer_user_id &&
            (!current.guest_owner_hash || current.guest_owner_hash !== guestOwnerHash)
          ) {
            throw new AppError(
              403,
              "RESERVATION_OWNERSHIP_INVALID",
              "This guest cart belongs to another browser",
            );
          }
        } else {
          if (!guestOwnerHash) {
            throw new AppError(
              403,
              "GUEST_CART_OWNER_REQUIRED",
              "Guest cart ownership could not be verified",
            );
          }
          if (
            current.customer_user_id ||
            !current.guest_owner_hash ||
            current.guest_owner_hash !== guestOwnerHash
          ) {
            throw new AppError(
              403,
              "RESERVATION_OWNERSHIP_INVALID",
              "This cart reservation belongs to another session",
            );
          }
        }
      }

      if (customerUserId) {
        const otherReservations = await client.query<{ id: string }>(
          `SELECT id
             FROM cart_reservations
            WHERE customer_user_id=$1
              AND source='cart'
              AND id<>$2
            FOR UPDATE`,
          [customerUserId, reservationId],
        );
        const otherIds = otherReservations.rows.map((row) => row.id);
        if (otherIds.length) {
          await client.query(
            `UPDATE inventory_items
                SET status='In stock',
                    cart_reservation_id=NULL,
                    reservation_until=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE cart_reservation_id = ANY($1::text[])
                AND lower(status)='cart reserved'`,
            [otherIds],
          );
          await client.query(
            "DELETE FROM cart_reservations WHERE id = ANY($1::text[])",
            [otherIds],
          );
        }
      } else if (guestOwnerHash) {
        const otherReservations = await client.query<{ id: string }>(
          `SELECT id
             FROM cart_reservations
            WHERE customer_user_id IS NULL
              AND source='cart'
              AND guest_owner_hash=$1
              AND id<>$2
            FOR UPDATE`,
          [guestOwnerHash, reservationId],
        );
        const otherIds = otherReservations.rows.map((row) => row.id);
        if (otherIds.length) {
          await client.query(
            `UPDATE inventory_items
                SET status='In stock',
                    cart_reservation_id=NULL,
                    reservation_until=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE cart_reservation_id = ANY($1::text[])
                AND lower(status)='cart reserved'`,
            [otherIds],
          );
          await client.query(
            "DELETE FROM cart_reservations WHERE id = ANY($1::text[])",
            [otherIds],
          );
        }
      }

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
      const settingsResult = await client.query<{ data: Record<string, unknown> }>(
        "SELECT data FROM site_settings WHERE id='main'",
      );
      const reservationSiteDiscountPercent = activeSiteDiscountPercent(
        settingsResult.rows[0]?.data || {},
      );
      const pricingSnapshot: Array<Record<string, unknown>> = [];

      await client.query(
        `INSERT INTO cart_reservations (
           id, customer_user_id, guest_owner_hash, expires_at, source
         ) VALUES ($1,$2,$3,$4,'cart')`,
        [
          reservationId,
          customerUserId ?? null,
          customerUserId ? null : guestOwnerHash ?? null,
          expiresAt,
        ],
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
          selling_minor: string;
          discount_percent: string;
        }>(
          `SELECT size_options, color_options,
                  selling_minor::text, discount_percent::text
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

        const sellingMinor = Number(model.selling_minor || 0);
        const modelDiscountPercent = Number(model.discount_percent || 0);
        const effectiveCatalogDiscountPercent =
          reservationSiteDiscountPercent || modelDiscountPercent;
        pricingSnapshot.push({
          modelId,
          color,
          size,
          quantity,
          sellingMinor,
          discountPercent: effectiveCatalogDiscountPercent,
          finalUnitMinor: finalModelPriceMinor(
            sellingMinor,
            effectiveCatalogDiscountPercent,
          ),
        });

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
        `UPDATE cart_reservations
            SET pricing_snapshot=$2::jsonb,
                updated_at=now()
          WHERE id=$1`,
        [reservationId, JSON.stringify(pricingSnapshot)],
      );

      await client.query(
        "SELECT set_config('dart.skip_waitlist_allocation','0',true)",
      );
      await client.query(
        `UPDATE waitlist_allocations wa
            SET expires_at=$2,
                version=version+1,
                updated_at=now()
          WHERE wa.status='cart'
            AND wa.cart_reservation_id=$1
            AND EXISTS (
              SELECT 1
                FROM inventory_items i
               WHERE i.id=wa.inventory_item_id
                 AND i.cart_reservation_id=$1
                 AND lower(i.status)='cart reserved'
            )`,
        [reservationId, expiresAt],
      );

      const reboundWaiting = await client.query<{ waitlist_entry_id: string }>(
        `WITH needs AS (
           SELECT wa.id AS allocation_id,
                  w.id AS waitlist_entry_id,
                  w.model_id,
                  w.size,
                  wa.offered_color,
                  row_number() OVER (
                    PARTITION BY w.model_id,w.size,wa.offered_color
                    ORDER BY w.confirmed_at,w.requested_at,w.id
                  ) AS rn
             FROM waitlist_allocations wa
             JOIN waitlist_entries w ON w.id=wa.waitlist_entry_id
            WHERE wa.status='cart'
              AND wa.cart_reservation_id=$1
              AND w.status='confirmed'
              AND NOT EXISTS (
                SELECT 1
                  FROM inventory_items old_item
                 WHERE old_item.id=wa.inventory_item_id
                   AND old_item.cart_reservation_id=$1
                   AND lower(old_item.status)='cart reserved'
              )
         ),
         available AS (
           SELECT i.id AS inventory_item_id,
                  i.model_id,
                  i.size,
                  i.color,
                  row_number() OVER (
                    PARTITION BY i.model_id,i.size,i.color
                    ORDER BY i.created_at,i.id
                  ) AS rn
             FROM inventory_items i
            WHERE i.cart_reservation_id=$1
              AND lower(i.status)='cart reserved'
              AND NOT EXISTS (
                SELECT 1
                  FROM waitlist_allocations current_allocation
                 WHERE current_allocation.inventory_item_id=i.id
                   AND current_allocation.cart_reservation_id=$1
                   AND current_allocation.status='cart'
              )
         ),
         matches AS (
           SELECT needs.allocation_id,
                  needs.waitlist_entry_id,
                  available.inventory_item_id
             FROM needs
             JOIN available
               ON available.model_id=needs.model_id
              AND available.size=needs.size
              AND available.color=needs.offered_color
              AND available.rn=needs.rn
         )
         UPDATE waitlist_allocations wa
            SET inventory_item_id=matches.inventory_item_id,
                expires_at=$2,
                version=wa.version+1,
                updated_at=now()
           FROM matches
          WHERE wa.id=matches.allocation_id
          RETURNING wa.waitlist_entry_id::text`,
        [reservationId, expiresAt],
      );

      await client.query(
        `UPDATE waitlist_entries w
            SET reserved_until=$2,
                version=w.version+1,
                updated_at=now()
          WHERE w.status='confirmed'
            AND EXISTS (
              SELECT 1
                FROM waitlist_allocations wa
                JOIN inventory_items i ON i.id=wa.inventory_item_id
               WHERE wa.waitlist_entry_id=w.id
                 AND wa.cart_reservation_id=$1
                 AND wa.status='cart'
                 AND i.cart_reservation_id=$1
                 AND lower(i.status)='cart reserved'
            )`,
        [reservationId, expiresAt],
      );

      const expiredWaiting = await client.query<{ waitlist_entry_id: string }>(
        `WITH expired_allocations AS (
           UPDATE waitlist_allocations wa
              SET status='expired',
                  released_at=now(),
                  release_reason=COALESCE(
                    release_reason,
                    'confirmed_item_removed_from_cart'
                  ),
                  version=wa.version+1,
                  updated_at=now()
            WHERE wa.status='cart'
              AND wa.cart_reservation_id=$1
              AND NOT EXISTS (
                SELECT 1
                  FROM inventory_items i
                 WHERE i.id=wa.inventory_item_id
                   AND i.cart_reservation_id=$1
                   AND lower(i.status)='cart reserved'
              )
            RETURNING wa.waitlist_entry_id
         )
         UPDATE waitlist_entries w
            SET status='expired',
                reserved_until=NULL,
                version=w.version+1,
                updated_at=now()
           FROM expired_allocations expired
          WHERE w.id=expired.waitlist_entry_id
            AND w.status='confirmed'
          RETURNING w.id::text AS waitlist_entry_id`,
        [reservationId],
      );

      const waitingChangedIds = [
        ...new Set([
          ...reboundWaiting.rows.map((row) => row.waitlist_entry_id),
          ...expiredWaiting.rows.map((row) => row.waitlist_entry_id),
        ]),
      ];
      if (waitingChangedIds.length) {
        await client.query(
          `INSERT INTO audit_logs(
             actor_type,actor_id,action,entity_type,entity_id,metadata
           )
           SELECT 'system',NULL,
                  CASE
                    WHEN id = ANY($1::uuid[])
                      THEN 'WAITLIST_CART_PHYSICAL_ITEM_REBOUND'
                    ELSE 'WAITLIST_CONFIRMED_CART_RELEASED'
                  END,
                  'waitlist',
                  id::text,
                  jsonb_build_object(
                    'reservationId',$3,
                    'source','cart_rebuild'
                  )
             FROM unnest($2::uuid[]) AS ids(id)`,
          [
            reboundWaiting.rows.map((row) => row.waitlist_entry_id),
            waitingChangedIds,
            reservationId,
          ],
        );
        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='waiting'",
        );
      }

      await client.query(
        `SELECT dart_waitlist_try_allocate_item(candidate.id)
           FROM (
             SELECT id
               FROM inventory_items
              WHERE active
                AND NOT is_archived
                AND NOT is_deleted
                AND lower(status)='in stock'
              ORDER BY updated_at DESC,id
              LIMIT 100
           ) candidate`,
      );
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

  public async customerCart(
    customerUserId: string,
  ): Promise<{
    cart: null | {
      reservationId: string;
      expiresAt: string;
      lines: Array<{ modelId: string; color: string; size: string; quantity: number }>;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const reservation = await client.query<{
        id: string;
        expires_at: Date;
      }>(
        `SELECT id, expires_at
           FROM cart_reservations
          WHERE customer_user_id=$1
            AND source='cart'
            AND expires_at > now()
          ORDER BY updated_at DESC
          LIMIT 1
          FOR SHARE`,
        [customerUserId],
      );
      const row = reservation.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return { cart: null };
      }
      const lines = await client.query<{
        model_id: string;
        color: string;
        size: string;
        quantity: string;
      }>(
        `SELECT model_id, color, size, count(*)::text AS quantity
           FROM inventory_items
          WHERE cart_reservation_id=$1
            AND lower(status)='cart reserved'
            AND reservation_until > now()
            AND active
            AND NOT is_archived
            AND NOT is_deleted
          GROUP BY model_id, color, size
          ORDER BY model_id, color, size`,
        [row.id],
      );
      await client.query("COMMIT");
      if (!lines.rows.length) {
        return { cart: null };
      }
      return {
        cart: {
          reservationId: row.id,
          expiresAt: row.expires_at.toISOString(),
          lines: lines.rows.map((line) => ({
            modelId: line.model_id,
            color: line.color,
            size: line.size,
            quantity: Number(line.quantity || 0),
          })),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async guestCart(
    reservationId: string,
    guestOwnerHash: string,
  ): Promise<{
    cart: null | {
      reservationId: string;
      expiresAt: string;
      lines: Array<{ modelId: string; color: string; size: string; quantity: number }>;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const reservation = await client.query<{
        id: string;
        expires_at: Date;
        customer_user_id: string | null;
        guest_owner_hash: string | null;
      }>(
        `SELECT id, expires_at, customer_user_id::text, guest_owner_hash
           FROM cart_reservations
          WHERE id=$1
            AND source='cart'
            AND expires_at > now()
          FOR SHARE`,
        [reservationId],
      );
      const row = reservation.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return { cart: null };
      }
      if (row.customer_user_id || !row.guest_owner_hash || row.guest_owner_hash !== guestOwnerHash) {
        throw new AppError(403, "RESERVATION_OWNERSHIP_INVALID", "This guest cart belongs to another browser");
      }
      const lines = await client.query<{
        model_id: string;
        color: string;
        size: string;
        quantity: string;
      }>(
        `SELECT model_id, color, size, count(*)::text AS quantity
           FROM inventory_items
          WHERE cart_reservation_id=$1
            AND lower(status)='cart reserved'
            AND reservation_until > now()
            AND active AND NOT is_archived AND NOT is_deleted
          GROUP BY model_id, color, size
          ORDER BY model_id, color, size`,
        [row.id],
      );
      await client.query("COMMIT");
      if (!lines.rows.length) return { cart: null };
      return {
        cart: {
          reservationId: row.id,
          expiresAt: row.expires_at.toISOString(),
          lines: lines.rows.map((line) => ({
            modelId: line.model_id,
            color: line.color,
            size: line.size,
            quantity: Number(line.quantity || 0),
          })),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async claimGuestCart(
    reservationId: string,
    customerUserId: string,
    guestOwnerHash?: string,
  ): Promise<{ reservationId: string; expiresAt: Date; reservedItems: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      const reservationResult = await client.query<{
        id: string;
        customer_user_id: string | null;
        guest_owner_hash: string | null;
        expires_at: Date;
      }>(
        `SELECT id, customer_user_id::text, guest_owner_hash, expires_at
           FROM cart_reservations
          WHERE id=$1
            AND source='cart'
            AND expires_at > now()
          FOR UPDATE`,
        [reservationId],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation) {
        throw new AppError(
          409,
          "CART_RESERVATION_EXPIRED",
          "This cart reservation has expired",
        );
      }
      if (
        reservation.customer_user_id &&
        reservation.customer_user_id !== customerUserId
      ) {
        throw new AppError(
          403,
          "RESERVATION_OWNERSHIP_INVALID",
          "This cart reservation belongs to another account",
        );
      }
      if (
        !reservation.customer_user_id &&
        (!guestOwnerHash ||
          !reservation.guest_owner_hash ||
          reservation.guest_owner_hash !== guestOwnerHash)
      ) {
        throw new AppError(
          403,
          "RESERVATION_OWNERSHIP_INVALID",
          "This guest cart belongs to another browser",
        );
      }

      const otherReservations = await client.query<{ id: string }>(
        `SELECT id
           FROM cart_reservations
          WHERE customer_user_id=$1
            AND source='cart'
            AND id<>$2
          FOR UPDATE`,
        [customerUserId, reservationId],
      );
      const otherIds = otherReservations.rows.map((row) => row.id);
      if (otherIds.length) {
        await client.query(
          `UPDATE inventory_items
              SET status='In stock',
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE cart_reservation_id = ANY($1::text[])
              AND lower(status)='cart reserved'`,
          [otherIds],
        );
        await client.query(
          "DELETE FROM cart_reservations WHERE id = ANY($1::text[])",
          [otherIds],
        );
      }

      if (!reservation.customer_user_id) {
        await client.query(
          `UPDATE cart_reservations
              SET customer_user_id=$2,
                  guest_owner_hash=NULL,
                  updated_at=now()
            WHERE id=$1`,
          [reservationId, customerUserId],
        );
      }

      const countResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM inventory_items
          WHERE cart_reservation_id=$1
            AND lower(status)='cart reserved'
            AND reservation_until > now()
            AND active
            AND NOT is_archived
            AND NOT is_deleted`,
        [reservationId],
      );
      const reservedItems = Number(countResult.rows[0]?.count || 0);
      if (!reservedItems) {
        throw new AppError(
          409,
          "CART_RESERVATION_EXPIRED",
          "This cart reservation no longer contains reserved items",
        );
      }

      if (otherIds.length) {
        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
        );
      }
      await client.query("COMMIT");
      return {
        reservationId,
        expiresAt: reservation.expires_at,
        reservedItems,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async releaseCustomerCart(customerUserId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reservations = await client.query<{ id: string }>(
        `SELECT id
           FROM cart_reservations
          WHERE customer_user_id=$1
            AND source='cart'
          FOR UPDATE`,
        [customerUserId],
      );
      const ids = reservations.rows.map((row) => row.id);
      let changed = false;
      if (ids.length) {
        const released = await client.query(
          `UPDATE inventory_items
              SET status='In stock',
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE cart_reservation_id = ANY($1::text[])
              AND lower(status)='cart reserved'`,
          [ids],
        );
        changed = (released.rowCount ?? 0) > 0;
        await client.query(
          "DELETE FROM cart_reservations WHERE id = ANY($1::text[])",
          [ids],
        );
      }
      if (changed) {
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

  public async releaseCart(
    reservationId: string,
    guestOwnerHash: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reservationResult = await client.query<{
        customer_user_id: string | null;
        guest_owner_hash: string | null;
      }>(
        `SELECT customer_user_id::text, guest_owner_hash
           FROM cart_reservations
          WHERE id=$1
            AND source='cart'
          FOR UPDATE`,
        [reservationId],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation) {
        await client.query("COMMIT");
        return;
      }
      if (
        reservation.customer_user_id ||
        !reservation.guest_owner_hash ||
        reservation.guest_owner_hash !== guestOwnerHash
      ) {
        throw new AppError(
          403,
          "RESERVATION_OWNERSHIP_INVALID",
          "This guest cart belongs to another session",
        );
      }

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
    guestOwnerHash?: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      if (!idempotencyKey) {
        throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
      }
      const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ customerUserId, input }))
        .digest("hex");
      const insertedKey = await client.query<{ id: string }>(
        `INSERT INTO idempotency_keys (scope, key_hash, request_hash, expires_at)
         VALUES ($1,$2,$3,now() + interval '24 hours')
         ON CONFLICT (scope, key_hash) DO NOTHING
         RETURNING id::text`,
        [`order.create:${customerUserId}`, keyHash, requestHash],
      );
      if (!insertedKey.rows.length) {
        const existingKey = await client.query<{
          request_hash: string;
          status: string;
          response_body: Record<string, unknown> | null;
        }>(
          `SELECT request_hash, status, response_body
             FROM idempotency_keys
            WHERE scope=$1 AND key_hash=$2 AND expires_at > now()
            FOR UPDATE`,
          [`order.create:${customerUserId}`, keyHash],
        );
        const existing = existingKey.rows[0];
        if (!existing) {
          throw new AppError(409, "IDEMPOTENCY_KEY_EXPIRED", "Retry checkout with a new idempotency key");
        }
        if (existing.request_hash !== requestHash) {
          throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for different checkout data");
        }
        if (existing.status === "completed" && existing.response_body) {
          await client.query("COMMIT");
          return existing.response_body;
        }
        throw new AppError(409, "CHECKOUT_IN_PROGRESS", "This checkout is already being processed");
      }

      const reservationResult = await client.query<{
        customer_user_id: string | null;
        guest_owner_hash: string | null;
        expires_at: Date;
        pricing_snapshot: Array<Record<string, unknown>>;
      }>(
        `SELECT customer_user_id::text, guest_owner_hash, expires_at,
                pricing_snapshot
           FROM cart_reservations
          WHERE id=$1
            AND source='cart'
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
      if (
        !reservation.customer_user_id &&
        (!reservation.guest_owner_hash || reservation.guest_owner_hash !== guestOwnerHash)
      ) {
        throw new AppError(
          403,
          "RESERVATION_OWNERSHIP_INVALID",
          "This guest cart belongs to another browser",
        );
      }
      await client.query(
        `UPDATE cart_reservations
            SET customer_user_id=$2,
                guest_owner_hash=NULL,
                updated_at=now()
          WHERE id=$1`,
        [input.reservationId, customerUserId],
      );

      const itemResult = await client.query<LockedItem>(
        `SELECT i.id, i.item_code, i.model_id, i.color, i.size,
                m.name AS model_name, i.cost_snapshot_minor::text,
                m.selling_minor::text, m.discount_percent::text
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
      const configuredCourierFee = Number(
        settings.courierFeePerOrder ?? settings.deliveryCostPerPiece,
      );
      const courierFeePerOrderMinor = Math.round(
        Math.max(
          0,
          Number.isFinite(configuredCourierFee)
            ? configuredCourierFee
            : 100,
        ) * 100,
      );
      const siteDiscountPercent = activeSiteDiscountPercent(settings);

      const reservedPricing = Array.isArray(reservation.pricing_snapshot)
        ? reservation.pricing_snapshot
        : [];
      const priceChanges = detectCartPriceChanges(
        reservedPricing,
        itemResult.rows,
        siteDiscountPercent,
      );
      if (priceChanges.length && !input.acceptPriceChanges) {
        throw new AppError(
          409,
          "PRICE_CHANGED",
          "One or more cart prices changed. Review and confirm the current prices before checkout.",
          { changes: priceChanges },
        );
      }

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
      }>(
        `SELECT domain, version::text
           FROM dashboard_domain_state
          WHERE domain IN ('birthday_rewards','cards','promotions')
          FOR UPDATE`,
      );
      const promotionStates = new Map<string, { version: number; data: unknown[] }>();
      for (const row of promotionStatesResult.rows) {
        promotionStates.set(row.domain, {
          version: Number(row.version || 1),
          data: await readRelationalDashboardDomain(
            client,
            row.domain as "birthday_rewards" | "cards" | "promotions",
          ),
        });
      }
      const birthdayState = promotionStates.get("birthday_rewards");
      const cardState = promotionStates.get("cards");
      const promotionsState = promotionStates.get("promotions");
      if (!birthdayState || !cardState || !promotionsState) {
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

      if (!promotion && input.promotionCode) {
        const normalizedCode = String(input.promotionCode).trim().toUpperCase();
        const codePromotion = (promotionsState.data as Record<string, unknown>[]).find(
          (row) =>
            String(row.code || "").trim().toUpperCase() === normalizedCode &&
            String(row.status || "Active").toLowerCase() === "active" &&
            !row.isArchived &&
            !row.isDeleted,
        );
        if (
          !codePromotion ||
          !promotionDateActive(codePromotion) ||
          !promotionPercentage(codePromotion)
        ) {
          throw new AppError(
            409,
            "PROMOTION_INVALID",
            "Promotion code is invalid, expired or no longer active",
          );
        }
        const stats = await customerPurchaseStats(client, customerUserId);
        if (!promotionTargetsCustomer(codePromotion, stats)) {
          throw new AppError(
            409,
            "PROMOTION_NOT_ELIGIBLE",
            "This promotion is not available for this account",
          );
        }
        promotionPercent = promotionPercentage(codePromotion);
        promotion = {
          id: String(codePromotion.id || ""),
          type: "Promotion",
          code: normalizedCode,
          percent: promotionPercent,
        };
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
          costMinor: Number(row.cost_snapshot_minor),
        };
      });
      const orderDiscountMinor = Math.max(0, subtotalMinor - finalMinor);
      // The representative is paid once per order, not once per item.
      // Item cost already includes this allocation, so Finance must not add it again.
      const deliveryCostMinor = courierFeePerOrderMinor;

      const orderResult = await client.query<{ id: string; order_code: string; created_at: Date }>(
        `INSERT INTO orders (
           customer_user_id, subtotal_minor, order_discount_minor, final_minor,
           delivery_cost_minor, promotion, contact_snapshot, delivery_address,
           delivery_notes, order_source, legacy
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,'Website',$10::jsonb)
         RETURNING id, order_code, created_at`,
        [
          customerUserId,
          subtotalMinor,
          orderDiscountMinor,
          finalMinor,
          deliveryCostMinor,
          promotion ? JSON.stringify(promotion) : null,
          JSON.stringify(input.contact),
          JSON.stringify(input.address),
          input.deliveryNotes || "",
          JSON.stringify({
            reservationId: input.reservationId,
            birthdayRewardId: promotion?.type === "Birthday" ? promotion.rewardId : "",
            dartCardId: promotion?.type === "Dart Card" ? promotion.cardId : "",
            promotionCode: promotion?.type === "Promotion" ? promotion.code : "",
          }),
        ],
      );
      const order = orderResult.rows[0]!;

      await this.refreshCodRiskForOrder(
        client,
        order.id,
        customerUserId,
        finalMinor,
        {
          preserveVerification: false,
          actorType: "customer",
          actorId: customerUserId,
          requestId,
          reason: "ORDER_CREATED",
        },
      );

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

      const inventoryUpdate = await client.query(
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
      if ((inventoryUpdate.rowCount ?? 0) !== itemSnapshots.length) {
        throw new AppError(409, "RESERVATION_CHANGED", "Reserved inventory changed during checkout");
      }

      let waitlistConversions = 0;
      for (const snapshot of itemSnapshots) {
        const row = snapshot.row;
        const conversion = await client.query<{ id: string }>(
          `WITH candidate AS (
             SELECT w.id
               FROM waitlist_entries w
              WHERE w.customer_user_id=$1
                AND w.status='confirmed'
                AND w.model_id=$2
                AND w.size=$3
                AND (
                  w.desired_color=$4
                  OR EXISTS (
                    SELECT 1
                      FROM waitlist_allocations wa
                     WHERE wa.waitlist_entry_id=w.id
                       AND wa.offered_color=$4
                  )
                )
              ORDER BY w.confirmed_at DESC NULLS LAST,w.requested_at DESC,w.id
              LIMIT 1
              FOR UPDATE
           )
           UPDATE waitlist_entries w
              SET status='converted',
                  converted_at=now(),
                  converted_order_code=$5,
                  reserved_until=NULL,
                  version=w.version+1,
                  updated_at=now()
             FROM candidate c
            WHERE w.id=c.id
            RETURNING w.id::text`,
          [customerUserId, row.model_id, row.size, row.color, order.order_code],
        );
        const convertedId = conversion.rows[0]?.id;
        if (!convertedId) continue;
        waitlistConversions += 1;
        await client.query(
          `UPDATE waitlist_allocations
              SET status='converted',
                  converted_at=now(),
                  converted_order_code=$2,
                  version=version+1,
                  updated_at=now()
            WHERE waitlist_entry_id=$1
              AND status IN ('cart','confirmed','expired')`,
          [convertedId, order.order_code],
        );
        await client.query(
          `INSERT INTO audit_logs (
             actor_type,actor_id,action,entity_type,entity_id,request_id,metadata
           ) VALUES (
             'customer',$1,'WAITLIST_CONVERTED_TO_ORDER','waitlist',$2,$3,$4::jsonb
           )`,
          [
            customerUserId,
            convertedId,
            requestId,
            JSON.stringify({
              orderCode: order.order_code,
              itemCode: row.item_code,
              fallbackMatch: true,
            }),
          ],
        );
      }
      if (waitlistConversions > 0) {
        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='waiting'",
        );
      }

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
         ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
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
      const checkoutResponse = {
        id: order.id,
        orderId: order.order_code,
        status: "New",
        createdAt: order.created_at.toISOString(),
        totalProducts: itemSnapshots.length,
        totalPrice: subtotalMinor / 100,
        discount: promotionPercent,
        orderLevelDiscountAmount: orderDiscountMinor / 100,
        finalAmount: finalMinor / 100,
        deliveryCost: deliveryCostMinor / 100,
        courierFee: deliveryCostMinor / 100,
        courierFeePerOrder: courierFeePerOrderMinor / 100,
        promotionType: promotion?.type || "",
        promotionCode: promotion?.type === "Promotion" ? String(promotion.code || "") : "",
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
      await client.query(
        `UPDATE idempotency_keys
            SET status='completed', response_code=201, response_body=$3::jsonb, updated_at=now()
          WHERE scope=$1 AND key_hash=$2`,
        [`order.create:${customerUserId}`, keyHash, JSON.stringify(checkoutResponse)],
      );
      await client.query("COMMIT");
      return checkoutResponse;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminLiveOperations(): Promise<{
    capturedAt: string;
    totals: {
      totalOrders: number;
      deliveredOrders: number;
      deliveringNow: number;
      activeRepresentatives: number;
    };
    representatives: Record<string, unknown>[];
  }> {
    const representativeResult = await this.pool.query<{
      representative_user_id: string;
      representative_code: string;
      representative_name: string;
      latitude: number | null;
      longitude: number | null;
      accuracy_meters: number | null;
      location_updated_at: Date | null;
      round_started_at: Date;
    }>(
      `WITH active_reps AS (
         SELECT representative_user_id,
                MIN(updated_at) AS round_started_at
           FROM orders
          WHERE representative_user_id IS NOT NULL
            AND status IN ('Out With Representative','Representative On The Way')
            AND NOT is_deleted
            AND NOT is_archived
          GROUP BY representative_user_id
       )
       SELECT r.user_id::text AS representative_user_id,
              r.representative_code,
              r.full_name AS representative_name,
              rl.latitude,
              rl.longitude,
              rl.accuracy_meters,
              rl.updated_at AS location_updated_at,
              active_reps.round_started_at
         FROM active_reps
         JOIN representatives r ON r.user_id=active_reps.representative_user_id
         JOIN users u ON u.id=r.user_id
         LEFT JOIN representative_locations rl
           ON rl.representative_user_id=r.user_id
        WHERE r.approval_status='approved'
          AND u.status='active'
        ORDER BY r.full_name`,
    );

    if (!representativeResult.rows.length) {
      return {
        capturedAt: new Date().toISOString(),
        totals: {
          totalOrders: 0,
          deliveredOrders: 0,
          deliveringNow: 0,
          activeRepresentatives: 0,
        },
        representatives: [],
      };
    }

    const representativeIds = representativeResult.rows.map(
      (row) => row.representative_user_id,
    );
    const ordersResult = await this.pool.query<{
      id: string;
      order_code: string;
      representative_user_id: string;
      status: string;
      contact_snapshot: Record<string, unknown>;
      delivery_address: Record<string, unknown>;
      final_minor: string;
      updated_at: Date;
      delivered_at: Date | null;
      route_state: string | null;
      sequence_number: number | null;
      route_note: string | null;
    }>(
      `SELECT o.id::text,
              o.order_code,
              o.representative_user_id::text,
              o.status,
              o.contact_snapshot,
              o.delivery_address,
              o.final_minor::text,
              o.updated_at,
              o.delivered_at,
              drs.route_state,
              drs.sequence_number,
              drs.note AS route_note
         FROM orders o
         LEFT JOIN delivery_route_stops drs
           ON drs.order_id=o.id
          AND drs.representative_user_id=o.representative_user_id
        WHERE o.representative_user_id = ANY($1::uuid[])
          AND NOT o.is_deleted
          AND NOT o.is_archived
        ORDER BY o.created_at`,
      [representativeIds],
    );

    const nowMs = Date.now();
    const representatives = representativeResult.rows.map((representative) => {
      const roundStartedAt = representative.round_started_at.getTime();
      const visible = ordersResult.rows.filter((order) => {
        if (order.representative_user_id !== representative.representative_user_id) return false;
        if (["Out With Representative", "Representative On The Way"].includes(order.status)) {
          return true;
        }
        const terminalAt = order.delivered_at?.getTime() ?? order.updated_at.getTime();
        return terminalAt >= roundStartedAt &&
          ["Delivered", "Refused", "Cancelled"].includes(order.status);
      });

      const normalizedStops = visible.map((order) => {
        const address = order.delivery_address || {};
        const latitude = Number(address.latitude);
        const longitude = Number(address.longitude);
        const routeState =
          order.status === "Delivered"
            ? "delivered"
            : order.status === "Cancelled"
              ? "cancelled"
              : order.status === "Refused"
                ? "refused"
                : order.status === "Representative On The Way"
                  ? "current"
                  : ["waiting", "problem"].includes(String(order.route_state || ""))
                    ? String(order.route_state)
                    : "upcoming";
        return {
          id: order.id,
          orderId: order.order_code,
          status: order.status,
          routeState,
          sequenceNumber: Number(order.sequence_number ?? 0),
          suggestedSequence: 0,
          note: order.route_note || "",
          clientName: String(order.contact_snapshot?.name || "Customer"),
          fullAddress: String(
            address.fullAddress ||
            [address.building, address.street, address.area, address.governorate, address.country]
              .filter(Boolean)
              .join(", "),
          ),
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          finalAmount: Number(order.final_minor) / 100,
          deliveredAt: order.delivered_at?.toISOString() || null,
        };
      });

      const routable = normalizedStops.filter(
        (stop) =>
          ["current", "upcoming", "waiting", "problem"].includes(stop.routeState) &&
          stop.latitude !== null &&
          stop.longitude !== null,
      ) as Array<(typeof normalizedStops)[number] & { latitude: number; longitude: number }>;
      const suggested = suggestedStopOrder(
        representative.latitude,
        representative.longitude,
        routable,
      );
      const suggestedIndex = new Map(
        suggested.map((stop, index) => [stop.orderId, index + 1]),
      );
      normalizedStops.forEach((stop) => {
        stop.suggestedSequence = suggestedIndex.get(stop.orderId) || 0;
      });
      normalizedStops.sort((first, second) => {
        if (first.routeState === "current" && second.routeState !== "current") return -1;
        if (second.routeState === "current" && first.routeState !== "current") return 1;
        const firstSequence = first.sequenceNumber || first.suggestedSequence || 9999;
        const secondSequence = second.sequenceNumber || second.suggestedSequence || 9999;
        return firstSequence - secondSequence;
      });

      const locationAgeMs = representative.location_updated_at
        ? Math.max(0, nowMs - representative.location_updated_at.getTime())
        : Number.POSITIVE_INFINITY;
      const connectionStatus =
        locationAgeMs <= 15_000
          ? "Online"
          : locationAgeMs <= 60_000
            ? "Location Stale"
            : "Offline";
      const current = normalizedStops.find((stop) => stop.routeState === "current") || null;
      const next = normalizedStops.find((stop) => stop.routeState === "upcoming") || null;

      return {
        id: representative.representative_user_id,
        repId: representative.representative_code,
        name: representative.representative_name,
        connectionStatus,
        lastLocationAt: representative.location_updated_at?.toISOString() || null,
        location: representative.latitude !== null && representative.longitude !== null
          ? {
              lat: representative.latitude,
              lng: representative.longitude,
              accuracy: representative.accuracy_meters,
            }
          : null,
        currentOrderId: current?.orderId || null,
        nextOrderId: next?.orderId || null,
        orders: normalizedStops,
      };
    });

    const allOrders = representatives.flatMap(
      (representative) => (representative.orders as Record<string, unknown>[]) || [],
    );
    return {
      capturedAt: new Date().toISOString(),
      totals: {
        totalOrders: allOrders.length,
        deliveredOrders: allOrders.filter((order) => order.routeState === "delivered").length,
        deliveringNow: allOrders.filter((order) => order.routeState === "current").length,
        activeRepresentatives: representatives.length,
      },
      representatives,
    };
  }

  public async adminLiveRouteState(
    actorId: string,
    orderRef: string,
    state: "current" | "upcoming" | "waiting" | "problem",
    note: string,
    requestId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query<{
        id: string;
        order_code: string;
        representative_user_id: string | null;
        status: string;
      }>(
        `SELECT id::text, order_code, representative_user_id::text, status
           FROM orders
          WHERE (id::text=$1 OR order_code=$1)
            AND NOT is_deleted
            AND NOT is_archived
          LIMIT 1
          FOR UPDATE`,
        [orderRef],
      );
      const order = orderResult.rows[0];
      if (!order || !order.representative_user_id) {
        throw new AppError(404, "LIVE_ORDER_NOT_FOUND", "Assigned live order not found");
      }
      if (!["Out With Representative", "Representative On The Way"].includes(order.status)) {
        throw new AppError(409, "LIVE_ORDER_STATE_INVALID", "Only active assigned orders can change live route state");
      }

      if (state === "current") {
        const previousCurrent = await client.query<{ id: string; order_code: string }>(
          `SELECT id::text, order_code
             FROM orders
            WHERE representative_user_id=$1
              AND status='Representative On The Way'
              AND id<>$2::uuid
              AND NOT is_deleted
              AND NOT is_archived
            FOR UPDATE`,
          [order.representative_user_id, order.id],
        );
        if (previousCurrent.rows.length) {
          await client.query(
            `UPDATE orders
                SET status='Out With Representative',
                    delivery_started_at=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE id = ANY($1::uuid[])`,
            [previousCurrent.rows.map((row) => row.id)],
          );
          await client.query(
            `UPDATE delivery_route_stops
                SET route_state='upcoming', updated_at=now()
              WHERE representative_user_id=$1
                AND order_id = ANY($2::uuid[])`,
            [order.representative_user_id, previousCurrent.rows.map((row) => row.id)],
          );
        }
        await client.query(
          `UPDATE orders
              SET status='Representative On The Way',
                  delivery_started_at=COALESCE(delivery_started_at,now()),
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [order.id],
        );
      } else if (order.status === "Representative On The Way") {
        await client.query(
          `UPDATE orders
              SET status='Out With Representative',
                  delivery_started_at=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [order.id],
        );
      }

      await client.query(
        `INSERT INTO delivery_route_stops (
           representative_user_id,order_id,sequence_number,route_state,note,
           started_at,completed_at,updated_at
         ) VALUES (
           $1,$2,
           COALESCE((SELECT MAX(sequence_number)+1 FROM delivery_route_stops WHERE representative_user_id=$1),1),
           $3,$4,
           CASE WHEN $3='current' THEN now() ELSE NULL END,
           NULL,now()
         )
         ON CONFLICT (representative_user_id,order_id) DO UPDATE SET
           route_state=EXCLUDED.route_state,
           note=EXCLUDED.note,
           started_at=CASE WHEN EXCLUDED.route_state='current'
             THEN COALESCE(delivery_route_stops.started_at,now())
             ELSE delivery_route_stops.started_at END,
           updated_at=now()`,
        [order.representative_user_id, order.id, state, note || null],
      );

      await client.query(
        `INSERT INTO audit_logs (
           actor_type,actor_id,action,entity_type,entity_id,request_id,metadata
         ) VALUES ('staff',$1,'LIVE_ROUTE_STATE_CHANGED','orders',$2,$3,$4::jsonb)`,
        [
          actorId,
          order.order_code,
          requestId,
          JSON.stringify({ state, note, representativeId: order.representative_user_id }),
        ],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async reorderLiveRoute(
    actorId: string,
    representativeUserId: string,
    orderCodes: string[],
    requestId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const activeResult = await client.query<{ id: string; order_code: string }>(
        `SELECT id::text, order_code
           FROM orders
          WHERE representative_user_id=$1
            AND status IN ('Out With Representative','Representative On The Way')
            AND NOT is_deleted
            AND NOT is_archived
          FOR UPDATE`,
        [representativeUserId],
      );
      const activeCodes = new Set(activeResult.rows.map((row) => row.order_code));
      if (
        orderCodes.length !== activeCodes.size ||
        new Set(orderCodes).size !== orderCodes.length ||
        orderCodes.some((code) => !activeCodes.has(code))
      ) {
        throw new AppError(
          409,
          "LIVE_ROUTE_ORDER_MISMATCH",
          "Route ordering must contain every currently active assigned order exactly once",
        );
      }
      const byCode = new Map(activeResult.rows.map((row) => [row.order_code, row.id]));
      for (let index = 0; index < orderCodes.length; index += 1) {
        const code = orderCodes[index]!;
        await client.query(
          `INSERT INTO delivery_route_stops (
             representative_user_id,order_id,sequence_number,route_state,manually_ordered,updated_at
           ) VALUES (
             $1,$2,$3,
             CASE WHEN (SELECT status FROM orders WHERE id=$2::uuid)='Representative On The Way'
               THEN 'current' ELSE 'upcoming' END,
             true,now()
           )
           ON CONFLICT (representative_user_id,order_id) DO UPDATE SET
             sequence_number=EXCLUDED.sequence_number,
             manually_ordered=true,
             updated_at=now()`,
          [representativeUserId, byCode.get(code), index + 1],
        );
      }
      await client.query(
        `INSERT INTO audit_logs (
           actor_type,actor_id,action,entity_type,entity_id,request_id,metadata
         ) VALUES ('staff',$1,'LIVE_ROUTE_REORDERED','representatives',$2,$3,$4::jsonb)`,
        [actorId, representativeUserId, requestId, JSON.stringify({ orderCodes })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
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
      route_state: string | null;
      sequence_number: number | null;
      item_rows: Array<Record<string, unknown>>;
    }>(
      `SELECT o.id::text, o.order_code, o.status, o.payment_method, o.payment_status,
              o.final_minor::text, o.contact_snapshot, o.delivery_address,
              o.delivery_notes, o.created_at, o.delivery_started_at,
              drs.route_state, drs.sequence_number,
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
         LEFT JOIN delivery_route_stops drs
           ON drs.order_id=o.id
          AND drs.representative_user_id=o.representative_user_id
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
    const locationResult = await this.pool.query<{
      latitude: number | null;
      longitude: number | null;
    }>(
      "SELECT latitude, longitude FROM representative_locations WHERE representative_user_id=$1",
      [representativeUserId],
    );
    const representativeLocation = locationResult.rows[0] || {
      latitude: null,
      longitude: null,
    };

    const returnRows = await readRelationalDashboardDomain(
      this.pool,
      "returns",
    );
    const returns = returnRows.filter((raw) => {
      const row = raw as Record<string, unknown>;
      return (
        [representativeUserId, repCode].includes(String(row.representativeId || "")) &&
        !row.isDeleted &&
        !row.isArchived &&
        ["Representative Assigned", "Pickup On The Way"].includes(String(row.status || ""))
      );
    }) as Record<string, unknown>[];

    const suggested = suggestedStopOrder(
      representativeLocation.latitude,
      representativeLocation.longitude,
      ordersResult.rows.flatMap((row) => {
        const address = row.delivery_address || {};
        const latitude = Number(address.latitude);
        const longitude = Number(address.longitude);
        return Number.isFinite(latitude) && Number.isFinite(longitude)
          ? [{ orderId: row.order_code, latitude, longitude }]
          : [];
      }),
    );
    const suggestedSequence = new Map(
      suggested.map((stop, index) => [stop.orderId, index + 1]),
    );

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
          routeState:
            row.status === "Representative On The Way"
              ? "current"
              : ["waiting", "problem"].includes(String(row.route_state || ""))
                ? String(row.route_state)
                : "upcoming",
          routeSequence: Number(row.sequence_number || 0),
          suggestedSequence: suggestedSequence.get(row.order_code) || 0,
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
          AND status IN ('Out With Representative','Representative On The Way')
          AND NOT is_deleted
          AND NOT is_archived
        LIMIT 1`,
      [representativeUserId],
    );
    const activeReturnRows = await readRelationalDashboardDomain(
      this.pool,
      "returns",
    );
    const repCodeResult = await this.pool.query<{ representative_code: string }>(
      "SELECT representative_code FROM representatives WHERE user_id=$1 AND approval_status='approved'",
      [representativeUserId],
    );
    const repCode = repCodeResult.rows[0]?.representative_code || "";
    const hasActiveReturn = activeReturnRows.some((raw) => {
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
    action: "start" | "cancel" | "delivered" | "waiting" | "problem",
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
            AND NOT is_archived
          FOR UPDATE`,
        [orderCode, representativeUserId],
      );
      const order = orderResult.rows[0];
      if (!order) {
        throw new AppError(404, "ASSIGNED_ORDER_NOT_FOUND", "This order is not assigned to your account");
      }

      if (action === "start") {
        const previousCurrent = await client.query<{ id: string; order_code: string }>(
          `SELECT id::text, order_code
             FROM orders
            WHERE representative_user_id=$1
              AND status='Representative On The Way'
              AND id<>$2::uuid
              AND NOT is_deleted
              AND NOT is_archived
            FOR UPDATE`,
          [representativeUserId, order.id],
        );
        if (previousCurrent.rows.length) {
          await client.query(
            `UPDATE orders
                SET status='Out With Representative',
                    delivery_started_at=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE id = ANY($1::uuid[])`,
            [previousCurrent.rows.map((row) => row.id)],
          );
          await client.query(
            `UPDATE delivery_route_stops
                SET route_state='upcoming', updated_at=now()
              WHERE representative_user_id=$1
                AND order_id = ANY($2::uuid[])`,
            [representativeUserId, previousCurrent.rows.map((row) => row.id)],
          );
          for (const previous of previousCurrent.rows) {
            await client.query(
              `INSERT INTO order_events (
                 order_id,event_type,from_status,to_status,actor_type,actor_id,metadata
               ) VALUES (
                 $1,'DELIVERY_ROUTE_SWITCHED','Representative On The Way','Out With Representative',
                 'representative',$2,$3::jsonb
               )`,
              [
                previous.id,
                representativeUserId,
                JSON.stringify({ nextOrderCode: orderCode }),
              ],
            );
          }
        }
      }

      if (action === "start" && order.status === "Representative On The Way") {
        await client.query("COMMIT");
        return {
          orderId: orderCode,
          status: order.status,
          finalAmount: Number(order.final_minor) / 100,
        };
      }

      let nextStatus: string;
      if (action === "start") {
        if (!["Out With Representative", "Representative On The Way"].includes(order.status)) {
          throw new AppError(409, "ORDER_STATE_INVALID", "This delivery cannot be started from its current status");
        }
        nextStatus = "Representative On The Way";
      } else if (["cancel", "waiting", "problem"].includes(action)) {
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
      const routeState =
        action === "start"
          ? "current"
          : action === "delivered"
            ? "delivered"
            : action === "waiting"
              ? "waiting"
              : action === "problem"
                ? "problem"
                : "upcoming";
      await client.query(
        `INSERT INTO delivery_route_stops (
           representative_user_id,order_id,sequence_number,route_state,note,
           started_at,completed_at,updated_at
         ) VALUES (
           $1,$2,
           COALESCE((SELECT MAX(sequence_number)+1 FROM delivery_route_stops WHERE representative_user_id=$1),1),
           $3,
           CASE WHEN $3='problem' THEN 'Representative reported a delivery problem' ELSE NULL END,
           CASE WHEN $3='current' THEN now() ELSE NULL END,
           CASE WHEN $3='delivered' THEN now() ELSE NULL END,
           now()
         )
         ON CONFLICT (representative_user_id,order_id) DO UPDATE SET
           route_state=EXCLUDED.route_state,
           note=EXCLUDED.note,
           started_at=CASE WHEN EXCLUDED.route_state='current'
             THEN COALESCE(delivery_route_stops.started_at,now())
             ELSE delivery_route_stops.started_at END,
           completed_at=CASE WHEN EXCLUDED.route_state='delivered'
             THEN now() ELSE delivery_route_stops.completed_at END,
           updated_at=now()`,
        [representativeUserId, order.id, routeState],
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
          JSON.stringify({ from: order.status, to: nextStatus, routeState }),
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

  public async recordAdminReturn(
    actorId: string,
    input: {
      itemCode: string;
      reason: string;
      condition: "Good" | "Damaged";
      refundAmount?: number | undefined;
      notes?: string | undefined;
    },
    requestId: string,
    returnRef?: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const returnsStateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE",
      );
      const returnsState = returnsStateResult.rows[0];
      const returnsRows = await readRelationalDashboardDomain(
        client,
        "returns",
      ) as Record<string, unknown>[];

      const existing = returnRef
        ? returnsRows.find(
            (row) =>
              (String(row.id || "") === returnRef ||
                String(row.returnId || "") === returnRef) &&
              !row.isDeleted,
          ) || null
        : null;

      if (returnRef && !existing) {
        throw new AppError(404, "RETURN_NOT_FOUND", "Return record not found");
      }

      const requestedItemCode = String(input.itemCode || "").trim();
      if (existing && String(existing.itemCode || "") !== requestedItemCode) {
        throw new AppError(
          409,
          "RETURN_ITEM_LOCKED",
          "The physical item cannot be changed after a return record is created",
        );
      }

      const lineResult = await client.query<{
        order_id: string;
        order_code: string;
        order_status: string;
        final_minor: string;
        amount_refunded_minor: string;
        promotion: Record<string, unknown> | null;
        customer_user_id: string | null;
        client_code: string | null;
        customer_name: string | null;
        email: string | null;
        contact_snapshot: Record<string, unknown>;
        inventory_item_id: string;
        item_code: string;
        model_id: string;
        model_name: string;
        color: string;
        size: string;
        final_unit_minor: string;
      }>(
        `SELECT o.id::text AS order_id, o.order_code, o.status AS order_status,
                o.final_minor::text, o.amount_refunded_minor::text, o.promotion,
                o.customer_user_id::text, c.client_code, c.full_name AS customer_name,
                u.email, o.contact_snapshot,
                oi.inventory_item_id, oi.item_code, oi.model_id, oi.model_name,
                oi.color, oi.size, oi.final_unit_minor::text
           FROM orders o
           JOIN order_items oi ON oi.order_id=o.id
           LEFT JOIN customers c ON c.user_id=o.customer_user_id
           LEFT JOIN users u ON u.id=o.customer_user_id
          WHERE oi.item_code=$1
            AND o.status='Delivered'
            AND NOT o.is_deleted
          ORDER BY o.delivered_at DESC NULLS LAST, o.created_at DESC
          LIMIT 1
          FOR UPDATE OF o, oi`,
        [requestedItemCode],
      );
      const line = lineResult.rows[0];
      if (!line) {
        throw new AppError(
          422,
          "RETURN_NOT_ELIGIBLE",
          "Manual return intake requires an item from a delivered order",
        );
      }

      const inventoryResult = await client.query<{
        id: string;
        status: string;
        model_id: string;
        color: string;
        size: string;
      }>(
        `SELECT id, status, model_id, color, size
           FROM inventory_items
          WHERE id=$1
          FOR UPDATE`,
        [line.inventory_item_id],
      );
      const inventory = inventoryResult.rows[0];
      if (!inventory) {
        throw new AppError(409, "RETURN_ITEM_NOT_FOUND", "Physical item not found");
      }

      const duplicate = returnsRows.some((row) =>
        row !== existing &&
        String(row.itemCode || "") === requestedItemCode &&
        !row.isDeleted &&
        !["Rejected", "Closed"].includes(String(row.status || "")),
      );
      if (duplicate) {
        throw new AppError(
          409,
          "RETURN_ALREADY_EXISTS",
          "A return record already exists for this physical item",
        );
      }

      const previousRefundMinor = existing
        ? Math.max(0, Math.round((Number(existing.refundAmount) || 0) * 100))
        : 0;
      const requestedRefundMinor = Math.max(
        0,
        Math.round((Number(input.refundAmount) || 0) * 100),
      );
      const currentOrderRefundedMinor = Number(line.amount_refunded_minor || 0);
      const availableRefundMinor = Math.max(
        0,
        Number(line.final_minor || 0) - currentOrderRefundedMinor + previousRefundMinor,
      );
      const lineRefundLimitMinor = Number(line.final_unit_minor || 0);

      if (
        requestedRefundMinor > availableRefundMinor ||
        requestedRefundMinor > lineRefundLimitMinor
      ) {
        throw new AppError(
          422,
          "REFUND_AMOUNT_INVALID",
          "Refund exceeds the remaining refundable amount for this order item",
        );
      }

      const contact = line.contact_snapshot || {};
      const now = new Date().toISOString();
      let record = existing;

      if (!record) {
        const sequence = await client.query<{ value: string }>(
          "SELECT nextval('dart_return_request_seq')::text AS value",
        );
        record = {
          id: randomUUID(),
          returnId: `R-${sequence.rows[0]!.value}`,
          orderId: line.order_code,
          clientId: line.client_code || "",
          clientName: line.customer_name || String(contact.name || ""),
          phone1: String(contact.phone1 || ""),
          phone2: String(contact.phone2 || "-"),
          email: line.email || String(contact.email || ""),
          itemCode: line.item_code,
          modelId: line.model_id,
          requestType: "Refund",
          isPostDeliveryReturn: true,
          originalNetAmount: Number(line.final_unit_minor) / 100,
          originalLineSnapshot: {
            itemId: line.inventory_item_id,
            itemCode: line.item_code,
            modelCode: line.model_id,
            name: line.model_name,
            color: line.color,
            size: line.size,
            qty: 1,
            finalUnitPrice: Number(line.final_unit_minor) / 100,
          },
          createdAt: now,
          date: now,
          isArchived: false,
          isDeleted: false,
          isChecked: false,
        };
        returnsRows.unshift(record);
      }

      const previousCondition = String(
        record.inspectionStatus || record.status || "",
      );
      Object.assign(record, {
        reason: String(input.reason || "Other"),
        notes: String(input.notes || ""),
        status: "Completed",
        inspectionStatus: input.condition,
        completedAt: String(record.completedAt || now),
        inspectedAt: now,
        updatedAt: now,
        refundAmount: requestedRefundMinor / 100,
        financialCompletionApplied: requestedRefundMinor > 0,
      });

      if (input.condition === "Good") {
        await client.query(
          `UPDATE inventory_items
              SET status='In stock',
                  order_id=NULL,
                  purchase_date=NULL,
                  return_request_id=NULL,
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [inventory.id],
        );
      } else {
        await client.query(
          `UPDATE inventory_items
              SET status='Damaged',
                  return_request_id=$2,
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [inventory.id, String(record.id)],
        );
      }

      const damageStateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='damage'",
      );
      const damageState = damageStateResult.rows[0];
      const damageRows = await readRelationalDashboardDomain(
        client,
        "damage",
      ) as Record<string, unknown>[];
      const existingDamageIndex = damageRows.findIndex(
        (row) =>
          String(row.itemCode || "") === requestedItemCode &&
          !row.isDeleted,
      );

      if (input.condition === "Damaged") {
        const damageRecord = {
          id:
            existingDamageIndex >= 0
              ? String(damageRows[existingDamageIndex]!.id || randomUUID())
              : randomUUID(),
          damageId:
            existingDamageIndex >= 0
              ? String(damageRows[existingDamageIndex]!.damageId || `DMG-${Date.now()}`)
              : `DMG-${Date.now()}`,
          itemCode: requestedItemCode,
          modelId: line.model_id,
          color: line.color,
          size: line.size,
          status: "Damaged",
          reason: String(input.reason || "Manual return inspection - Damaged"),
          notes: String(input.notes || ""),
          date: now,
          createdAt:
            existingDamageIndex >= 0
              ? String(damageRows[existingDamageIndex]!.createdAt || now)
              : now,
          inspectedAt: now,
          orderId: line.order_code,
          returnId: String(record.returnId || ""),
          clientId: line.client_code || "",
          clientName: line.customer_name || String(contact.name || ""),
          isArchived: false,
          isDeleted: false,
          isChecked: false,
        };
        if (existingDamageIndex >= 0) {
          damageRows[existingDamageIndex] = {
            ...damageRows[existingDamageIndex],
            ...damageRecord,
          };
        } else {
          damageRows.unshift(damageRecord);
        }
      } else if (existingDamageIndex >= 0) {
        damageRows.splice(existingDamageIndex, 1);
      }

      const nextRefundedMinor = Math.max(
        0,
        currentOrderRefundedMinor - previousRefundMinor + requestedRefundMinor,
      );
      await client.query(
        `UPDATE orders
            SET amount_refunded_minor=$2,
                payment_status=CASE
                  WHEN $2 >= final_minor AND $2 > 0 THEN 'Refunded'
                  WHEN $2 > 0 THEN 'Partially Refunded'
                  WHEN amount_paid_minor > 0 THEN 'Paid'
                  ELSE 'Unpaid'
                END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [line.order_id, nextRefundedMinor],
      );

      if (
        line.promotion?.type === "Dart Card" &&
        line.promotion?.cardId &&
        !existing &&
        requestedRefundMinor > 0
      ) {
        const cardStateResult = await client.query<{ version: string }>(
          "SELECT version::text FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE",
        );
        const cardState = cardStateResult.rows[0];
        const cards = await readRelationalDashboardDomain(
          client,
          "cards",
        ) as Record<string, unknown>[];
        const card = cards.find(
          (row) =>
            String(row.cardId || row.id || "") ===
            String(line.promotion?.cardId),
        );
        if (card) {
          card.purchasedItems = String(
            Math.max(0, Number(card.purchasedItems || 0) - 1),
          );
          card.requestedProducts = (
            Array.isArray(card.requestedProducts)
              ? card.requestedProducts
              : []
          ).filter((code) => String(code) !== requestedItemCode);
          const limit = Number(card.itemLimit || card.purchasedLimit || 10);
          const expiry = flexibleDateExpiry(card.expDate);
          if (
            Number(card.purchasedItems || 0) < limit &&
            (!expiry || expiry >= Date.now())
          ) {
            card.status = "Active";
          }
          record.dartCardUsageReversed = true;
          await client.query(
            `UPDATE dashboard_domain_state
                SET data=$2::jsonb, version=$3, updated_at=now()
              WHERE domain='cards'`,
            [
              JSON.stringify(cards),
              Number(cardState?.version || 1) + 1,
            ],
          );
        }
      }

      const activityLog = Array.isArray(record.activityLog)
        ? record.activityLog as Record<string, unknown>[]
        : [];
      activityLog.push({
        id: randomUUID(),
        action: existing ? "MANUAL_RETURN_UPDATED" : "MANUAL_RETURN_RECORDED",
        previousCondition,
        condition: input.condition,
        refundAmount: requestedRefundMinor / 100,
        timestamp: now,
        actorRole: "Admin",
        actorId,
      });
      record.activityLog = activityLog;

      await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb, version=$3, updated_by=$4, updated_at=now()
          WHERE domain='returns'`,
        [
          JSON.stringify(returnsRows),
          Number(returnsState?.version || 1) + 1,
          actorId,
        ],
      );
      await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb, version=$3, updated_by=$4, updated_at=now()
          WHERE domain='damage'`,
        [
          JSON.stringify(damageRows),
          Number(damageState?.version || 1) + 1,
          actorId,
        ],
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,$2,'returns',$3,$4,$5::jsonb)`,
        [
          actorId,
          existing ? "MANUAL_RETURN_UPDATED" : "MANUAL_RETURN_RECORDED",
          String(record.id),
          requestId,
          JSON.stringify({
            returnId: record.returnId || "",
            orderCode: line.order_code,
            itemCode: requestedItemCode,
            condition: input.condition,
            refundAmount: requestedRefundMinor / 100,
          }),
        ],
      );

      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminManualReturn(
    actorId: string,
    input: {
      existingReturnId?: string | undefined;
      itemCode: string;
      reason: string;
      condition: "Good" | "Bad";
      refundAmount: number;
      clientName?: string | undefined;
      phone1?: string | undefined;
      phone2?: string | undefined;
      email?: string | undefined;
    },
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const itemResult = await client.query<{
        item_id: string;
        item_code: string;
        model_id: string;
        color: string;
        size: string;
        item_status: string;
        order_db_id: string;
        order_code: string;
        customer_user_id: string;
        final_minor: string;
        amount_refunded_minor: string;
        payment_status: string;
        promotion: Record<string, unknown> | null;
        contact_snapshot: Record<string, unknown>;
        client_code: string | null;
        line_final_minor: string;
      }>(
        `SELECT i.id AS item_id, i.item_code, i.model_id, i.color, i.size,
                i.status AS item_status,
                o.id::text AS order_db_id, o.order_code, o.customer_user_id::text,
                o.final_minor::text, o.amount_refunded_minor::text,
                o.payment_status, o.promotion, o.contact_snapshot,
                c.client_code, oi.final_unit_minor::text AS line_final_minor
           FROM inventory_items i
           JOIN order_items oi ON oi.inventory_item_id=i.id
           JOIN orders o ON o.id=oi.order_id
           LEFT JOIN customers c ON c.user_id=o.customer_user_id
          WHERE lower(i.item_code)=lower($1)
            AND o.status='Delivered'
            AND NOT o.is_deleted
          ORDER BY o.delivered_at DESC NULLS LAST, o.created_at DESC
          LIMIT 1
          FOR UPDATE OF i, o`,
        [input.itemCode.trim()],
      );
      const item = itemResult.rows[0];
      if (!item) {
        throw new AppError(
          409,
          "MANUAL_RETURN_ITEM_INVALID",
          "Manual returns require an item from a delivered order",
        );
      }

      const returnsStateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE",
      );
      const returnsState = returnsStateResult.rows[0];
      const returnsRows = await readRelationalDashboardDomain(
        client,
        "returns",
      ) as Record<string, unknown>[];

      const existingId = String(input.existingReturnId || "").trim();
      const existing = existingId
        ? returnsRows.find(
            (row) =>
              String(row.id || "") === existingId ||
              String(row.returnId || "") === existingId,
          )
        : null;

      if (existing && !existing.manualAdmin) {
        throw new AppError(
          409,
          "MANUAL_RETURN_EDIT_INVALID",
          "Customer return requests must be managed through the return workflow",
        );
      }

      const duplicate = returnsRows.find(
        (row) =>
          row !== existing &&
          String(row.itemCode || "").toLowerCase() === item.item_code.toLowerCase() &&
          !row.isDeleted &&
          !["Rejected", "Closed"].includes(String(row.status || "")),
      );
      if (duplicate) {
        throw new AppError(409, "RETURN_ALREADY_EXISTS", "An active return already exists for this item");
      }

      const previousRefundMinor = existing
        ? Math.max(0, Math.round(Number(existing.refundAmount || 0) * 100))
        : 0;
      const requestedRefundMinor = Math.max(
        0,
        Math.round(Number(input.refundAmount || 0) * 100),
      );
      const currentRefundedMinor = Number(item.amount_refunded_minor || 0);
      const baseWithoutThisReturn = Math.max(0, currentRefundedMinor - previousRefundMinor);
      const maxRemainingMinor = Math.max(0, Number(item.final_minor || 0) - baseWithoutThisReturn);
      if (requestedRefundMinor > maxRemainingMinor) {
        throw new AppError(
          422,
          "REFUND_AMOUNT_TOO_HIGH",
          `Maximum remaining refundable amount is ${(maxRemainingMinor / 100).toFixed(2)} EGP`,
        );
      }

      if (
        existing &&
        String(existing.condition || existing.inspectionStatus || "") &&
        String(existing.condition || existing.inspectionStatus) !==
          (input.condition === "Bad" ? "Damaged" : "Good")
      ) {
        throw new AppError(
          409,
          "MANUAL_RETURN_CONDITION_IMMUTABLE",
          "Use the inspection workflow instead of changing a saved manual return condition",
        );
      }

      let returnId = String(existing?.returnId || "");
      if (!returnId) {
        const seq = await client.query<{ value: string }>(
          "SELECT nextval('dart_return_request_seq')::text AS value",
        );
        returnId = `R-${seq.rows[0]!.value}`;
      }
      const recordId = String(existing?.id || randomUUID());
      const now = new Date().toISOString();
      const condition = input.condition === "Bad" ? "Damaged" : "Good";
      const contact = item.contact_snapshot || {};

      const record: Record<string, unknown> = existing || {};
      Object.assign(record, {
        id: recordId,
        returnId,
        manualAdmin: true,
        requestType: "Refund",
        clientName: String(input.clientName || contact.name || ""),
        clientId: String(item.client_code || ""),
        itemCode: item.item_code,
        modelId: item.model_id,
        color: item.color,
        size: item.size,
        phone1: String(input.phone1 || contact.phone1 || ""),
        phone2: String(input.phone2 || contact.phone2 || "-"),
        email: String(input.email || contact.email || ""),
        reason: String(input.reason || "Other"),
        condition,
        inspectionStatus: condition,
        status: condition,
        orderId: item.order_code,
        isPostDeliveryReturn: true,
        refundAmount: requestedRefundMinor / 100,
        originalNetAmount: Number(item.line_final_minor || 0) / 100,
        financialCompletionApplied: requestedRefundMinor > 0,
        inspectedAt: now,
        completedAt: now,
        updatedAt: now,
        isArchived: Boolean(existing?.isArchived),
        isDeleted: false,
        isChecked: false,
        createdAt: String(existing?.createdAt || now),
      });

      if (!existing) {
        returnsRows.unshift(record);
      }

      if (condition === "Good") {
        await client.query(
          `UPDATE inventory_items
              SET status='In stock',
                  order_id=NULL,
                  purchase_date=NULL,
                  return_request_id=NULL,
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  active=true,
                  is_archived=false,
                  is_deleted=false,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [item.item_id],
        );
      } else {
        await client.query(
          `UPDATE inventory_items
              SET status='Damaged',
                  order_id=NULL,
                  purchase_date=NULL,
                  return_request_id=$2,
                  cart_reservation_id=NULL,
                  reservation_until=NULL,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [item.item_id, recordId],
        );

        const damageStateResult = await client.query<{ version: string }>(
          "SELECT version::text FROM dashboard_domain_state WHERE domain='damage' FOR UPDATE",
        );
        const damageState = damageStateResult.rows[0];
        const damageRows = await readRelationalDashboardDomain(
          client,
          "damage",
        ) as Record<string, unknown>[];
        const damage = damageRows.find(
          (row) =>
            String(row.returnId || "") === returnId ||
            String(row.itemCode || "").toLowerCase() === item.item_code.toLowerCase(),
        );
        const damageRecord = damage || {};
        Object.assign(damageRecord, {
          id: String(damage?.id || randomUUID()),
          damageId: String(damage?.damageId || `DMG-${Date.now()}`),
          itemCode: item.item_code,
          modelId: item.model_id,
          color: item.color,
          size: item.size,
          status: "Damaged",
          reason: String(input.reason || "Manual return - Damaged"),
          date: now,
          createdAt: String(damage?.createdAt || now),
          updatedAt: now,
          inspectedAt: now,
          orderId: item.order_code,
          clientId: String(item.client_code || ""),
          clientName: String(input.clientName || contact.name || ""),
          returnId,
          requestType: "Refund",
          isArchived: false,
          isDeleted: false,
          isChecked: false,
        });
        if (!damage) damageRows.unshift(damageRecord);

        const damageVersion = Number(damageState?.version || 1);
        const damageUpdate = await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb,
                  version=version+1,
                  updated_by=$3,
                  updated_at=now()
            WHERE domain='damage' AND version=$4`,
          ["damage", JSON.stringify(damageRows), actorId, damageVersion],
        );
        if (!damageUpdate.rowCount) {
          throw new AppError(
            409,
            "DAMAGE_VERSION_CONFLICT",
            "Damage records changed while the manual return was being saved",
          );
        }
      }

      const newRefundedMinor = baseWithoutThisReturn + requestedRefundMinor;
      await client.query(
        `UPDATE orders
            SET amount_refunded_minor=$2,
                payment_status=CASE
                  WHEN $2 >= final_minor AND $2 > 0 THEN 'Refunded'
                  WHEN $2 > 0 THEN 'Partially Refunded'
                  WHEN lower(payment_method) LIKE '%cash%' THEN 'Paid'
                  ELSE payment_status
                END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [item.order_db_id, newRefundedMinor],
      );

      if (
        item.promotion?.type === "Dart Card" &&
        item.promotion?.cardId &&
        !record.dartCardUsageReversed
      ) {
        const cardStateResult = await client.query<{ version: string }>(
          "SELECT version::text FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE",
        );
        const cardState = cardStateResult.rows[0];
        const cards = await readRelationalDashboardDomain(
          client,
          "cards",
        ) as Record<string, unknown>[];
        const card = cards.find(
          (row) =>
            String(row.cardId || row.id || "") === String(item.promotion?.cardId),
        );
        if (card) {
          card.purchasedItems = String(
            Math.max(0, Number(card.purchasedItems || 0) - 1),
          );
          card.requestedProducts = (
            Array.isArray(card.requestedProducts) ? card.requestedProducts : []
          ).filter((code) => String(code) !== item.item_code);
          const limit = Number(card.itemLimit || card.purchasedLimit || 10);
          const expiry = flexibleDateExpiry(card.expDate);
          if (
            Number(card.purchasedItems || 0) < limit &&
            (!expiry || expiry >= Date.now())
          ) {
            card.status = "Active";
          }
          record.dartCardUsageReversed = true;
          await client.query(
            `UPDATE dashboard_domain_state
                SET data=$2::jsonb,
                    version=version+1,
                    updated_at=now()
              WHERE domain='cards' AND version=$3`,
            ["cards", JSON.stringify(cards), Number(cardState?.version || 1)],
          );
        }
      }

      const returnsVersion = Number(returnsState?.version || 1);
      const returnsUpdate = await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb,
                version=version+1,
                updated_by=$3,
                updated_at=now()
          WHERE domain='returns' AND version=$4`,
        ["returns", JSON.stringify(returnsRows), actorId, returnsVersion],
      );
      if (!returnsUpdate.rowCount) {
        throw new AppError(
          409,
          "RETURN_VERSION_CONFLICT",
          "Return records changed while the manual return was being saved",
        );
      }

      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id,
           old_values, new_values, metadata
         ) VALUES ('staff',$1,$2,'returns',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
        [
          actorId,
          existing ? "MANUAL_RETURN_UPDATED" : "MANUAL_RETURN_CREATED",
          recordId,
          requestId,
          JSON.stringify(
            existing
              ? {
                  condition: existing.condition || existing.inspectionStatus || "",
                  refundAmount: Number(existing.refundAmount || 0),
                }
              : {},
          ),
          JSON.stringify({
            condition,
            refundAmount: requestedRefundMinor / 100,
          }),
          JSON.stringify({
            returnId,
            orderId: item.order_code,
            itemCode: item.item_code,
          }),
        ],
      );

      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminReturnAction(
    actorId: string,
    returnRef: string,
    input: {
      action: "approve" | "reject" | "assign" | "inspect" | "back";
      replacementItemCode?: string | undefined;
      reason?: string | undefined;
      representativeId?: string | undefined;
      condition?: "Good" | "Damaged" | undefined;
    },
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const returnsStateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE",
      );
      const returnsState = returnsStateResult.rows[0];
      const rows = await readRelationalDashboardDomain(
        client,
        "returns",
      ) as Record<string, unknown>[];
      const record = rows.find(
        (row) =>
          String(row.id || "") === returnRef ||
          String(row.returnId || "") === returnRef,
      );
      if (!record || record.isDeleted) {
        throw new AppError(404, "RETURN_NOT_FOUND", "Return request not found");
      }

      const previousStatus = String(record.status || "");
      const now = new Date().toISOString();
      let inventoryChanged = false;

      if (input.action === "approve") {
        if (previousStatus !== "Pending Request") {
          throw new AppError(409, "RETURN_STATE_INVALID", "Only pending return requests can be approved");
        }

        if (String(record.requestType || "") === "Exchange") {
          const replacementCode = String(input.replacementItemCode || "").trim();
          if (!replacementCode) {
            throw new AppError(422, "EXCHANGE_REPLACEMENT_REQUIRED", "Choose a replacement item");
          }
          const replacementResult = await client.query<{
            id: string;
            item_code: string;
            model_id: string;
            color: string;
            size: string;
            status: string;
          }>(
            `SELECT id, item_code, model_id, color, size, status
               FROM inventory_items
              WHERE item_code=$1
                AND active
                AND NOT is_archived
                AND NOT is_deleted
              FOR UPDATE`,
            [replacementCode],
          );
          const replacement = replacementResult.rows[0];
          if (!replacement || String(replacement.status).toLowerCase() !== "in stock") {
            throw new AppError(409, "EXCHANGE_STOCK_UNAVAILABLE", "Replacement item is no longer in stock");
          }
          if (
            String(replacement.model_id) !== String(record.modelId || "") ||
            String(replacement.color) !== String(record.requestedColor || "") ||
            String(replacement.size) !== String(record.requestedSize || "")
          ) {
            throw new AppError(
              409,
              "EXCHANGE_VARIANT_MISMATCH",
              "Replacement must match the requested model, color and size",
            );
          }
          await client.query(
            `UPDATE inventory_items
                SET status='Processing/Held',
                    order_id=$2,
                    return_request_id=$3,
                    cart_reservation_id=NULL,
                    reservation_until=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE id=$1`,
            [
              replacement.id,
              String(record.orderId || ""),
              String(record.id || returnRef),
            ],
          );
          record.replacementItemCode = replacement.item_code;
          record.replacementItemId = replacement.id;
          record.replacementLineSnapshot = {
            ...(record.originalLineSnapshot as Record<string, unknown> || {}),
            itemId: replacement.id,
            itemCode: replacement.item_code,
            modelCode: replacement.model_id,
            color: replacement.color,
            size: replacement.size,
            exchangedFromItemCode: record.itemCode || "",
          };
          inventoryChanged = true;
        }

        record.status = "Approved - Awaiting Representative";
        record.acceptedAt = now;
        record.updatedAt = now;
        record.inspectionStatus = String(record.inspectionStatus || "Pending");
      }

      if (input.action === "reject") {
        if (previousStatus !== "Pending Request") {
          throw new AppError(409, "RETURN_STATE_INVALID", "Only pending return requests can be rejected");
        }
        const reason = String(input.reason || "").trim();
        if (reason.length < 3) {
          throw new AppError(422, "RETURN_REJECTION_REASON_REQUIRED", "A rejection reason is required");
        }
        record.status = "Rejected";
        record.rejectionReason = reason;
        record.rejectedAt = now;
        record.updatedAt = now;
      }

      if (input.action === "assign") {
        if (previousStatus !== "Approved - Awaiting Representative") {
          throw new AppError(409, "RETURN_STATE_INVALID", "Approve the return before assigning a representative");
        }
        const representativeRef = String(input.representativeId || "").trim();
        const representativeResult = await client.query<{
          user_id: string;
          representative_code: string;
          full_name: string;
          phone: string | null;
        }>(
          `SELECT r.user_id::text, r.representative_code, r.full_name,
                  (
                    SELECT p.phone_display
                      FROM account_phones p
                     WHERE p.user_id=r.user_id
                       AND p.account_type='representative'
                     ORDER BY p.is_primary DESC, p.created_at
                     LIMIT 1
                  ) AS phone
             FROM representatives r
             JOIN users u ON u.id=r.user_id
            WHERE (r.user_id::text=$1 OR r.representative_code=$1)
              AND r.approval_status='approved'
              AND u.status='active'
            LIMIT 1`,
          [representativeRef],
        );
        const representative = representativeResult.rows[0];
        if (!representative) {
          throw new AppError(409, "REPRESENTATIVE_UNAVAILABLE", "Choose an active representative");
        }
        record.status = "Representative Assigned";
        record.representativeId = representative.user_id;
        record.representativeBusinessId = representative.representative_code;
        record.representativeName = representative.full_name;
        record.representativePhone = representative.phone || "";
        record.pickupGroupId = String(record.pickupGroupId || `RPG-${Date.now()}`);
        record.assignedAt = now;
        record.updatedAt = now;
      }

      if (input.action === "back") {
        if (previousStatus === "Pickup On The Way") {
          record.status = "Representative Assigned";
          record.pickupStartedAt = null;
          record.courierLocation = null;
          record.updatedAt = now;
        } else if (previousStatus === "Representative Assigned") {
          record.status = "Approved - Awaiting Representative";
          record.representativeId = "";
          record.representativeBusinessId = "";
          record.representativeName = "";
          record.representativePhone = "";
          record.pickupGroupId = "";
          record.assignedAt = null;
          record.pickupStartedAt = null;
          record.courierLocation = null;
          record.updatedAt = now;
        } else if (previousStatus === "Approved - Awaiting Representative") {
          if (String(record.requestType || "") === "Exchange" && record.replacementItemCode) {
            await client.query(
              `UPDATE inventory_items
                  SET status='In stock',
                      order_id=NULL,
                      return_request_id=NULL,
                      cart_reservation_id=NULL,
                      reservation_until=NULL,
                      version=version+1,
                      updated_at=now()
                WHERE item_code=$1
                  AND status='Processing/Held'`,
              [String(record.replacementItemCode)],
            );
            record.replacementItemCode = "";
            record.replacementItemId = "";
            record.replacementLineSnapshot = null;
            inventoryChanged = true;
          }
          record.status = "Pending Request";
          record.acceptedAt = null;
          record.updatedAt = now;
        } else if (previousStatus === "Rejected") {
          record.status = "Pending Request";
          record.rejectionReason = "";
          record.rejectedAt = null;
          record.updatedAt = now;
        } else {
          throw new AppError(
            409,
            "RETURN_ROLLBACK_INVALID",
            "This return cannot be moved back from its current state",
          );
        }
      }

      if (input.action === "inspect") {
        const isLegacyRefusal =
          !record.isPostDeliveryReturn &&
          previousStatus === "Pending Inspection";
        const isCompletedPostDelivery =
          Boolean(record.isPostDeliveryReturn) &&
          (Boolean(record.completedAt) || previousStatus === "Completed") &&
          String(record.inspectionStatus || "Pending") === "Pending";
        if (!isLegacyRefusal && !isCompletedPostDelivery) {
          throw new AppError(409, "RETURN_INSPECTION_INVALID", "This return is not awaiting inspection");
        }
        const condition = input.condition;
        if (!condition) {
          throw new AppError(422, "RETURN_CONDITION_REQUIRED", "Choose Good or Damaged");
        }

        const itemCode = String(record.itemCode || "");
        const itemResult = await client.query<{ id: string; model_id: string; color: string; size: string }>(
          `SELECT id, model_id, color, size
             FROM inventory_items
            WHERE item_code=$1
            FOR UPDATE`,
          [itemCode],
        );
        const item = itemResult.rows[0];
        if (!item) {
          throw new AppError(409, "RETURN_ITEM_NOT_FOUND", "Returned physical item not found");
        }

        if (condition === "Good") {
          await client.query(
            `UPDATE inventory_items
                SET status='In stock',
                    order_id=NULL,
                    purchase_date=NULL,
                    return_request_id=NULL,
                    cart_reservation_id=NULL,
                    reservation_until=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE id=$1`,
            [item.id],
          );
        } else {
          await client.query(
            `UPDATE inventory_items
                SET status='Damaged',
                    return_request_id=$2,
                    version=version+1,
                    updated_at=now()
              WHERE id=$1`,
            [item.id, String(record.id || returnRef)],
          );

          const damageStateResult = await client.query<{ version: string }>(
            "SELECT version::text FROM dashboard_domain_state WHERE domain='damage' FOR UPDATE",
          );
          const damageState = damageStateResult.rows[0];
          const damageRows = await readRelationalDashboardDomain(
            client,
            "damage",
          ) as Record<string, unknown>[];
          if (!damageRows.some((row) => String(row.itemCode || "") === itemCode && !row.isDeleted)) {
            damageRows.unshift({
              id: randomUUID(),
              damageId: `DMG-${Date.now()}`,
              itemCode,
              modelId: item.model_id,
              color: item.color,
              size: item.size,
              status: "Damaged",
              reason: String(record.reason || "Return inspection - Damaged"),
              date: now,
              createdAt: now,
              inspectedAt: now,
              orderId: String(record.orderId || ""),
              returnId: String(record.returnId || ""),
              requestType: String(record.requestType || "Refund"),
              clientId: String(record.clientId || ""),
              isArchived: false,
              isDeleted: false,
              isChecked: false,
            });
          }
          const damageVersion = Number(damageState?.version || 1);
          const damageUpdate = await client.query(
            `UPDATE dashboard_domain_state
                SET data=$2::jsonb,
                    version=version+1,
                    updated_by=$3,
                    updated_at=now()
              WHERE domain=$1
                AND version=$4`,
            [
              "damage",
              JSON.stringify(damageRows),
              actorId,
              damageVersion,
            ],
          );
          if (!damageUpdate.rowCount) {
            throw new AppError(
              409,
              "DAMAGE_VERSION_CONFLICT",
              "Damage records changed while return inspection was being saved; reload and retry",
            );
          }
        }

        record.inspectionStatus = condition;
        if (isLegacyRefusal) record.status = condition;
        record.inspectedAt = now;
        record.updatedAt = now;
        inventoryChanged = true;
      }

      const activityLog = Array.isArray(record.activityLog)
        ? record.activityLog as Record<string, unknown>[]
        : [];
      activityLog.push({
        id: randomUUID(),
        action: `RETURN_${input.action.toUpperCase()}`,
        previousStatus,
        newStatus: record.status,
        timestamp: now,
        actorRole: "Admin",
        actorId,
        ...(input.condition ? { condition: input.condition } : {}),
      });
      record.activityLog = activityLog;

      const returnsVersion = Number(returnsState?.version || 1);
      const returnsUpdate = await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb,
                version=version+1,
                updated_by=$3,
                updated_at=now()
          WHERE domain=$1
            AND version=$4`,
        [
          "returns",
          JSON.stringify(rows),
          actorId,
          returnsVersion,
        ],
      );
      if (!returnsUpdate.rowCount) {
        throw new AppError(
          409,
          "RETURN_VERSION_CONFLICT",
          "Return records changed while this action was being saved; reload and retry",
        );
      }

      if (inventoryChanged) {
        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
        );
      }

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,$2,'returns',$3,$4,$5::jsonb)`,
        [
          actorId,
          `RETURN_${input.action.toUpperCase()}`,
          String(record.id || returnRef),
          requestId,
          JSON.stringify({
            returnId: record.returnId || "",
            previousStatus,
            newStatus: record.status,
            representativeId: record.representativeId || "",
            condition: input.condition || "",
          }),
        ],
      );

      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async representativeReturnAction(
    representativeUserId: string,
    returnRef: string,
    action: "start" | "cancel" | "complete",
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const representative = await client.query<{ representative_code: string }>(
        "SELECT representative_code FROM representatives WHERE user_id=$1 AND approval_status='approved'",
        [representativeUserId],
      );
      const repCode = representative.rows[0]?.representative_code;
      if (!repCode) {
        throw new AppError(403, "REPRESENTATIVE_UNAVAILABLE", "Representative account is not active");
      }

      const stateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE",
      );
      const state = stateResult.rows[0];
      const rows = await readRelationalDashboardDomain(
        client,
        "returns",
      ) as Record<string, unknown>[];
      const record = rows.find((row) =>
        (String(row.id || "") === returnRef || String(row.returnId || "") === returnRef) &&
        [representativeUserId, repCode].includes(String(row.representativeId || "")) &&
        !row.isDeleted &&
        !row.isArchived,
      );
      if (!record) {
        throw new AppError(404, "ASSIGNED_RETURN_NOT_FOUND", "This return is not assigned to your account");
      }

      if (action === "start" && String(record.status || "") === "Pickup On The Way") {
        await client.query("COMMIT");
        return record;
      }

      const previousStatus = String(record.status || "");
      const now = new Date().toISOString();

      if (action === "start") {
        if (!["Representative Assigned", "Pickup On The Way"].includes(previousStatus)) {
          throw new AppError(409, "RETURN_STATE_INVALID", "This pickup cannot be started from its current status");
        }
        record.status = "Pickup On The Way";
        record.pickupStartedAt = String(record.pickupStartedAt || now);
        record.updatedAt = now;
      } else if (action === "cancel") {
        if (!["Representative Assigned", "Pickup On The Way"].includes(previousStatus)) {
          throw new AppError(409, "RETURN_STATE_INVALID", "This pickup cannot be cancelled from its current status");
        }
        record.status = "Approved - Awaiting Representative";
        record.pickupStartedAt = null;
        record.courierLocation = null;
        record.lastFailedPickupAt = now;
        record.failedPickupAttempts = Number(record.failedPickupAttempts || 0) + 1;
        record.representativeId = "";
        record.representativeBusinessId = "";
        record.representativeName = "";
        record.representativePhone = "";
        record.pickupGroupId = "";
        record.assignedAt = null;
        record.updatedAt = now;
      } else {
        if (previousStatus !== "Pickup On The Way" || !record.pickupStartedAt) {
          throw new AppError(409, "RETURN_STATE_INVALID", "Start pickup before confirming it");
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
          throw new AppError(409, "LOCATION_STALE", "Refresh your location before confirming pickup");
        }
        const destinationLat = Number(record.latitude);
        const destinationLng = Number(record.longitude);
        if (
          !Number.isFinite(destinationLat) ||
          !Number.isFinite(destinationLng) ||
          !destinationLat ||
          !destinationLng
        ) {
          throw new AppError(409, "PICKUP_COORDINATES_MISSING", "Customer pickup coordinates are missing");
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
            "PICKUP_TOO_FAR",
            `You must be within 1 km of the pickup address; current distance is ${distance.toFixed(2)} km`,
          );
        }

        const itemCode = String(record.itemCode || "");
        const originalItemResult = await client.query<{
          id: string;
          status: string;
          model_id: string;
          color: string;
          size: string;
        }>(
          `SELECT id, status, model_id, color, size
             FROM inventory_items
            WHERE item_code=$1
            FOR UPDATE`,
          [itemCode],
        );
        const originalItem = originalItemResult.rows[0];
        if (!originalItem) {
          throw new AppError(409, "RETURN_ITEM_NOT_FOUND", "The original physical item could not be found");
        }

        const orderCode = String(record.orderId || "");
        const orderResult = await client.query<{
          id: string;
          final_minor: string;
          amount_refunded_minor: string;
          promotion: Record<string, unknown> | null;
          payment_status: string;
        }>(
          `SELECT id::text, final_minor::text, amount_refunded_minor::text,
                  promotion, payment_status
             FROM orders
            WHERE order_code=$1
              AND status='Delivered'
              AND NOT is_deleted
              AND NOT is_archived
            FOR UPDATE`,
          [orderCode],
        );
        const order = orderResult.rows[0];
        if (!order) {
          throw new AppError(409, "RETURN_ORDER_NOT_FOUND", "The original delivered order could not be found");
        }

        const requestType = String(record.requestType || "");
        await client.query(
          `UPDATE inventory_items
              SET status='Return Inspection',
                  return_request_id=$2,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [originalItem.id, String(record.id || "")],
        );

        if (requestType === "Refund") {
          const refundMinor = Math.max(
            0,
            Math.round(Number(record.originalNetAmount ?? record.refundAmount ?? 0) * 100),
          );
          const finalMinor = Number(order.final_minor || 0);
          const refundedMinor = Math.min(
            finalMinor,
            Number(order.amount_refunded_minor || 0) + refundMinor,
          );
          await client.query(
            `UPDATE orders
                SET amount_refunded_minor=$2,
                    payment_status=CASE
                      WHEN $2 >= final_minor THEN 'Refunded'
                      WHEN $2 > 0 THEN 'Partially Refunded'
                      ELSE payment_status
                    END,
                    version=version+1,
                    updated_at=now()
              WHERE id=$1`,
            [order.id, refundedMinor],
          );
          record.refundAmount = refundMinor / 100;
          record.financialCompletionApplied = true;

          if (order.promotion?.type === "Dart Card" && order.promotion?.cardId) {
            const cardStateResult = await client.query<{ version: string }>(
              "SELECT version::text FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE",
            );
            const cardState = cardStateResult.rows[0];
            const cards = await readRelationalDashboardDomain(
              client,
              "cards",
            ) as Record<string, unknown>[];
            const card = cards.find(
              (row) => String(row.cardId || row.id || "") === String(order.promotion?.cardId),
            );
            if (card && !record.dartCardUsageReversed) {
              card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - 1));
              card.requestedProducts = (Array.isArray(card.requestedProducts)
                ? card.requestedProducts
                : []
              ).filter((code) => String(code) !== itemCode);
              const limit = Number(card.itemLimit || card.purchasedLimit || 10);
              const expiry = flexibleDateExpiry(card.expDate);
              if (
                Number(card.purchasedItems || 0) < limit &&
                (!expiry || expiry >= Date.now())
              ) {
                card.status = "Active";
              }
              record.dartCardUsageReversed = true;
              await client.query(
                `UPDATE dashboard_domain_state
                    SET data=$2::jsonb, version=$3, updated_at=now()
                  WHERE domain='cards'`,
                [
                  JSON.stringify(cards),
                  Number(cardState?.version || 1) + 1,
                ],
              );
            }
          }
        } else if (requestType === "Exchange") {
          const replacementCode = String(record.replacementItemCode || "");
          if (!replacementCode) {
            throw new AppError(409, "EXCHANGE_REPLACEMENT_MISSING", "A replacement item must be reserved before pickup completion");
          }
          const replacementResult = await client.query<{
            id: string;
            item_code: string;
            model_id: string;
            color: string;
            size: string;
            status: string;
          }>(
            `SELECT id, item_code, model_id, color, size, status
               FROM inventory_items
              WHERE item_code=$1
              FOR UPDATE`,
            [replacementCode],
          );
          const replacement = replacementResult.rows[0];
          if (!replacement || String(replacement.status).toLowerCase() !== "processing/held") {
            throw new AppError(409, "EXCHANGE_REPLACEMENT_UNAVAILABLE", "The held replacement item is no longer available");
          }
          if (
            replacement.model_id !== originalItem.model_id ||
            replacement.color !== originalItem.color ||
            replacement.size !== originalItem.size
          ) {
            throw new AppError(409, "EXCHANGE_VARIANT_MISMATCH", "Replacement must match the original model, color and size");
          }

          await client.query(
            `UPDATE inventory_items
                SET status='Sold',
                    order_id=$2,
                    purchase_date=$3,
                    cart_reservation_id=NULL,
                    reservation_until=NULL,
                    version=version+1,
                    updated_at=now()
              WHERE id=$1`,
            [replacement.id, orderCode, new Date().toISOString().slice(0, 10)],
          );
          const updatedLine = await client.query(
            `UPDATE order_items
                SET inventory_item_id=$3,
                    item_code=$4,
                    model_id=$5,
                    model_name=COALESCE((
                      SELECT name FROM catalog_models WHERE model_id=$5
                    ), model_name),
                    color=$6,
                    size=$7
              WHERE order_id=$1 AND item_code=$2`,
            [
              order.id,
              itemCode,
              replacement.id,
              replacement.item_code,
              replacement.model_id,
              replacement.color,
              replacement.size,
            ],
          );
          if (!updatedLine.rowCount) {
            throw new AppError(409, "EXCHANGE_ORDER_LINE_NOT_FOUND", "Original order line could not be updated");
          }
          record.exchangeCompletionApplied = true;
          record.exchangeHistoryEntry = {
            fromItemCode: itemCode,
            toItemCode: replacement.item_code,
            completedAt: now,
          };
        } else {
          throw new AppError(409, "RETURN_TYPE_INVALID", "Unsupported return request type");
        }

        record.status = "Completed";
        record.completedAt = now;
        record.updatedAt = now;
        record.inspectionStatus = String(record.inspectionStatus || "Pending");
        record.customerCourierFeeStatus =
          Number(record.customerCourierFee || 0) > 0
            ? "Collected by Representative"
            : "Not Applicable";
        record.brandCourierFeeStatus =
          Number(record.brandCourierFee || 0) > 0
            ? "Paid by Dart"
            : "Not Applicable";

        await client.query(
          "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
        );
      }

      const activityLog = Array.isArray(record.activityLog)
        ? record.activityLog as Record<string, unknown>[]
        : [];
      activityLog.push({
        id: `EVT-${Date.now().toString(36)}`,
        action:
          action === "start"
            ? "RETURN_PICKUP_STARTED"
            : action === "cancel"
              ? "RETURN_PICKUP_FAILED"
              : "RETURN_PICKUP_COMPLETED",
        previousStatus,
        newStatus: record.status,
        timestamp: now,
        actorRole: "Representative",
        representativeId: representativeUserId,
      });
      record.activityLog = activityLog;

      const returnStateVersion = Number(state?.version || 1);
      const returnStateUpdate = await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb,
                version=version+1,
                updated_at=now()
          WHERE domain=$1
            AND version=$3`,
        [
          "returns",
          JSON.stringify(rows),
          returnStateVersion,
        ],
      );
      if (!returnStateUpdate.rowCount) {
        throw new AppError(
          409,
          "RETURN_VERSION_CONFLICT",
          "Return request changed while this pickup action was being saved; refresh and retry",
        );
      }

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, metadata
         ) VALUES ('representative',$1,$2,'returns',$3,$4::jsonb)`,
        [
          representativeUserId,
          action === "start"
            ? "RETURN_PICKUP_STARTED"
            : action === "cancel"
              ? "RETURN_PICKUP_FAILED"
              : "RETURN_PICKUP_COMPLETED",
          String(record.id || returnRef),
          JSON.stringify({
            returnId: record.returnId || returnRef,
            from: previousStatus,
            to: record.status,
            requestType: record.requestType || "",
          }),
        ],
      );

      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminOrdersVersion(): Promise<number> {
    const result = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
    );
    return Number(result.rows[0]?.version || 1);
  }

  public async adminOrders(): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const versionResult = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
    );
    const result = await this.pool.query<AdminOrderRow>(
      `SELECT o.*, c.client_code,
          c.cod_risk_level AS customer_cod_risk_level,
          c.cod_risk_score AS customer_cod_risk_score,
          c.cod_refusals_in_window AS customer_cod_refusals_in_window,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'orderId', history.order_code,
                'refusedAt', history.refused_at,
                'reason', history.reason
              )
              ORDER BY history.refused_at DESC
            )
              FROM (
                SELECT refused.order_code,
                       COALESCE(
                         (
                           SELECT max(event.occurred_at)
                             FROM order_events event
                            WHERE event.order_id=refused.id
                              AND event.to_status='Refused'
                         ),
                         refused.updated_at
                       ) AS refused_at,
                       COALESCE(NULLIF(refused.legacy->>'refusalReason',''),'Other') AS reason
                  FROM orders refused
                 WHERE refused.customer_user_id=o.customer_user_id
                   AND o.customer_user_id IS NOT NULL
                   AND refused.status='Refused'
                   AND NOT refused.is_deleted
                 ORDER BY refused_at DESC
                 LIMIT 10
              ) history
          ), '[]'::jsonb) AS refusal_history,
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
          riskLevel: row.cod_risk_level,
          riskScore: Number(row.cod_risk_score || 0),
          riskReasons: Array.isArray(row.cod_risk_reasons) ? row.cod_risk_reasons : [],
          riskPolicyVersion: Number(row.cod_risk_policy_version || 1),
          verificationRequired: Boolean(row.cod_verification_required),
          verificationStatus: row.cod_verification_status,
          verificationReason: row.cod_verification_reason || "",
          verifiedAt: row.cod_verified_at || null,
          customerRiskLevel: row.customer_cod_risk_level || row.cod_risk_level,
          customerRiskScore: Number(row.customer_cod_risk_score ?? row.cod_risk_score ?? 0),
          refusalsInWindow: Number(
            row.customer_cod_refusals_in_window ?? row.cod_refusals_in_window ?? 0,
          ),
          refusalHistory: Array.isArray(row.refusal_history) ? row.refusal_history : [],
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
          deliveryCost: Number(row.delivery_cost_minor || 0) / 100,
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

  public async adminOrderStateAction(
    actorId: string,
    orderRef: string,
    action: "archive" | "restore" | "delete",
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        order_code: string;
        status: string;
        is_archived: boolean;
        is_deleted: boolean;
      }>(
        `SELECT id::text, order_code, status, is_archived, is_deleted
           FROM orders
          WHERE id::text=$1 OR order_code=$1
          LIMIT 1
          FOR UPDATE`,
        [orderRef],
      );
      const order = result.rows[0];
      if (!order) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
      }

      const finalStatuses = new Set(["Delivered", "Refused", "Cancelled", "Returned"]);
      if (action !== "restore" && !finalStatuses.has(order.status)) {
        throw new AppError(
          409,
          "ACTIVE_ORDER_PROTECTED",
          "Active orders cannot be archived or deleted; finish or cancel the workflow first",
        );
      }

      if (action === "archive") {
        await client.query(
          `UPDATE orders
              SET is_archived=true,
                  is_deleted=false,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [order.id],
        );
      } else if (action === "delete") {
        await client.query(
          `UPDATE orders
              SET is_archived=true,
                  is_deleted=true,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [order.id],
        );
      } else {
        await client.query(
          `UPDATE orders
              SET is_archived=false,
                  is_deleted=false,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [order.id],
        );
      }

      const versionUpdate = await client.query<{ version: string }>(
        `UPDATE domain_state_versions
            SET version=version+1, updated_at=now()
          WHERE domain='orders'
          RETURNING version::text`,
      );

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id,
           old_values, new_values, metadata
         ) VALUES ('staff',$1,$2,'orders',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
        [
          actorId,
          action === "archive"
            ? "ORDER_ARCHIVED"
            : action === "delete"
              ? "ORDER_SOFT_DELETED"
              : "ORDER_RESTORED",
          order.id,
          requestId,
          JSON.stringify({
            isArchived: order.is_archived,
            isDeleted: order.is_deleted,
          }),
          JSON.stringify({
            isArchived: action !== "restore",
            isDeleted: action === "delete",
          }),
          JSON.stringify({
            orderCode: order.order_code,
            status: order.status,
            preservedFinancialHistory: true,
          }),
        ],
      );

      await client.query("COMMIT");
      const state = await this.adminOrders();
      return {
        version: Number(versionUpdate.rows[0]?.version || state.version),
        orders: state.orders,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createAdminOrder(
    actorId: string,
    input: {
      clientId?: string | undefined;
      clientName: string;
      phone1: string;
      phone2?: string | undefined;
      email?: string | undefined;
      paymentMethod?: string | undefined;
      paymentStatus?: string | undefined;
      amountPaid?: number | undefined;
      amountRefunded?: number | undefined;
      orderSource?: string | undefined;
      deliveryNotes?: string | undefined;
      itemCodes: string[];
      discountPercent?: number | undefined;
      country?: string | undefined;
      governorate?: string | undefined;
      area?: string | undefined;
      street?: string | undefined;
      building?: string | undefined;
      floor?: string | undefined;
      latitude?: string | undefined;
      longitude?: string | undefined;
      fullAddress?: string | undefined;
    },
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const itemCodes = [...new Set(
        input.itemCodes.map((code) => String(code || "").trim()).filter(Boolean),
      )];
      if (!itemCodes.length) {
        throw new AppError(422, "ORDER_ITEMS_REQUIRED", "A manual order must contain at least one physical item");
      }

      const manualSettingsResult = await client.query<{ data: Record<string, unknown> }>(
        "SELECT data FROM site_settings WHERE id='main'",
      );
      const configuredManualCourierFee = Number(
        manualSettingsResult.rows[0]?.data?.courierFeePerOrder ??
          manualSettingsResult.rows[0]?.data?.deliveryCostPerPiece,
      );
      const manualCourierFeePerOrderMinor = Math.round(
        Math.max(
          0,
          Number.isFinite(configuredManualCourierFee)
            ? configuredManualCourierFee
            : 100,
        ) * 100,
      );
      const manualDeliveryCostMinor = manualCourierFeePerOrderMinor;

      const clientCode = String(input.clientId || "").trim();
      const customerResult =
        clientCode && clientCode !== "-"
          ? await client.query<{ user_id: string }>(
              "SELECT user_id::text FROM customers WHERE client_code=$1 LIMIT 1",
              [clientCode],
            )
          : { rows: [] as { user_id: string }[] };
      const customerUserId = customerResult.rows[0]?.user_id || null;

      const contact = {
        name: String(input.clientName || "").trim(),
        phone1: String(input.phone1 || "").trim(),
        phone2: String(input.phone2 || "").trim(),
        email: String(input.email || "").trim(),
      };
      const address = {
        country: String(input.country || "Egypt"),
        governorate: String(input.governorate || ""),
        area: String(input.area || ""),
        street: String(input.street || ""),
        building: String(input.building || ""),
        floor: String(input.floor || ""),
        latitude: String(input.latitude || ""),
        longitude: String(input.longitude || ""),
        fullAddress: String(input.fullAddress || ""),
        addressSource: "Manual Admin",
      };

      const inserted = await client.query<{ id: string; order_code: string }>(
        `INSERT INTO orders (
           customer_user_id, status, payment_method, payment_status,
           subtotal_minor, order_discount_minor, final_minor, delivery_cost_minor,
           amount_paid_minor, amount_refunded_minor, contact_snapshot,
           delivery_address, delivery_notes, order_source, legacy
         ) VALUES (
           $1,'New',$2,$3,0,0,0,$4,0,0,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb
         )
         RETURNING id::text, order_code`,
        [
          customerUserId,
          String(input.paymentMethod || "Cash on Delivery"),
          String(input.paymentStatus || "Unpaid"),
          manualDeliveryCostMinor,
          JSON.stringify(contact),
          JSON.stringify(address),
          String(input.deliveryNotes || ""),
          String(input.orderSource || "Manual"),
          JSON.stringify({
            clientId: clientCode || "-",
            source: "Manual Admin",
            deliveryCost: manualDeliveryCostMinor / 100,
            courierFee: manualDeliveryCostMinor / 100,
            courierFeePerOrder: manualCourierFeePerOrderMinor / 100,
          }),
        ],
      );
      const order = inserted.rows[0]!;

      await this.syncAdminOrderItems(
        client,
        order.id,
        order.order_code,
        { items: itemCodes },
        null,
        "New",
      );

      const totals = await client.query<{
        subtotal_minor: string;
      }>(
        `SELECT COALESCE(sum(final_unit_minor),0)::text AS subtotal_minor
           FROM order_items
          WHERE order_id=$1`,
        [order.id],
      );
      const subtotalMinor = Number(totals.rows[0]?.subtotal_minor || 0);
      const discountPercent = Math.min(
        100,
        Math.max(0, Number(input.discountPercent) || 0),
      );
      const discountMinor = Math.min(
        subtotalMinor,
        Math.round((subtotalMinor * discountPercent) / 100),
      );
      const finalMinor = Math.max(0, subtotalMinor - discountMinor);
      const amountPaidMinor = Math.min(
        finalMinor,
        Math.max(0, Math.round((Number(input.amountPaid) || 0) * 100)),
      );
      const amountRefundedMinor = Math.min(
        amountPaidMinor,
        Math.max(0, Math.round((Number(input.amountRefunded) || 0) * 100)),
      );

      await client.query(
        `UPDATE orders
            SET subtotal_minor=$2,
                order_discount_minor=$3,
                final_minor=$4,
                amount_paid_minor=$5,
                amount_refunded_minor=$6,
                promotion=$7::jsonb,
                legacy=legacy || $8::jsonb,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [
          order.id,
          subtotalMinor,
          discountMinor,
          finalMinor,
          amountPaidMinor,
          amountRefundedMinor,
          discountPercent
            ? JSON.stringify({
                type: "Manual Order Discount",
                percent: discountPercent,
              })
            : null,
          JSON.stringify({
            discount: discountPercent,
            reasonDeduction: discountPercent ? "Order discount" : "-",
          }),
        ],
      );

      if (String(input.paymentMethod || "Cash on Delivery").toLowerCase().includes("cash")) {
        await this.refreshCodRiskForOrder(
          client,
          order.id,
          customerUserId,
          finalMinor,
          {
            preserveVerification: false,
            actorType: "staff",
            actorId,
            requestId,
            reason: "MANUAL_ORDER_CREATED",
          },
        );
      }

      await client.query(
        `INSERT INTO order_events (
           order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
         ) VALUES ($1,'ORDER_CREATED',NULL,'New','staff',$2,$3::jsonb)`,
        [
          order.id,
          actorId,
          JSON.stringify({
            requestId,
            source: "Manual Admin",
            itemCount: itemCodes.length,
          }),
        ],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'MANUAL_ORDER_CREATED','orders',$2,$3,$4::jsonb)`,
        [
          actorId,
          order.id,
          requestId,
          JSON.stringify({
            orderCode: order.order_code,
            itemCount: itemCodes.length,
            discountPercent,
          }),
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           aggregate_type, aggregate_id, event_type, payload, deduplication_key
         ) VALUES ('order',$1,'order.created',$2::jsonb,$3)
         ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
        [
          order.id,
          JSON.stringify({
            orderId: order.id,
            orderCode: order.order_code,
            customerUserId,
            totalMinor: finalMinor,
            source: "Manual Admin",
          }),
          `order.created:${order.id}`,
        ],
      );

      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
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

  public async updateAdminOrder(
    actorId: string,
    orderRef: string,
    input: {
      clientId?: string | undefined;
      clientName: string;
      phone1: string;
      phone2?: string | undefined;
      email?: string | undefined;
      paymentMethod?: string | undefined;
      paymentStatus?: string | undefined;
      amountPaid?: number | undefined;
      amountRefunded?: number | undefined;
      orderSource?: string | undefined;
      deliveryNotes?: string | undefined;
      itemCodes: string[];
      discountPercent?: number | undefined;
      country?: string | undefined;
      governorate?: string | undefined;
      area?: string | undefined;
      street?: string | undefined;
      building?: string | undefined;
      floor?: string | undefined;
      latitude?: string | undefined;
      longitude?: string | undefined;
      fullAddress?: string | undefined;
    },
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingResult = await client.query<{
        id: string;
        order_code: string;
        status: string;
        subtotal_minor: string;
        order_discount_minor: string;
        final_minor: string;
        delivery_cost_minor: string;
        customer_user_id: string | null;
      }>(
        `SELECT id::text, order_code, status, subtotal_minor::text,
                order_discount_minor::text, final_minor::text,
                delivery_cost_minor::text, customer_user_id::text
           FROM orders
          WHERE (id::text=$1 OR order_code=$1)
            AND NOT is_deleted
          FOR UPDATE`,
        [orderRef],
      );
      const existing = existingResult.rows[0];
      if (!existing) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
      }

      const itemCodes = [...new Set(
        input.itemCodes.map((code) => String(code || "").trim()).filter(Boolean),
      )];
      if (!itemCodes.length) {
        throw new AppError(422, "ORDER_ITEMS_REQUIRED", "An order must contain at least one physical item");
      }

      const currentCodesResult = await client.query<{ item_code: string }>(
        "SELECT item_code FROM order_items WHERE order_id=$1 ORDER BY created_at, id",
        [existing.id],
      );
      const currentCodes = currentCodesResult.rows.map((row) => row.item_code);
      const itemSetChanged =
        currentCodes.length !== itemCodes.length ||
        currentCodes.some((code) => !itemCodes.includes(code));
      const financiallyLocked = ["Delivered", "Returned"].includes(existing.status);
      const requestedDiscount = Math.min(
        100,
        Math.max(0, Number(input.discountPercent) || 0),
      );
      const existingDiscountPercent =
        Number(existing.subtotal_minor) > 0
          ? (Number(existing.order_discount_minor) / Number(existing.subtotal_minor)) * 100
          : 0;

      if (
        financiallyLocked &&
        (itemSetChanged || Math.abs(requestedDiscount - existingDiscountPercent) > 0.01)
      ) {
        throw new AppError(
          409,
          "ORDER_FINANCIAL_SNAPSHOT_LOCKED",
          "Delivered or returned orders keep their original items and price snapshot",
        );
      }

      const clientCode = String(input.clientId || "").trim();
      const customerResult =
        clientCode && clientCode !== "-"
          ? await client.query<{ user_id: string }>(
              "SELECT user_id::text FROM customers WHERE client_code=$1 LIMIT 1",
              [clientCode],
            )
          : { rows: [] as { user_id: string }[] };
      const customerUserId = customerResult.rows[0]?.user_id || null;

      if (!financiallyLocked) {
        await this.syncAdminOrderItems(
          client,
          existing.id,
          existing.order_code,
          { items: itemCodes },
          existing.status,
          existing.status,
        );
      }

      const totals = await client.query<{ subtotal_minor: string }>(
        `SELECT COALESCE(sum(final_unit_minor),0)::text AS subtotal_minor
           FROM order_items
          WHERE order_id=$1`,
        [existing.id],
      );
      const subtotalMinor = financiallyLocked
        ? Number(existing.subtotal_minor)
        : Number(totals.rows[0]?.subtotal_minor || 0);
      const discountMinor = financiallyLocked
        ? Number(existing.order_discount_minor)
        : Math.min(
            subtotalMinor,
            Math.round((subtotalMinor * requestedDiscount) / 100),
          );
      const finalMinor = financiallyLocked
        ? Number(existing.final_minor)
        : Math.max(0, subtotalMinor - discountMinor);

      let updatedDeliveryCostMinor = Number(existing.delivery_cost_minor || 0);
      let updatedCourierFeePerOrderMinor = 0;
      if (!financiallyLocked) {
        const settingsResult = await client.query<{ data: Record<string, unknown> }>(
          "SELECT data FROM site_settings WHERE id='main'",
        );
        const configured = Number(
          settingsResult.rows[0]?.data?.courierFeePerOrder ??
            settingsResult.rows[0]?.data?.deliveryCostPerPiece,
        );
        updatedCourierFeePerOrderMinor = Math.round(
          Math.max(0, Number.isFinite(configured) ? configured : 100) * 100,
        );
        updatedDeliveryCostMinor = updatedCourierFeePerOrderMinor;
      }

      const amountPaidMinor = Math.min(
        finalMinor,
        Math.max(0, Math.round((Number(input.amountPaid) || 0) * 100)),
      );
      const amountRefundedMinor = Math.min(
        amountPaidMinor,
        Math.max(0, Math.round((Number(input.amountRefunded) || 0) * 100)),
      );

      const contact = {
        name: String(input.clientName || "").trim(),
        phone1: String(input.phone1 || "").trim(),
        phone2: String(input.phone2 || "").trim(),
        email: String(input.email || "").trim(),
      };
      const address = {
        country: String(input.country || "Egypt"),
        governorate: String(input.governorate || ""),
        area: String(input.area || ""),
        street: String(input.street || ""),
        building: String(input.building || ""),
        floor: String(input.floor || ""),
        latitude: String(input.latitude || ""),
        longitude: String(input.longitude || ""),
        fullAddress: String(input.fullAddress || ""),
        addressSource: "Manual Admin",
      };

      await client.query(
        `UPDATE orders
            SET customer_user_id=COALESCE($2, customer_user_id),
                payment_method=$3,
                payment_status=$4,
                subtotal_minor=$5,
                order_discount_minor=$6,
                final_minor=$7,
                amount_paid_minor=$8,
                amount_refunded_minor=$9,
                promotion=$10::jsonb,
                contact_snapshot=$11::jsonb,
                delivery_address=$12::jsonb,
                delivery_notes=$13,
                order_source=$14,
                delivery_cost_minor=$15,
                legacy=legacy || $16::jsonb,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [
          existing.id,
          customerUserId,
          String(input.paymentMethod || "Cash on Delivery"),
          String(input.paymentStatus || "Unpaid"),
          subtotalMinor,
          discountMinor,
          finalMinor,
          amountPaidMinor,
          amountRefundedMinor,
          requestedDiscount
            ? JSON.stringify({
                type: "Manual Order Discount",
                percent: requestedDiscount,
              })
            : null,
          JSON.stringify(contact),
          JSON.stringify(address),
          String(input.deliveryNotes || ""),
          String(input.orderSource || "Manual"),
          updatedDeliveryCostMinor,
          JSON.stringify({
            clientId: clientCode || "-",
            discount: requestedDiscount,
            reasonDeduction: requestedDiscount ? "Order discount" : "-",
            deliveryCost: updatedDeliveryCostMinor / 100,
            ...(updatedCourierFeePerOrderMinor
              ? {
                  courierFee: updatedCourierFeePerOrderMinor / 100,
                  courierFeePerOrder: updatedCourierFeePerOrderMinor / 100,
                }
              : {}),
          }),
        ],
      );

      if (String(input.paymentMethod || "Cash on Delivery").toLowerCase().includes("cash")) {
        await this.refreshCodRiskForOrder(
          client,
          existing.id,
          customerUserId || existing.customer_user_id,
          finalMinor,
          {
            preserveVerification: false,
            actorType: "staff",
            actorId,
            requestId,
            reason: "MANUAL_ORDER_UPDATED",
          },
        );
      }

      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'MANUAL_ORDER_UPDATED','orders',$2,$3,$4::jsonb)`,
        [
          actorId,
          existing.id,
          requestId,
          JSON.stringify({
            orderCode: existing.order_code,
            financiallyLocked,
            itemSetChanged,
            discountPercent: requestedDiscount,
          }),
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

  public async adminOrderWorkflowAction(
    actorId: string,
    orderRef: string,
    input: {
      expectedStatus?: string | undefined;
      target:
        | "New"
        | "Accepted"
        | "Preparing"
        | "Out With Representative"
        | "Representative On The Way"
        | "Delivered"
        | "Refused"
        | "Cancelled";
      representativeId?: string | undefined;
      deliveryGroupId?: string | undefined;
      reason?: string | undefined;
      notes?: string | undefined;
    },
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    const flow = [
      "New",
      "Accepted",
      "Preparing",
      "Out With Representative",
      "Representative On The Way",
      "Delivered",
    ];
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const orderResult = await client.query<{
        id: string;
        order_code: string;
        status: string;
        promotion: Record<string, unknown> | null;
        is_archived: boolean;
        is_deleted: boolean;
        payment_method: string;
        representative_user_id: string | null;
        customer_user_id: string | null;
        final_minor: string;
        cod_verification_status: CodVerificationStatus;
        legacy: Record<string, unknown> | null;
      }>(
        `SELECT id::text, order_code, status, promotion, is_archived, is_deleted,
                payment_method, representative_user_id::text, customer_user_id::text,
                final_minor::text, cod_verification_status, legacy
           FROM orders
          WHERE id::text=$1 OR order_code=$1
          LIMIT 1
          FOR UPDATE`,
        [orderRef],
      );
      const order = orderResult.rows[0];
      if (!order || order.is_deleted) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
      }
      if (order.is_archived) {
        throw new AppError(409, "ORDER_ARCHIVED", "Archived orders cannot change workflow state");
      }

      const previousStatus = String(order.status || "");
      const target = input.target;
      if (input.expectedStatus && previousStatus !== input.expectedStatus) {
        throw new AppError(
          409,
          "ORDER_STATE_STALE",
          `Order state changed from ${input.expectedStatus} to ${previousStatus}; refresh and retry`,
        );
      }
      if (previousStatus === target) {
        await client.query("COMMIT");
        return await this.adminOrders();
      }

      const previousIndex = flow.indexOf(previousStatus);
      const targetIndex = flow.indexOf(target);
      const isForward = previousIndex >= 0 && targetIndex === previousIndex + 1;
      const isBack = previousIndex > 0 && targetIndex === previousIndex - 1;
      const isCancelled =
        target === "Cancelled" &&
        !["Delivered", "Refused", "Cancelled"].includes(previousStatus);
      const isRefused =
        target === "Refused" &&
        ["Out With Representative", "Representative On The Way"].includes(previousStatus);
      if (!isForward && !isBack && !isCancelled && !isRefused) {
        throw new AppError(
          409,
          "ORDER_STATE_INVALID",
          `Invalid order transition: ${previousStatus} -> ${target}`,
        );
      }

      if (
        target === "Preparing" &&
        String(order.payment_method || "").toLowerCase().includes("cash")
      ) {
        const risk = await this.refreshCodRiskForOrder(
          client,
          order.id,
          order.customer_user_id,
          Number(order.final_minor || 0),
          {
            preserveVerification: true,
            actorType: "staff",
            actorId,
            requestId,
            reason: "PREPARING_GATE_RECHECK",
          },
        );
        if (!["Not Required", "Verified"].includes(risk.verificationStatus)) {
          if (risk.changed) {
            await client.query(
              "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='orders'",
            );
          }
          await client.query(
            `INSERT INTO audit_logs (
               actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
             ) VALUES ('staff',$1,'ORDER_PREPARING_BLOCKED','orders',$2,$3,$4::jsonb)`,
            [
              actorId,
              order.id,
              requestId,
              JSON.stringify({
                orderCode: order.order_code,
                riskLevel: risk.riskLevel,
                riskScore: risk.riskScore,
                verificationStatus: risk.verificationStatus,
                riskReasons: risk.riskReasons,
                policyVersion: risk.policyVersion,
              }),
            ],
          );
          await client.query("COMMIT");
          transactionOpen = false;
          throw new AppError(
            409,
            "COD_VERIFICATION_REQUIRED",
            "COD verification must be completed before Preparing",
            {
              riskLevel: risk.riskLevel,
              riskScore: risk.riskScore,
              verificationStatus: risk.verificationStatus,
              riskReasons: risk.riskReasons,
            },
          );
        }
      }

      let representativeUserId = order.representative_user_id;
      if (target === "Out With Representative" && previousStatus === "Preparing") {
        const representativeRef = String(input.representativeId || "").trim();
        if (!representativeRef) {
          throw new AppError(
            422,
            "REPRESENTATIVE_REQUIRED",
            "Choose a representative before sending the order out",
          );
        }
        const representativeResult = await client.query<{ user_id: string }>(
          `SELECT r.user_id::text
             FROM representatives r
             JOIN users u ON u.id=r.user_id
            WHERE (r.user_id::text=$1 OR r.representative_code=$1)
              AND r.approval_status='approved'
              AND u.status='active'
            LIMIT 1`,
          [representativeRef],
        );
        representativeUserId = representativeResult.rows[0]?.user_id || null;
        if (!representativeUserId) {
          throw new AppError(
            409,
            "REPRESENTATIVE_UNAVAILABLE",
            "Choose an active representative",
          );
        }
      }
      if (
        target === "Preparing" &&
        previousStatus === "Out With Representative"
      ) {
        representativeUserId = null;
      }

      const now = new Date().toISOString();
      const legacy = {
        ...(order.legacy && typeof order.legacy === "object" ? order.legacy : {}),
        ...(target === "Accepted" ? { acceptedAt: now } : {}),
        ...(target === "Preparing" ? { preparingAt: now } : {}),
        ...(target === "Out With Representative"
          ? {
              outWithRepresentativeAt: now,
              deliveryGroupId: String(input.deliveryGroupId || ""),
            }
          : {}),
        ...(target === "Representative On The Way"
          ? { representativeOnWayAt: now }
          : {}),
        ...(target === "Refused"
          ? {
              refusalReason: String(input.reason || "Other"),
              refusalNotes: String(input.notes || ""),
              refusedAt: now,
            }
          : {}),
        ...(target === "Cancelled"
          ? {
              cancellationReason: String(input.reason || "Cancelled"),
              cancellationNotes: String(input.notes || ""),
              cancelledAt: now,
            }
          : {}),
      } as Record<string, unknown>;

      if (isBack) {
        if (previousStatus === "Accepted") legacy.acceptedAt = null;
        if (previousStatus === "Preparing") legacy.preparingAt = null;
        if (previousStatus === "Out With Representative") {
          legacy.outWithRepresentativeAt = null;
          legacy.deliveryGroupId = "";
        }
        if (previousStatus === "Representative On The Way") {
          legacy.representativeOnWayAt = null;
        }
        if (previousStatus === "Delivered") {
          legacy.deliveredAt = null;
        }
      }

      await client.query(
        `UPDATE orders
            SET status=$2,
                representative_user_id=$3,
                delivery_started_at=CASE
                  WHEN $2='Representative On The Way'
                    THEN COALESCE(delivery_started_at, now())
                  ELSE NULL
                END,
                delivered_at=CASE
                  WHEN $2='Delivered' THEN now()
                  ELSE NULL
                END,
                payment_status=CASE
                  WHEN $2='Delivered' AND lower(payment_method) LIKE '%cash%' THEN 'Paid'
                  WHEN $1='Delivered' AND $2<>'Delivered' AND lower(payment_method) LIKE '%cash%' THEN 'Unpaid'
                  ELSE payment_status
                END,
                amount_paid_minor=CASE
                  WHEN $2='Delivered' AND lower(payment_method) LIKE '%cash%' THEN final_minor
                  WHEN $1='Delivered' AND $2<>'Delivered' AND lower(payment_method) LIKE '%cash%' THEN 0
                  ELSE amount_paid_minor
                END,
                legacy=$4::jsonb,
                version=version+1,
                updated_at=now()
          WHERE id=$5`,
        [
          previousStatus,
          target,
          representativeUserId,
          JSON.stringify(legacy),
          order.id,
        ],
      );

      await this.applyOrderStatusTransition(
        client,
        order.id,
        order.order_code,
        previousStatus,
        target,
        order.promotion,
        actorId,
      );

      if (target === "Refused" && order.customer_user_id) {
        await this.refreshCodRiskForOrder(
          client,
          order.id,
          order.customer_user_id,
          Number(order.final_minor || 0),
          {
            preserveVerification: false,
            actorType: "staff",
            actorId,
            requestId,
            reason: "ORDER_REFUSED",
          },
        );
        await this.refreshActiveCustomerCodRisk(
          client,
          order.customer_user_id,
          order.id,
          actorId,
          requestId,
        );
      }

      const versionUpdate = await client.query<{ version: string }>(
        `UPDATE domain_state_versions
            SET version=version+1, updated_at=now()
          WHERE domain='orders'
          RETURNING version::text`,
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id,
           old_values, new_values, metadata
         ) VALUES ('staff',$1,'ORDER_WORKFLOW_CHANGED','orders',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
        [
          actorId,
          order.id,
          requestId,
          JSON.stringify({ status: previousStatus }),
          JSON.stringify({
            status: target,
            representativeId: representativeUserId,
          }),
          JSON.stringify({
            orderCode: order.order_code,
            reason: String(input.reason || ""),
            notes: String(input.notes || ""),
            direction: isBack ? "back" : "forward",
          }),
        ],
      );

      await client.query("COMMIT");
      transactionOpen = false;
      const state = await this.adminOrders();
      return {
        version: Number(versionUpdate.rows[0]?.version || state.version),
        orders: state.orders,
      };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }


  public async adminCodVerificationAction(
    actorId: string,
    orderRef: string,
    input: {
      expectedVersion: number;
      decision: "verify" | "fail";
      reason: string;
    },
    requestId: string,
  ): Promise<{ version: number; orders: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        order_code: string;
        status: string;
        customer_user_id: string | null;
        final_minor: string;
        version: string;
        is_deleted: boolean;
        cod_verification_status: CodVerificationStatus;
        payment_method: string;
      }>(
        `SELECT id::text, order_code, status, customer_user_id::text,
                final_minor::text, version::text, is_deleted, cod_verification_status,
                payment_method
           FROM orders
          WHERE id::text=$1 OR order_code=$1
          LIMIT 1
          FOR UPDATE`,
        [orderRef],
      );
      const order = result.rows[0];
      if (!order || order.is_deleted) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
      }
      if (Number(order.version) !== input.expectedVersion) {
        throw new AppError(
          409,
          "ORDER_VERSION_CONFLICT",
          "Order changed on another device; reload and retry",
        );
      }
      if (!String(order.payment_method || "").toLowerCase().includes("cash")) {
        throw new AppError(
          409,
          "COD_VERIFICATION_NOT_APPLICABLE",
          "COD verification only applies to Cash on Delivery orders",
        );
      }
      if (!["New", "Accepted"].includes(order.status)) {
        throw new AppError(
          409,
          "COD_VERIFICATION_STATE_INVALID",
          "COD verification can only be changed before Preparing",
        );
      }

      const risk = await this.refreshCodRiskForOrder(
        client,
        order.id,
        order.customer_user_id,
        Number(order.final_minor || 0),
        {
          preserveVerification: true,
          actorType: "staff",
          actorId,
          requestId,
          reason: "MANUAL_VERIFICATION_REVIEW",
        },
      );
      const currentAfterRisk = await client.query<{
        cod_verification_status: CodVerificationStatus;
      }>(
        "SELECT cod_verification_status FROM orders WHERE id=$1 FOR UPDATE",
        [order.id],
      );
      const previousVerificationStatus =
        currentAfterRisk.rows[0]?.cod_verification_status || risk.verificationStatus;
      const nextVerificationStatus: CodVerificationStatus =
        input.decision === "verify" ? "Verified" : "Failed";

      await client.query(
        `UPDATE orders
            SET cod_verification_status=$2,
                cod_verification_required=$5,
                cod_verification_reason=$3,
                cod_verified_at=CASE WHEN $2='Verified' THEN now() ELSE NULL END,
                cod_verified_by=CASE WHEN $2='Verified' THEN $4::uuid ELSE NULL END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [
          order.id,
          nextVerificationStatus,
          input.reason,
          actorId,
          risk.verificationRequired,
        ],
      );
      await client.query(
        `INSERT INTO cod_verification_events (
           order_id, customer_user_id, event_type, risk_level, risk_score,
           verification_status, policy_version, reason, actor_type, actor_id, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'staff',$9,$10::jsonb)`,
        [
          order.id,
          order.customer_user_id,
          input.decision === "verify" ? "VERIFICATION_APPROVED" : "VERIFICATION_FAILED",
          risk.riskLevel,
          risk.riskScore,
          nextVerificationStatus,
          risk.policyVersion,
          input.reason,
          actorId,
          JSON.stringify({ orderCode: order.order_code }),
        ],
      );
      await client.query(
        `INSERT INTO order_events (
           order_id, event_type, from_status, to_status, actor_type, actor_id, metadata
         ) VALUES ($1,'COD_VERIFICATION_UPDATED',$2,$3,'staff',$4,$5::jsonb)`,
        [
          order.id,
          previousVerificationStatus,
          nextVerificationStatus,
          actorId,
          JSON.stringify({
            reason: input.reason,
            riskLevel: risk.riskLevel,
            riskScore: risk.riskScore,
          }),
        ],
      );
      const versionUpdate = await client.query<{ version: string }>(
        `UPDATE domain_state_versions
            SET version=version+1, updated_at=now()
          WHERE domain='orders'
          RETURNING version::text`,
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id,
           old_values, new_values, metadata
         ) VALUES ('staff',$1,'COD_VERIFICATION_UPDATED','orders',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
        [
          actorId,
          order.id,
          requestId,
          JSON.stringify({ verificationStatus: previousVerificationStatus }),
          JSON.stringify({ verificationStatus: nextVerificationStatus }),
          JSON.stringify({
            orderCode: order.order_code,
            reason: input.reason,
            riskLevel: risk.riskLevel,
            riskScore: risk.riskScore,
            policyVersion: risk.policyVersion,
          }),
        ],
      );
      await client.query("COMMIT");
      const state = await this.adminOrders();
      return {
        version: Number(versionUpdate.rows[0]?.version || state.version),
        orders: state.orders,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      const versionSnapshot = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
      );
      const currentVersion = Number(versionSnapshot.rows[0]?.version || 1);
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
          customer_user_id: string | null;
          cod_verification_status: CodVerificationStatus;
        }>(
          `SELECT id::text, status, promotion, customer_user_id::text,
                  cod_verification_status
             FROM orders
            WHERE order_code=$1
            FOR UPDATE`,
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
        const subtotalAmount = Math.max(0, Number(raw.totalPrice) || 0);
        const orderDiscountAmount = Number.isFinite(Number(raw.orderLevelDiscountAmount))
          ? Math.max(0, Number(raw.orderLevelDiscountAmount))
          : Math.max(
              0,
              subtotalAmount * Math.min(100, Math.max(0, Number(raw.discount) || 0)) / 100,
            );
        const subtotalMinor = Math.round(subtotalAmount * 100);
        const discountMinor = Math.min(
          subtotalMinor,
          Math.round(orderDiscountAmount * 100),
        );
        const finalMinor = Math.max(
          0,
          Number.isFinite(Number(raw.finalAmount))
            ? Math.round(Number(raw.finalAmount) * 100)
            : subtotalMinor - discountMinor,
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
        const effectiveCustomerUserId =
          customerUserId || existingOrder?.customer_user_id || null;
        const paymentMethod = String(raw.paymentMethod || "Cash on Delivery");

        if (
          existingOrder &&
          status === "Preparing" &&
          existingOrder.status !== "Preparing" &&
          paymentMethod.toLowerCase().includes("cash")
        ) {
          const risk = await this.refreshCodRiskForOrder(
            client,
            existingOrder.id,
            effectiveCustomerUserId,
            finalMinor,
            {
              preserveVerification: true,
              actorType: "staff",
              actorId,
              requestId,
              reason: "BULK_PREPARING_GATE_RECHECK",
            },
          );
          if (!["Not Required", "Verified"].includes(risk.verificationStatus)) {
            throw new AppError(
              409,
              "COD_VERIFICATION_REQUIRED",
              `Order ${orderCode} requires COD verification before Preparing`,
            );
          }
        } else if (!existingOrder && status === "Preparing") {
          throw new AppError(
            409,
            "COD_VERIFICATION_REQUIRED",
            `Order ${orderCode} cannot be created directly in Preparing`,
          );
        }

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
            paymentMethod,
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
        if (
          orderDbId &&
          (!existingOrder || Number.isFinite(Number(raw.deliveryCost)))
        ) {
          const rawCourierFee = Number(
            raw.courierFee ?? raw.courierFeePerOrder ?? raw.deliveryCost,
          );
          const rawDeliveryCostMinor = Number.isFinite(rawCourierFee)
            ? Math.max(0, Math.round(rawCourierFee * 100))
            : 10000;
          await client.query(
            "UPDATE orders SET delivery_cost_minor=$2 WHERE id=$1",
            [orderDbId, rawDeliveryCostMinor],
          );
        }
        if (orderDbId) {
          await this.syncAdminOrderItems(
            client,
            orderDbId,
            orderCode,
            raw,
            existingOrder?.status || null,
            status,
          );
          await this.applyOrderStatusTransition(
            client,
            orderDbId,
            orderCode,
            existingOrder?.status || null,
            status,
            promotion,
            actorId,
          );
          if (paymentMethod.toLowerCase().includes("cash")) {
            await this.refreshCodRiskForOrder(
              client,
              orderDbId,
              effectiveCustomerUserId,
              finalMinor,
              {
                preserveVerification: Boolean(existingOrder),
                actorType: "staff",
                actorId,
                requestId,
                reason: "BULK_ORDER_SYNCED",
              },
            );
          }
          if (
            status === "Refused" &&
            existingOrder?.status !== "Refused" &&
            effectiveCustomerUserId
          ) {
            await this.refreshActiveCustomerCodRisk(
              client,
              effectiveCustomerUserId,
              orderDbId,
              actorId,
              requestId,
            );
          }
        }
      }

      const versionUpdate = await client.query<{ version: string }>(
        `UPDATE domain_state_versions
            SET version=version+1, updated_at=now()
          WHERE domain='orders'
            AND version=$1
          RETURNING version::text`,
        [expectedVersion],
      );
      if (!versionUpdate.rows[0]) {
        throw new AppError(
          409,
          "ORDERS_VERSION_CONFLICT",
          "Orders changed while this update was being saved; reload and retry",
        );
      }
      const nextVersion = Number(versionUpdate.rows[0].version);
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

  private async syncAdminOrderItems(
    client: PoolClient,
    orderId: string,
    orderCode: string,
    raw: Record<string, unknown>,
    previousStatus: string | null,
    nextStatus: string,
  ): Promise<void> {
    const directCodes = Array.isArray(raw.items)
      ? raw.items.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const snapshots = Array.isArray(raw.priceSnapshot)
      ? raw.priceSnapshot as Record<string, unknown>[]
      : [];
    const snapshotCodes = snapshots
      .map((row) => String(row.itemCode || "").trim())
      .filter(Boolean);
    const desiredCodes = [...new Set(directCodes.length ? directCodes : snapshotCodes)];

    if (!desiredCodes.length) {
      if (!previousStatus) {
        throw new AppError(
          422,
          "ORDER_ITEMS_REQUIRED",
          "A manual order must contain at least one physical item",
        );
      }
      return;
    }

    const currentResult = await client.query<{
      item_code: string;
      inventory_item_id: string;
    }>(
      `SELECT item_code, inventory_item_id
         FROM order_items
        WHERE order_id=$1
        ORDER BY created_at, id
        FOR UPDATE`,
      [orderId],
    );
    const currentCodes = currentResult.rows.map((row) => row.item_code);
    const currentSet = new Set(currentCodes);
    const desiredSet = new Set(desiredCodes);
    const changed =
      currentCodes.length !== desiredCodes.length ||
      currentCodes.some((code) => !desiredSet.has(code));

    if (
      changed &&
      previousStatus &&
      ["Delivered", "Returned"].includes(previousStatus)
    ) {
      throw new AppError(
        409,
        "ORDER_ITEMS_LOCKED",
        "Delivered or returned orders cannot have their physical items replaced",
      );
    }

    const inventoryResult = await client.query<{
      id: string;
      item_code: string;
      model_id: string;
      color: string;
      size: string;
      status: string;
      order_id: string | null;
      model_name: string;
      cost_snapshot_minor: string;
      selling_minor: string;
      discount_percent: string;
    }>(
      `SELECT i.id, i.item_code, i.model_id, i.color, i.size, i.status, i.order_id,
              m.name AS model_name, i.cost_snapshot_minor::text,
              m.selling_minor::text, m.discount_percent::text
         FROM inventory_items i
         JOIN catalog_models m ON m.model_id=i.model_id
        WHERE i.item_code = ANY($1::text[])
          AND i.active
          AND NOT i.is_archived
          AND NOT i.is_deleted
        FOR UPDATE OF i`,
      [desiredCodes],
    );
    if (inventoryResult.rows.length !== desiredCodes.length) {
      const found = new Set(inventoryResult.rows.map((row) => row.item_code));
      const missing = desiredCodes.filter((code) => !found.has(code));
      throw new AppError(
        409,
        "ORDER_ITEM_NOT_FOUND",
        `Physical item(s) not found: ${missing.join(", ")}`,
      );
    }

    const inventoryByCode = new Map(
      inventoryResult.rows.map((row) => [row.item_code, row]),
    );
    const snapshotByCode = new Map(
      snapshots
        .map((row) => [String(row.itemCode || "").trim(), row] as const)
        .filter(([code]) => Boolean(code)),
    );

    const removedCodes = currentCodes.filter((code) => !desiredSet.has(code));
    if (removedCodes.length) {
      await client.query(
        "DELETE FROM order_items WHERE order_id=$1 AND item_code = ANY($2::text[])",
        [orderId, removedCodes],
      );
      await client.query(
        `UPDATE inventory_items
            SET status='In stock',
                order_id=NULL,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE item_code = ANY($1::text[])
            AND order_id=$2
            AND lower(status) <> 'sold'`,
        [removedCodes, orderCode],
      );
    }

    for (const code of desiredCodes) {
      if (currentSet.has(code)) continue;
      const item = inventoryByCode.get(code)!;
      const itemStatus = String(item.status || "").toLowerCase();
      const available =
        itemStatus === "in stock" ||
        (
          itemStatus === "processing/held" &&
          String(item.order_id || "") === orderCode
        );
      if (!available) {
        throw new AppError(
          409,
          "ORDER_ITEM_UNAVAILABLE",
          `${code} is already reserved, sold, damaged, or assigned elsewhere`,
        );
      }

      const snapshot = snapshotByCode.get(code) || {};
      const originalUnitMinor = Number.isFinite(Number(snapshot.originalUnitPrice))
        ? Math.max(0, Math.round(Number(snapshot.originalUnitPrice) * 100))
        : Number(item.selling_minor);
      const modelDiscountPercent = Number.isFinite(Number(snapshot.discountPercent))
        ? Math.min(100, Math.max(0, Number(snapshot.discountPercent)))
        : Number(item.discount_percent || 0);
      const finalUnitMinor = Number.isFinite(Number(snapshot.finalUnitPrice))
        ? Math.max(0, Math.round(Number(snapshot.finalUnitPrice) * 100))
        : finalModelPriceMinor(originalUnitMinor, modelDiscountPercent);
      const costSnapshotMinor = Number.isFinite(Number(snapshot.costSnapshot))
        ? Math.max(0, Math.round(Number(snapshot.costSnapshot) * 100))
        : Number(item.cost_snapshot_minor);

      await client.query(
        `INSERT INTO order_items (
           order_id, inventory_item_id, item_code, model_id, model_name,
           color, size, original_unit_minor, model_discount_percent,
           final_unit_minor, cost_snapshot_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          orderId,
          item.id,
          item.item_code,
          item.model_id,
          String(snapshot.name || item.model_name),
          item.color,
          item.size,
          originalUnitMinor,
          modelDiscountPercent,
          finalUnitMinor,
          costSnapshotMinor,
        ],
      );
    }

    if (nextStatus === "Cancelled") {
      await client.query(
        `UPDATE inventory_items
            SET status='In stock',
                order_id=NULL,
                return_request_id=NULL,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE item_code = ANY($1::text[])
            AND lower(status) <> 'sold'`,
        [desiredCodes],
      );
    } else if (nextStatus === "Refused") {
      await client.query(
        `UPDATE inventory_items
            SET status='Return Inspection',
                order_id=$2,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE item_code = ANY($1::text[])
            AND lower(status) <> 'sold'`,
        [desiredCodes, orderCode],
      );
    } else if (nextStatus !== "Delivered" && nextStatus !== "Returned") {
      await client.query(
        `UPDATE inventory_items
            SET status='Processing/Held',
                order_id=$2,
                cart_reservation_id=NULL,
                reservation_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE item_code = ANY($1::text[])
            AND lower(status) <> 'sold'`,
        [desiredCodes, orderCode],
      );
    }

    if (changed || desiredCodes.some((code) => !currentSet.has(code))) {
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
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

    const itemRows = await client.query<{
      item_code: string;
      model_id: string;
      color: string;
      size: string;
    }>(
      "SELECT item_code, model_id, color, size FROM order_items WHERE order_id=$1 ORDER BY created_at, id",
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
    } else if (nextStatus === "Cancelled") {
      const updated = await client.query(
        `UPDATE inventory_items i
            SET status='In stock',
                purchase_date=NULL,
                order_id=NULL,
                return_request_id=NULL,
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
    } else if (nextStatus === "Refused") {
      const updated = await client.query(
        `UPDATE inventory_items i
            SET status='Return Inspection',
                purchase_date=NULL,
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

      const contextResult = await client.query<{
        client_code: string | null;
        contact_snapshot: Record<string, unknown>;
        legacy: Record<string, unknown>;
      }>(
        `SELECT c.client_code, o.contact_snapshot, o.legacy
           FROM orders o
           LEFT JOIN customers c ON c.user_id=o.customer_user_id
          WHERE o.id=$1`,
        [orderId],
      );
      const context = contextResult.rows[0];
      const contact = context?.contact_snapshot || {};
      const legacy = context?.legacy || {};
      const reason = String(legacy.refusalReason || "Refused delivery");
      const returnsStateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE",
      );
      const returnsState = returnsStateResult.rows[0];
      const returnsRows = await readRelationalDashboardDomain(
        client,
        "returns",
      ) as Record<string, unknown>[];
      let returnsChanged = false;

      for (const item of itemRows.rows) {
        const exists = returnsRows.some(
          (row) =>
            String(row.orderId || "") === orderCode &&
            String(row.itemCode || "") === item.item_code &&
            !row.isPostDeliveryReturn &&
            !row.isDeleted,
        );
        if (exists) continue;

        const sequence = await client.query<{ value: string }>(
          "SELECT nextval('dart_return_request_seq')::text AS value",
        );
        const returnRecordId = randomUUID();
        const returnId = `R-${sequence.rows[0]!.value}`;
        const createdAt = new Date().toISOString();
        returnsRows.push({
          id: returnRecordId,
          returnId,
          modelId: item.model_id,
          itemCode: item.item_code,
          status: "Pending Inspection",
          date: createdAt.slice(0, 10),
          createdAt,
          clientName: String(contact.name || ""),
          clientId: context?.client_code || "",
          phone1: String(contact.phone1 || ""),
          phone2: String(contact.phone2 || ""),
          email: String(contact.email || ""),
          reason,
          orderId: orderCode,
          isPostDeliveryReturn: false,
          isArchived: false,
          isDeleted: false,
          isChecked: false,
        });
        await client.query(
          "UPDATE inventory_items SET return_request_id=$2 WHERE item_code=$1",
          [item.item_code, returnRecordId],
        );
        returnsChanged = true;
      }

      if (returnsChanged) {
        await client.query(
          `UPDATE dashboard_domain_state
              SET data=$2::jsonb, version=$3, updated_at=now()
            WHERE domain='returns'`,
          [
            JSON.stringify(returnsRows),
            Number(returnsState?.version || 1) + 1,
          ],
        );
      }
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
      const stateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='birthday_rewards' FOR UPDATE",
      );
      const state = stateResult.rows[0];
      const data = await readRelationalDashboardDomain(
        client,
        "birthday_rewards",
      ) as Record<string, unknown>[];
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
      const stateResult = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE",
      );
      const state = stateResult.rows[0];
      const data = await readRelationalDashboardDomain(
        client,
        "cards",
      ) as Record<string, unknown>[];
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

  public async customerLiveTracking(customerUserId: string): Promise<{
    capturedAt: string;
    orders: Record<string, unknown>[];
    returns: Record<string, unknown>[];
  }> {
    const customerResult = await this.pool.query<{ client_code: string }>(
      "SELECT client_code FROM customers WHERE user_id=$1",
      [customerUserId],
    );
    const clientCode = customerResult.rows[0]?.client_code;
    if (!clientCode) {
      throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
    }

    const ordersResult = await this.pool.query<{
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
          AND o.delivery_started_at IS NOT NULL
          AND NOT o.is_deleted
          AND NOT o.is_archived
        ORDER BY o.created_at DESC`,
      [customerUserId],
    );

    const returnResult = await this.pool.query<{ payload: Record<string, unknown> }>(
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
      ? await this.pool.query<{
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

  public async customerSnapshot(customerUserId: string): Promise<{
    orders: Record<string, unknown>[];
    returns: unknown[];
    cards: unknown[];
    birthdayRewards: unknown[];
    birthdayMessages: unknown[];
    reviewEligible: boolean;
    purchaseStats: { totalPieces: number; monthlyPieces: number };
    savedAddress: Record<string, unknown> | null;
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

    const [
      returnRows,
      cardRows,
      birthdayRewardRows,
      birthdayMessageRows,
      preferencesResult,
    ] = await Promise.all([
      readRelationalDashboardDomain(this.pool, "returns"),
      readRelationalDashboardDomain(this.pool, "cards"),
      readRelationalDashboardDomain(this.pool, "birthday_rewards"),
      readRelationalDashboardDomain(this.pool, "birthday_messages"),
      this.pool.query<{ last_address: Record<string, unknown> | null }>(
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

    const customerReturns = onlyCustomer(stateByDomain.get("returns") || []);
    const refundedItemCodes = new Set(
      customerReturns
        .filter((raw) => {
          const row = raw as Record<string, unknown>;
          const status = String(row.status || "");
          const completed =
            Boolean(row.completedAt) ||
            ["Completed", "Good", "Damaged", "Bad"].includes(status);
          return String(row.requestType || "") === "Refund" && completed;
        })
        .map((raw) => String((raw as Record<string, unknown>).itemCode || ""))
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
            (itemCode) => !refundedItemCodes.has(String(itemCode)),
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

  public async saveCustomerAddress(
    customerUserId: string,
    address: Record<string, unknown> | null,
    requestId: string,
  ): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO customer_preferences (
           customer_user_id, last_address, updated_at
         ) VALUES ($1,$2::jsonb,now())
         ON CONFLICT (customer_user_id) DO UPDATE SET
           last_address=EXCLUDED.last_address,
           updated_at=now()`,
        [customerUserId, address ? JSON.stringify(address) : null],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('customer',$1,$2,'customer_preferences',$1::text,$3,$4::jsonb)`,
        [
          customerUserId,
          address ? "CUSTOMER_ADDRESS_SAVED" : "CUSTOMER_ADDRESS_CLEARED",
          requestId,
          JSON.stringify({
            governorate: String(address?.governorate || ""),
            hasCoordinates: Boolean(address?.lat && address?.lng),
          }),
        ],
      );
      await client.query("COMMIT");
      return address;
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
