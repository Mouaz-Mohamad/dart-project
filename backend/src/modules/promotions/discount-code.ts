// DART CODE GUIDE | backend/src/modules/promotions/discount-code.ts
// خصومات الأكواد مستقلة عن الحملات؛ حساب الأموال وإثبات الاستخدام خادمي فقط.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../http/app-error.js";

const scopeSchema = z.object({
  mode: z.enum(["all", "categories", "models", "products"]).default("all"),
  values: z.array(z.string().trim().min(1).max(160)).max(500).default([]),
}).strict();

export const discountCodeInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_-]+$/).transform(v => v.toUpperCase()),
  status: z.enum(["Draft", "Active", "Paused", "Expired"]).default("Draft"),
  kind: z.enum(["percent", "amount"]),
  percent: z.number().finite().min(0).max(100).default(0),
  amountMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  maxDiscountMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  minOrderMinor: z.number().int().min(0).max(1_000_000_000).default(0),
  startsOn: z.iso.date().nullable().default(null),
  endsOn: z.iso.date().nullable().default(null),
  totalUsageLimit: z.number().int().min(0).max(10_000_000).default(0),
  perCustomerUsageLimit: z.number().int().min(0).max(100_000).default(1),
  customerRef: z.string().trim().min(1).max(160).nullable().default(null),
  productScope: scopeSchema.default({ mode: "all", values: [] }),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "percent" && value.percent <= 0)
    ctx.addIssue({ code: "custom", path: ["percent"], message: "Percentage must be above zero" });
  if (value.kind === "amount" && value.amountMinor <= 0)
    ctx.addIssue({ code: "custom", path: ["amountMinor"], message: "Amount must be above zero" });
  if (value.startsOn && value.endsOn && value.startsOn > value.endsOn)
    ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date precedes start date" });
  if (value.productScope.mode !== "all" && !value.productScope.values.length)
    ctx.addIssue({ code: "custom", path: ["productScope"], message: "Select eligible products" });
});
export type DiscountCodeInput = z.infer<typeof discountCodeInputSchema>;
export type DiscountLine = { id: string; itemCode: string; modelId: string; category: string; sellingMinor: number; modelDiscountPercent: number; isSet: boolean };
export type DiscountCode = {
  id: string; code: string; name: string; kind: "percent" | "amount";
  percent: number; amountMinor: number; maxDiscountMinor: number; minOrderMinor: number;
  productScope: { mode: "all"|"categories"|"models"|"products"; values: string[] };
  customerUserId: string | null; status: string; startsOn: string | null; endsOn: string | null;
  totalUsageLimit: number; perCustomerUsageLimit: number; version: number;
};

const selectCode = `SELECT id::text,code,name,status,kind,percent::float8,
 amount_minor::float8 AS "amountMinor",max_discount_minor::float8 AS "maxDiscountMinor",
 min_order_minor::float8 AS "minOrderMinor",product_scope AS "productScope",
 customer_user_id::text AS "customerUserId",starts_on::text AS "startsOn",ends_on::text AS "endsOn",
 total_usage_limit AS "totalUsageLimit",per_customer_usage_limit AS "perCustomerUsageLimit",version::integer AS version
 FROM discount_codes`;

function normalizedDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function codeAllowsLine(code: DiscountCode, line: DiscountLine): boolean {
  if (line.isSet || line.modelDiscountPercent > 0 || line.sellingMinor <= 0) return false;
  const scope = code.productScope;
  if (scope.mode === "all") return true;
  const value = scope.mode === "categories" ? line.category : scope.mode === "models" ? line.modelId : line.itemCode;
  return scope.values.some(item => item.toLowerCase() === value.toLowerCase());
}

