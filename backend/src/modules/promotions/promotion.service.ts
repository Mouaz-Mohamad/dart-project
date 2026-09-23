// DART CODE GUIDE | backend/src/modules/promotions/promotion.service.ts
// الغرض: محرك Promotions خادمي ديناميكي؛ PostgreSQL هو مصدر الحقيقة والـCheckout لا يثق في Eligibility من المتصفح.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../http/app-error.js";

const conditionField = z.enum([
  "ordersCount",
  "purchasedPieces",
  "totalSpendingMinor",
  "lastOrderDaysAgo",
  "customerId",
  "accountAgeDays",
  "isBirthday",
]);
const conditionOperator = z.enum([
  "eq","ne","gt","gte","lt","lte","between","in","notIn",
]);
const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const ruleSchema: z.ZodTypeAny = z.lazy(() => z.union([
  z.object({
    field: conditionField,
    operator: conditionOperator,
    value: z.union([scalar, z.array(scalar).min(1).max(500)]),
  }).strict(),
  z.object({
    mode: z.enum(["AND","OR"]),
    rules: z.array(ruleSchema).min(1).max(50),
  }).strict(),
]));

export const promotionCampaignInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  status: z.enum(["Draft","Scheduled","Active","Paused","Expired"]).default("Draft"),
  discountPercent: z.number().finite().gt(0).max(100),
  maxDiscountPercent: z.number().finite().gt(0).max(100).optional(),
  startsAt: z.iso.date().optional(),
  endsAt: z.iso.date().optional(),
  automatic: z.boolean().default(false),
  priority: z.number().int().min(0).max(10000).default(100),
  minOrderMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  minQuantity: z.number().int().min(1).max(100).default(1),
  totalUsageLimit: z.number().int().min(0).max(10_000_000).default(0),
  perCustomerUsageLimit: z.number().int().min(0).max(100_000).default(0),
  customerRules: ruleSchema.optional(),
  productScope: z.object({
    mode: z.enum(["all","categories","models","products"]),
    values: z.array(z.string().trim().min(1).max(160)).max(500).default([]),
  }).strict().default({ mode: "all", values: [] }),
  stacking: z.literal("none").default("none"),
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && value.endsAt < value.startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be on or after startsAt" });
  }
  if (value.productScope.mode !== "all" && value.productScope.values.length === 0) {
    context.addIssue({ code: "custom", path: ["productScope","values"], message: "Scoped campaigns require at least one value" });
  }
});

export type PromotionCampaignInput = z.infer<typeof promotionCampaignInputSchema>;

type CustomerFacts = {
  userId: string;
  clientCode: string;
  birthday: string | null;
  createdAt: Date;
  ordersCount: number;
  purchasedPieces: number;
  totalSpendingMinor: number;
  lastOrderAt: Date | null;
};

type CartFact = {
  itemCode: string;
  modelId: string;
  category: string;
  sellingMinor: number;
  modelDiscountPercent: number;
};

function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function daysBetween(older: Date, newer = new Date()): number {
  return Math.max(0, Math.floor((newer.getTime() - older.getTime()) / 86_400_000));
}

function compare(actual: string | number | boolean | null, operator: string, expected: unknown): boolean {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (operator === "in") return expectedList.some((value) => String(value) === String(actual));
  if (operator === "notIn") return !expectedList.some((value) => String(value) === String(actual));
  if (operator === "between") {
    if (expectedList.length !== 2) return false;
    const numeric = Number(actual);
    return Number.isFinite(numeric) && numeric >= Number(expectedList[0]) && numeric <= Number(expectedList[1]);
  }
  if (operator === "eq") return String(actual) === String(expected);
  if (operator === "ne") return String(actual) !== String(expected);
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  return false;
}

