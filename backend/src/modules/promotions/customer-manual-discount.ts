import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../http/app-error.js";

// Percent values use basis points; amount values use integer EGP piastres.
export const manualDiscountSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(["percent", "amount"]),
  value: z.number().int().min(1).max(1_000_000_000),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  pieceLimit: z.number().int().min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "percent" && value.value > 10000) ctx.addIssue({ code: "custom", path: ["value"], message: "Percent cannot exceed 100" });
  if (value.endsOn < value.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End must follow start" });
});
export type ManualDiscountInput = z.infer<typeof manualDiscountSchema>;
export type ManualGrant = ManualDiscountInput & { id: string; version: number };

export async function activeManualDiscount(client: PoolClient, customer: string): Promise<ManualGrant | null> {
  const result = await client.query<ManualGrant>(`SELECT id::text,name,kind,value,starts_on::text AS "startsOn",
      ends_on::text AS "endsOn",piece_limit AS "pieceLimit",version
    FROM customer_manual_discounts WHERE customer_user_id=$1 AND status='Active'
      AND (now() AT TIME ZONE 'Africa/Cairo')::date BETWEEN starts_on AND ends_on
    ORDER BY starts_on,id LIMIT 1 FOR UPDATE`, [customer]);
  return result.rows[0] || null;
}

// Allocate an order-level amount proportionally to eligible lines with exact integer totals.
export function allocateManualDiscount(grant: ManualGrant | null, lines: Array<{ id: string; baseMinor: number }>): Map<string, number> {
  if (!grant) return new Map();
  const eligible = lines.filter((line) => line.baseMinor > 0).slice(0, grant.pieceLimit);
  const subtotal = eligible.reduce((sum, line) => sum + line.baseMinor, 0);
  if (!subtotal) return new Map();
  const total = Math.min(subtotal, grant.kind === "amount" ? grant.value : Math.round(subtotal * grant.value / 10000));
  if (!total) return new Map();
  const allocated = eligible.map((line) => {
    const exact = BigInt(total) * BigInt(line.baseMinor);
    return { id: line.id, minor: Number(exact / BigInt(subtotal)), remainder: exact % BigInt(subtotal) };
  });
  let remaining = total - allocated.reduce((sum, line) => sum + line.minor, 0);
  const largest = [...allocated].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const line of largest) { if (!remaining) break; line.minor++; remaining--; }
  // A sub-piastre allocation is not charged and does not consume a lower-priority reward.
  return new Map(allocated.map((line) => [line.id, line.minor]));
}

export async function requireManualDiscountOwner(db: Pick<Pool, "query"> | PoolClient, actorId: string): Promise<void> {
  const owner = await db.query<{ is_owner: boolean }>("SELECT is_owner FROM staff_users WHERE user_id=$1", [actorId]);
  if (!owner.rows[0]?.is_owner) throw new AppError(403, "FORBIDDEN", "Only the Owner can manage customer discounts");
}

export async function consumeManualDiscount(db: PoolClient, benefit: Record<string, unknown> | null, customerId: string,
  orderId: string, actorType: "staff" | "customer", actorId: string, requestId: string) {
  if (!benefit) return;
  const consumed = await db.query(`UPDATE customer_manual_discounts SET status='Used',order_id=$2,used_at=now(),
    version=version+1,updated_at=now() WHERE id=$1 AND customer_user_id=$3 AND status='Active' RETURNING id`, [benefit.id, orderId, customerId]);
  if (!consumed.rows.length) throw new AppError(409, "MANUAL_DISCOUNT_USED", "Customer discount is no longer available");
  await db.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,new_values,request_id)
    VALUES($1,$2,'MANUAL_DISCOUNT_USED','customer_manual_discounts',$3,$4::jsonb,$5)`,
  [actorType, actorId, benefit.id, JSON.stringify({ orderId, discountMinor: benefit.discountMinor }), requestId]);
}

export async function saveManualDiscount(pool: Pool, clientRef: string, actor: string, requestId: string,
  id: string, input: ManualDiscountInput | null, expectedVersion?: number) {
  if (input) input = manualDiscountSchema.parse(input);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await requireManualDiscountOwner(db, actor);
    const customer = (await db.query<{ user_id: string }>(
      "SELECT user_id::text FROM customers WHERE client_code=$1 OR user_id::text=$1 OR user_id IN (SELECT customer_user_id FROM customer_identity_aliases WHERE alias=$1)", [clientRef])).rows[0];
    if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer not found");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:customer-rewards:${customer.user_id}`]);
    const previous = (await db.query<Record<string, unknown>>("SELECT *,starts_on::text AS starts_on,ends_on::text AS ends_on FROM customer_manual_discounts WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (previous && previous.customer_user_id !== customer.user_id) throw new AppError(404, "DISCOUNT_NOT_FOUND", "Discount not found");
    if (expectedVersion === undefined && previous) {
      const same = input && previous.name === input.name && previous.kind === input.kind && Number(previous.value) === input.value
        && String(previous.starts_on instanceof Date ? previous.starts_on.toISOString().slice(0, 10) : previous.starts_on) === input.startsOn
        && String(previous.ends_on instanceof Date ? previous.ends_on.toISOString().slice(0, 10) : previous.ends_on) === input.endsOn
        && Number(previous.piece_limit) === input.pieceLimit;
      if (!same) throw new AppError(409, "DISCOUNT_CONFLICT", "Discount request changed; reload and retry");
      await db.query("COMMIT"); return { id, version: Number(previous.version) };
    }
    if (expectedVersion !== undefined && (!previous || Number(previous.version) !== expectedVersion || previous.status !== "Active")) {
      throw new AppError(409, "DISCOUNT_CONFLICT", "Discount changed or was used; reload and retry");
    }
    if (!input && !previous) throw new AppError(404, "DISCOUNT_NOT_FOUND", "Discount not found");
    if (input) {
      const overlap = await db.query(`SELECT 1 FROM customer_manual_discounts WHERE customer_user_id=$1 AND id<>$2
        AND status='Active' AND starts_on <= $4::date AND ends_on >= $3::date LIMIT 1`,
      [customer.user_id, id, input.startsOn, input.endsOn]);
      if (overlap.rows.length) throw new AppError(409, "DISCOUNT_OVERLAP", "Another manual discount covers these dates");
      if (previous) await db.query(`UPDATE customer_manual_discounts SET name=$2,kind=$3,value=$4,starts_on=$5,
        ends_on=$6,piece_limit=$7,updated_by=$8,version=version+1,updated_at=now() WHERE id=$1`,
      [id, input.name, input.kind, input.value, input.startsOn, input.endsOn, input.pieceLimit, actor]);
      else await db.query(`INSERT INTO customer_manual_discounts(id,customer_user_id,name,kind,value,starts_on,ends_on,piece_limit,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [id, customer.user_id, input.name, input.kind, input.value, input.startsOn, input.endsOn, input.pieceLimit, actor]);
    } else await db.query("UPDATE customer_manual_discounts SET status='Cancelled',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1", [id, actor]);
    await db.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,old_values,new_values,request_id)
      VALUES('staff',$1,$2,'customer_manual_discounts',$3,$4::jsonb,$5::jsonb,$6)`,
    [actor, !input ? "MANUAL_DISCOUNT_CANCELLED" : previous ? "MANUAL_DISCOUNT_UPDATED" : "MANUAL_DISCOUNT_CREATED", id,
      previous ? JSON.stringify(previous) : null, JSON.stringify(input || { status: "Cancelled" }), requestId]);
    await db.query("COMMIT");
    return { id, version: Number(previous?.version || 0) + 1 };
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { db.release(); }
}