/** Exact allocation in piastres. One fixed amount covers the order, never each piece. */
export function distributeSaving(total: number, lines: Array<{ id: string; baseMinor: number }>): Map<string, number> {
  const eligible = lines.filter(row => row.baseMinor > 0);
  const base = eligible.reduce((sum, row) => sum + row.baseMinor, 0);
  const saving = Math.min(Math.max(0, Math.floor(total)), base);
  if (!base || !saving) return new Map();
  const shares = eligible.map(row => {
    const fraction = BigInt(saving) * BigInt(row.baseMinor);
    return { id: row.id, minor: Number(fraction / BigInt(base)), remainder: fraction % BigInt(base) };
  });
  let remainder = saving - shares.reduce((sum, row) => sum + row.minor, 0);
  for (const row of [...shares].sort((a,b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1)) {
    if (!remainder) break;
    row.minor += 1;
    remainder -= 1;
  }
  return new Map(shares.filter(row => row.minor > 0).map(row => [row.id, row.minor]));
}

export function allocateCodeDiscount(code: DiscountCode | null, lines: Array<{ id: string; baseMinor: number }>): Map<string, number> {
  if (!code || !lines.length) return new Map();
  const subtotal = lines.reduce((sum,row) => sum + Math.max(0,row.baseMinor),0);
  const raw = code.kind === "amount"
    ? code.amountMinor
    : lines.reduce((sum,row) => sum + Math.round(Math.max(0,row.baseMinor) * code.percent / 100),0);
  const saving = Math.min(subtotal,raw,code.maxDiscountMinor || Number.MAX_SAFE_INTEGER);
  return distributeSaving(saving, lines);
}

export class DiscountCodeService {
  public constructor(private readonly pool: Pool) {}

  private async resolveCustomerRef(client: PoolClient, ref: string | null): Promise<string | null> {
    if (!ref) return null;
    const customer = await client.query<{ user_id: string }>(
      "SELECT user_id::text FROM customers WHERE client_code=$1 OR user_id::text=$1 OR user_id IN (SELECT customer_user_id FROM customer_identity_aliases WHERE alias=$1) LIMIT 1", [ref]);
    if (!customer.rows[0]) throw new AppError(422,"DISCOUNT_CUSTOMER_NOT_FOUND","Selected customer does not exist");
    return customer.rows[0].user_id;
  }

  public async list() {
    const rows = await this.pool.query(`SELECT c.*, COALESCE(u.reserved,0)::integer AS reserved,
     COALESCE(u.used,0)::integer AS used FROM (${selectCode}) c
     LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE status='Reserved') AS reserved,
       count(*) FILTER (WHERE status='Used') AS used FROM discount_code_usages WHERE discount_code_id=c.id::uuid
     ) u ON TRUE ORDER BY c.code`);
    return { codes: rows.rows };
  }

  public async save(input: DiscountCodeInput, actorId: string, requestId: string, id?: string, expectedVersion?: number) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Serialize cross-table campaign/code name checks with the campaign writer.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('dart:promotions'))");
      const customerId = await this.resolveCustomerRef(db, input.customerRef);
      const campaignCollision = await db.query(
        "SELECT 1 FROM promotion_records WHERE code=$1 OR payload->>'code'=$1 LIMIT 1",[input.code]);
      if (campaignCollision.rows.length) throw new AppError(409,"DISCOUNT_CODE_EXISTS","Code already belongs to a campaign");
      let code: DiscountCode;
      if (id) {
        const old = await db.query<DiscountCode>(`${selectCode} WHERE id=$1 FOR UPDATE`, [id]);
        const existing = old.rows[0];
        if (!existing) throw new AppError(404,"DISCOUNT_CODE_NOT_FOUND","Code not found");
        if (existing.version !== expectedVersion) throw new AppError(409,"DISCOUNT_CODE_CONFLICT","Code changed; refresh");
        if (existing.code !== input.code) throw new AppError(422,"DISCOUNT_CODE_IMMUTABLE","Create a new code to change its text");
        const updated = await db.query<DiscountCode>(`UPDATE discount_codes SET name=$2,status=$3,kind=$4,percent=$5,
         amount_minor=$6,max_discount_minor=$7,min_order_minor=$8,starts_on=$9::date,ends_on=$10::date,
         total_usage_limit=$11,per_customer_usage_limit=$12,customer_user_id=$13::uuid,product_scope=$14::jsonb,
         version=version+1,updated_at=now(),updated_by=$15 WHERE id=$1 RETURNING id::text,code,name,status,kind,
         percent::float8,amount_minor::float8 AS "amountMinor",max_discount_minor::float8 AS "maxDiscountMinor",
         min_order_minor::float8 AS "minOrderMinor",product_scope AS "productScope",customer_user_id::text AS "customerUserId",
         starts_on::text AS "startsOn",ends_on::text AS "endsOn",total_usage_limit AS "totalUsageLimit",
         per_customer_usage_limit AS "perCustomerUsageLimit",version::integer AS version`,
          [id,input.name,input.status,input.kind,input.percent,input.amountMinor,input.maxDiscountMinor,
           input.minOrderMinor,input.startsOn,input.endsOn,input.totalUsageLimit,input.perCustomerUsageLimit,
           customerId,JSON.stringify(input.productScope),actorId]);
        code = updated.rows[0]!;
      } else {
        const inserted = await db.query<DiscountCode>(`INSERT INTO discount_codes(code,name,status,kind,percent,amount_minor,
          max_discount_minor,min_order_minor,starts_on,ends_on,total_usage_limit,per_customer_usage_limit,
          customer_user_id,product_scope,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13::uuid,$14::jsonb,$15)
          RETURNING id::text,code,name,status,kind,percent::float8,amount_minor::float8 AS "amountMinor",
           max_discount_minor::float8 AS "maxDiscountMinor",min_order_minor::float8 AS "minOrderMinor",
           product_scope AS "productScope",customer_user_id::text AS "customerUserId",
           starts_on::text AS "startsOn",ends_on::text AS "endsOn",
           total_usage_limit AS "totalUsageLimit",per_customer_usage_limit AS "perCustomerUsageLimit",version::integer AS version`,
          [input.code,input.name,input.status,input.kind,input.percent,input.amountMinor,
           input.maxDiscountMinor,input.minOrderMinor,input.startsOn,input.endsOn,
           input.totalUsageLimit,input.perCustomerUsageLimit,customerId,JSON.stringify(input.productScope),actorId]);
        code = inserted.rows[0]!;
      }
      await db.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
        VALUES('staff',$1,$2,'discount_codes',$3,$4,$5::jsonb)`,
        [actorId,id?"DISCOUNT_CODE_UPDATED":"DISCOUNT_CODE_CREATED",code.id,requestId,
         JSON.stringify({ code: code.code, version: code.version, targetCustomer: Boolean(customerId) })]);
      await db.query("COMMIT");
      return code;
    } catch(error) {
      await db.query("ROLLBACK").catch(()=>undefined);
      if ((error as { code?: string }).code === "23505") throw new AppError(409,"DISCOUNT_CODE_EXISTS","This code already exists");
      throw error;
    } finally { db.release(); }
  }

  /** Permanently remove the coupon definition without erasing order accounting. */
  public async delete(id: string, expectedVersion: number, actorId: string, requestId: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const current = await db.query<DiscountCode>(`${selectCode} WHERE id=$1 FOR UPDATE`, [id]);
      const code = current.rows[0];
      if (!code) throw new AppError(404,"DISCOUNT_CODE_NOT_FOUND","Discount code not found");
      if (code.version !== expectedVersion)
        throw new AppError(409,"DISCOUNT_CODE_CONFLICT","Discount code changed; refresh and retry");
      // Checkout locks the same coupon row; a concurrent redemption cannot race deletion.
      // Financial usages survive by retaining their code text and discount amounts.
      const historical = await db.query(
        "SELECT 1 FROM discount_code_usages WHERE discount_code_id=$1 LIMIT 1", [id]);
      if (historical.rows.length) {
        // Unused codes can be hard-deleted with the current schema. Used codes
        // require migration 0080 to preserve financial rows instead of deleting them.
        const schema = await db.query<{ ready: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema=current_schema() AND table_name='discount_code_usages'
                AND column_name='code_snapshot'
           ) AS ready`);
        if (!schema.rows[0]?.ready)
          throw new AppError(503,"DISCOUNT_CODE_DELETE_MIGRATION_REQUIRED",
            "Database migration 0080 is required before deleting a redeemed discount code");
        await db.query("UPDATE discount_code_usages SET code_snapshot=$2 WHERE discount_code_id=$1",
          [id,code.code]);
      }
      await db.query("DELETE FROM discount_codes WHERE id=$1", [id]);
      await db.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,old_values,metadata)
        VALUES('staff',$1,'DISCOUNT_CODE_DELETED','discount_codes',$2,$3,$4::jsonb,$5::jsonb)`,
        [actorId,id,requestId,JSON.stringify(code),JSON.stringify({code:code.code})]);
      await db.query("COMMIT");
      return {deleted:true,id,code:code.code};
    } catch(error) { await db.query("ROLLBACK").catch(()=>undefined); throw error; }
    finally { db.release(); }
  }

  public async resolveInTransaction(client: PoolClient, customerId: string, raw: string, cart: DiscountLine[]): Promise<DiscountCode | null> {
    const code = raw.trim().toUpperCase();
    if (!code) return null;
    const result = await client.query<DiscountCode>(`${selectCode} WHERE code=$1 FOR UPDATE`,[code]);
    const offer = result.rows[0];
    if (!offer) return null;
    const today = normalizedDate();
    if (offer.status !== "Active" || (offer.startsOn && today < offer.startsOn) || (offer.endsOn && today > offer.endsOn))
      throw new AppError(409,"DISCOUNT_CODE_EXPIRED","Discount code is not active");
    if (offer.customerUserId && offer.customerUserId !== customerId)
      throw new AppError(403,"DISCOUNT_CODE_NOT_FOR_CUSTOMER","This code is assigned to another customer");
    if (cart.reduce((sum,line) => sum + line.sellingMinor,0) < offer.minOrderMinor ||
      !cart.some(line => codeAllowsLine(offer,line)))
      throw new AppError(409,"DISCOUNT_CODE_NOT_ELIGIBLE","No eligible products or minimum order not reached");
    const counts = await client.query<{ total: string; customer: string }>(`SELECT count(*) FILTER (WHERE status IN ('Reserved','Used'))::text AS total,
       count(*) FILTER (WHERE customer_user_id=$2 AND status IN ('Reserved','Used'))::text AS customer
       FROM discount_code_usages WHERE discount_code_id=$1`,[offer.id,customerId]);
    if ((offer.totalUsageLimit && Number(counts.rows[0]?.total || 0) >= offer.totalUsageLimit) ||
        (offer.perCustomerUsageLimit && Number(counts.rows[0]?.customer || 0) >= offer.perCustomerUsageLimit))
      throw new AppError(409,"DISCOUNT_CODE_EXHAUSTED","Discount code usage limit reached");
    return offer;
  }

  public async reserveInTransaction(client: PoolClient, code: DiscountCode, customerId: string, orderId: string, savingMinor: number) {
    if (savingMinor <= 0) return;
    // The code row was locked earlier in this same checkout transaction.
    await client.query(`INSERT INTO discount_code_usages(discount_code_id,customer_user_id,order_id,status,discount_minor)
      VALUES($1,$2,$3,'Reserved',$4)`,[code.id,customerId,orderId,savingMinor]);
  }
}