function evaluateRule(rule: unknown, facts: CustomerFacts, reference = new Date()): boolean {
  if (!rule) return true;
  const parsed = ruleSchema.safeParse(rule);
  if (!parsed.success) return false;
  const current = parsed.data as Record<string, unknown>;
  if ("rules" in current) {
    const children = current.rules as unknown[];
    return current.mode === "AND"
      ? children.every((child) => evaluateRule(child, facts, reference))
      : children.some((child) => evaluateRule(child, facts, reference));
  }
  const field = String(current.field);
  let actual: string | number | boolean | null = null;
  if (field === "ordersCount") actual = facts.ordersCount;
  if (field === "purchasedPieces") actual = facts.purchasedPieces;
  if (field === "totalSpendingMinor") actual = facts.totalSpendingMinor;
  if (field === "lastOrderDaysAgo") actual = facts.lastOrderAt ? daysBetween(facts.lastOrderAt, reference) : 1_000_000;
  if (field === "customerId") {
    const value = current.value;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    const matches = values.includes(facts.userId) || values.includes(facts.clientCode);
    return current.operator === "ne" || current.operator === "notIn" ? !matches : matches;
  }
  if (field === "accountAgeDays") actual = daysBetween(facts.createdAt, reference);
  if (field === "isBirthday") {
    const birthday = String(facts.birthday || "");
    actual = birthday.length >= 10 && birthday.slice(5,10) === cairoDateKey(reference).slice(5,10);
  }
  return compare(actual, String(current.operator), current.value);
}

function normalizedCampaign(row: { record_id: string; version: string | number; payload: Record<string, unknown> }) {
  const parsed = promotionCampaignInputSchema.safeParse(row.payload);
  if (parsed.success) return { id: row.record_id, version: Number(row.version), ...parsed.data };
  const legacy = row.payload;
  const fallback = promotionCampaignInputSchema.safeParse({
    name: String(legacy.name || legacy.title || legacy.code || "Promotion"),
    code: String(legacy.code || "").toUpperCase(),
    status: String(legacy.status || "Active"),
    discountPercent: Number(legacy.discountPercent ?? legacy.percent ?? legacy.discount ?? 0),
    startsAt: String(legacy.startsAt || legacy.startDate || "") || undefined,
    endsAt: String(legacy.endsAt || legacy.endDate || "") || undefined,
    automatic: Boolean(legacy.automatic),
    priority: Number(legacy.priority || 100),
    minOrderMinor: Number(legacy.minOrderMinor || 0),
    minQuantity: Number(legacy.minQuantity || 1),
    totalUsageLimit: Number(legacy.totalUsageLimit || 0),
    perCustomerUsageLimit: Number(legacy.perCustomerUsageLimit || 0),
    customerRules: legacy.customerRules,
    productScope: legacy.productScope || { mode: "all", values: [] },
    stacking: "none",
  });
  return fallback.success ? { id: row.record_id, version: Number(row.version), ...fallback.data } : null;
}

function campaignPayload(input: PromotionCampaignInput): Record<string, unknown> {
  return {
    ...input,
    code: input.code.toUpperCase(),
    percent: input.discountPercent,
    // Compatibility: the older CommerceService performs final campaign reservation.
    // Eligibility has already been evaluated here, so do not let its legacy segment gate reject it.
    targetType: "all",
  };
}

export class PromotionService {
  public constructor(private readonly pool: Pool) {}

  private async customerFacts(client: PoolClient, customerUserId: string): Promise<CustomerFacts> {
    const customer = await client.query<{
      user_id: string; client_code: string; birthday: string | null; created_at: Date;
    }>(
      "SELECT user_id::text,client_code,birthday::text,created_at FROM customers WHERE user_id=$1",
      [customerUserId],
    );
    const row = customer.rows[0];
    if (!row) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
    const orders = await client.query<{
      orders_count: string; total_spending_minor: string; last_order_at: Date | null;
    }>(
      `SELECT count(*)::text AS orders_count,
              COALESCE(sum(GREATEST(final_minor-amount_refunded_minor,0)),0)::text AS total_spending_minor,
              max(delivered_at) AS last_order_at
         FROM orders
        WHERE customer_user_id=$1 AND status='Delivered' AND NOT is_deleted`,
      [customerUserId],
    );
    const pieces = await client.query<{ purchased_pieces: string }>(
      `SELECT count(*)::text AS purchased_pieces
         FROM order_items oi
         JOIN orders o ON o.id=oi.order_id
        WHERE o.customer_user_id=$1 AND o.status='Delivered' AND NOT o.is_deleted
          AND NOT EXISTS (
            SELECT 1 FROM return_requests rr
             WHERE rr.inventory_item_id=oi.inventory_item_id
               AND NOT rr.is_deleted
               AND lower(rr.status) IN ('completed','returned','closed','done')
          )`,
      [customerUserId],
    );
    return {
      userId: row.user_id,
      clientCode: row.client_code,
      birthday: row.birthday,
      createdAt: row.created_at,
      ordersCount: Number(orders.rows[0]?.orders_count || 0),
      purchasedPieces: Number(pieces.rows[0]?.purchased_pieces || 0),
      totalSpendingMinor: Number(orders.rows[0]?.total_spending_minor || 0),
      lastOrderAt: orders.rows[0]?.last_order_at || null,
    };
  }

  private async cartFacts(client: PoolClient, customerUserId: string, reservationId: string): Promise<CartFact[]> {
    const result = await client.query<{
      item_code: string; model_id: string; category: string; selling_minor: string; discount_percent: string;
    }>(
      `SELECT i.item_code,i.model_id,m.category,m.selling_minor::text,m.discount_percent::text
         FROM cart_reservations cr
         JOIN inventory_items i ON i.cart_reservation_id=cr.id
         JOIN catalog_models m ON m.model_id=i.model_id
        WHERE cr.id=$1 AND cr.customer_user_id=$2 AND cr.expires_at>now()
          AND lower(i.status)='cart reserved' AND i.reservation_until>now()
          AND i.active AND NOT i.is_archived AND NOT i.is_deleted
        ORDER BY i.item_code`,
      [reservationId, customerUserId],
    );
    return result.rows.map((row) => ({
      itemCode: row.item_code,
      modelId: row.model_id,
      category: row.category,
      sellingMinor: Number(row.selling_minor || 0),
      modelDiscountPercent: Number(row.discount_percent || 0),
    }));
  }

  private async campaignUsageAllowed(client: PoolClient, campaign: PromotionCampaignInput & { id: string }, customerUserId: string): Promise<boolean> {
    const result = await client.query<{ total: string; customer: string }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('Reserved','Used'))::text AS total,
         count(*) FILTER (WHERE customer_user_id=$2 AND status IN ('Reserved','Used'))::text AS customer
       FROM promotion_usages WHERE promotion_record_id=$1`,
      [campaign.id, customerUserId],
    );
    const total = Number(result.rows[0]?.total || 0);
    const customer = Number(result.rows[0]?.customer || 0);
    return (!campaign.totalUsageLimit || total < campaign.totalUsageLimit)
      && (!campaign.perCustomerUsageLimit || customer < campaign.perCustomerUsageLimit);
  }

  private campaignActive(campaign: PromotionCampaignInput, reference = new Date()): boolean {
    if (campaign.status !== "Active") return false;
    const today = cairoDateKey(reference);
    return (!campaign.startsAt || today >= campaign.startsAt) && (!campaign.endsAt || today <= campaign.endsAt);
  }

  private cartEligible(campaign: PromotionCampaignInput, cart: CartFact[]): boolean {
    if (!cart.length || cart.length < campaign.minQuantity) return false;
    const subtotal = cart.reduce((sum, item) => {
      const rate = Math.min(100, Math.max(0, item.modelDiscountPercent));
      return sum + Math.round(item.sellingMinor * (1 - rate / 100));
    }, 0);
    if (subtotal < campaign.minOrderMinor) return false;
    const scope = campaign.productScope;
    if (scope.mode === "all") return true;
    const allowed = new Set(scope.values.map((value) => value.toLowerCase()));
    // Commerce currently applies one order-level percentage. Requiring every line to be in
    // the configured scope prevents an out-of-scope line from receiving the campaign.
    if (scope.mode === "categories") return cart.every((item) => allowed.has(item.category.toLowerCase()));
    if (scope.mode === "models") return cart.every((item) => allowed.has(item.modelId.toLowerCase()));
    return cart.every((item) => allowed.has(item.itemCode.toLowerCase()));
  }

  private async loadCampaigns(client: PoolClient): Promise<Array<PromotionCampaignInput & { id: string; version: number }>> {
    const result = await client.query<{
      record_id: string; version: string; payload: Record<string, unknown>;
    }>("SELECT record_id,version::text,payload FROM promotion_records ORDER BY position DESC,updated_at DESC");
    return result.rows.map(normalizedCampaign).filter((row): row is PromotionCampaignInput & { id: string; version: number } => Boolean(row));
  }

  public async resolveForCheckout(customerUserId: string, reservationId: string, requestedCode?: string): Promise<{ code: string | null; campaign: Record<string, unknown> | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const facts = await this.customerFacts(client, customerUserId);
      const cart = await this.cartFacts(client, customerUserId, reservationId);
      if (!cart.length) throw new AppError(409, "RESERVATION_EMPTY", "No reserved items remain in this cart");
      const campaigns = await this.loadCampaigns(client);
      const normalizedCode = String(requestedCode || "").trim().toUpperCase();
      const candidates = normalizedCode
        ? campaigns.filter((campaign) => campaign.code === normalizedCode)
        : campaigns.filter((campaign) => campaign.automatic).sort((a,b) => b.priority - a.priority || b.discountPercent - a.discountPercent);
      for (const campaign of candidates) {
        if (!this.campaignActive(campaign)) continue;
        if (!evaluateRule(campaign.customerRules, facts)) continue;
        if (!this.cartEligible(campaign, cart)) continue;
        if (!await this.campaignUsageAllowed(client, campaign, customerUserId)) continue;
        await client.query("COMMIT");
        return {
          code: campaign.code,
          campaign: { id: campaign.id, name: campaign.name, code: campaign.code, discountPercent: campaign.discountPercent },
        };
      }
      if (normalizedCode) {
        throw new AppError(409, "PROMOTION_NOT_ELIGIBLE", "Promotion is invalid, expired, exhausted, or not eligible for this account/cart");
      }
      await client.query("COMMIT");
      return { code: null, campaign: null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async validateCode(customerUserId: string, code: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      const facts = await this.customerFacts(client, customerUserId);
      const campaigns = await this.loadCampaigns(client);
      const campaign = campaigns.find((row) => row.code === code.trim().toUpperCase());
      const eligible = Boolean(campaign)
        && this.campaignActive(campaign!)
        && evaluateRule(campaign!.customerRules, facts)
        && await this.campaignUsageAllowed(client, campaign!, customerUserId);
      return {
        valid: eligible,
        code: code.trim().toUpperCase(),
        ...(campaign ? { campaign: { id: campaign.id, name: campaign.name, discountPercent: campaign.discountPercent } } : {}),
      };
    } finally {
      client.release();
    }
  }

  public async list(): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<{ record_id: string; version: string; payload: Record<string, unknown> }>(
      "SELECT record_id,version::text,payload FROM promotion_records ORDER BY position DESC,updated_at DESC",
    );
    return result.rows.map(normalizedCampaign).filter(Boolean) as Record<string, unknown>[];
  }

  public async create(input: PromotionCampaignInput, actorId: string, requestId: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    const recordId = `PROMO-${randomUUID()}`;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dart:promotions'))");
      const duplicate = await client.query("SELECT 1 FROM promotion_records WHERE code=$1 LIMIT 1", [input.code]);
      if (duplicate.rows.length) throw new AppError(409, "PROMOTION_CODE_EXISTS", "Promotion code already exists");
      const positionResult = await client.query<{ position: string }>("SELECT COALESCE(max(position),0)+1::bigint AS position FROM promotion_records");
      const payload = campaignPayload(input);
      await client.query(
        `INSERT INTO promotion_records(record_id,position,payload,version,updated_by)
         VALUES ($1,$2,$3::jsonb,1,$4)`,
        [recordId, Number(positionResult.rows[0]?.position || 1), JSON.stringify(payload), actorId],
      );
      await client.query("UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='promotions'");
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ('staff',$1,'PROMOTION_CREATED','promotions',$2,$3,$4::jsonb)`,
        [actorId, recordId, requestId, JSON.stringify({ code: input.code })],
      );
      await client.query("COMMIT");
      return { id: recordId, version: 1, ...input };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async update(recordId: string, expectedVersion: number, input: PromotionCampaignInput, actorId: string, requestId: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ version: string; code: string }>(
        "SELECT version::text,code FROM promotion_records WHERE record_id=$1 FOR UPDATE",
        [recordId],
      );
      if (!current.rows[0]) throw new AppError(404, "PROMOTION_NOT_FOUND", "Promotion not found");
      if (Number(current.rows[0].version) !== expectedVersion) throw new AppError(409, "PROMOTION_VERSION_CONFLICT", "Promotion changed; reload and retry");
      const duplicate = await client.query("SELECT 1 FROM promotion_records WHERE code=$1 AND record_id<>$2 LIMIT 1", [input.code, recordId]);
      if (duplicate.rows.length) throw new AppError(409, "PROMOTION_CODE_EXISTS", "Promotion code already exists");
      const payload = campaignPayload(input);
      await client.query(
        `UPDATE promotion_records SET payload=$2::jsonb,version=version+1,updated_by=$3,updated_at=now() WHERE record_id=$1`,
        [recordId, JSON.stringify(payload), actorId],
      );
      await client.query("UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='promotions'");
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ('staff',$1,'PROMOTION_UPDATED','promotions',$2,$3,$4::jsonb)`,
        [actorId, recordId, requestId, JSON.stringify({ previousCode: current.rows[0].code, code: input.code, previousVersion: expectedVersion })],
      );
      await client.query("COMMIT");
      return { id: recordId, version: expectedVersion + 1, ...input };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async analytics(recordId: string): Promise<Record<string, unknown>> {
    const campaignResult = await this.pool.query<{ record_id: string; version: string; payload: Record<string, unknown> }>(
      "SELECT record_id,version::text,payload FROM promotion_records WHERE record_id=$1",
      [recordId],
    );
    const campaign = campaignResult.rows[0] ? normalizedCampaign(campaignResult.rows[0]) : null;
    if (!campaign) throw new AppError(404, "PROMOTION_NOT_FOUND", "Promotion not found");
    const usage = await this.pool.query<{
      reservations: string; used: string; customers: string; revenue_minor: string; discount_minor: string; pieces: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE pu.status='Reserved')::text AS reservations,
         count(*) FILTER (WHERE pu.status='Used')::text AS used,
         count(DISTINCT pu.customer_user_id) FILTER (WHERE pu.status='Used')::text AS customers,
         COALESCE(sum(o.final_minor) FILTER (WHERE pu.status='Used'),0)::text AS revenue_minor,
         COALESCE(sum(pu.discount_minor) FILTER (WHERE pu.status='Used'),0)::text AS discount_minor,
         COALESCE(sum((SELECT count(*) FROM order_items oi WHERE oi.order_id=o.id)) FILTER (WHERE pu.status='Used'),0)::text AS pieces
       FROM promotion_usages pu
       JOIN orders o ON o.id=pu.order_id
       WHERE pu.promotion_record_id=$1`,
      [recordId],
    );
    const row = usage.rows[0];
    const used = Number(row?.used || 0);
    const reservations = Number(row?.reservations || 0);
    const revenueMinor = Number(row?.revenue_minor || 0);
    return {
      campaign,
      reservations,
      usages: used,
      customers: Number(row?.customers || 0),
      ordersGenerated: used,
      pieces: Number(row?.pieces || 0),
      revenueMinor,
      discountMinor: Number(row?.discount_minor || 0),
      averageOrderValueMinor: used ? Math.round(revenueMinor / used) : 0,
      conversionPercent: used + reservations ? Math.round((used / (used + reservations)) * 10000) / 100 : 0,
    };
  }
}
