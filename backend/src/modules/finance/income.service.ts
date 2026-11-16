// DART CODE GUIDE | backend/src/modules/finance/income.service.ts
// الوارد: عمليات على سجل واحد، قفل الأوردر أولاً، وتأكيد التحصيل مرة واحدة.
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

export const INCOME_KINDS = ["Other Income", "Capital", "Loan", "Order Collection"] as const;
export interface IncomeInput {
  id: string;
  kind: typeof INCOME_KINDS[number];
  category: string;
  description: string;
  amountMinor: number;
  expectedOn: string;
  sourceName: string;
  sourcePhone: string;
  notes: string;
  orderId?: string | undefined;
}
interface IncomeRow extends Record<string, unknown> {
  id: string; kind: IncomeInput["kind"]; category: string; description: string;
  amount_minor: string; currency: string; status: string; expected_on: string | Date;
  received_on: string | Date | null; source_name: string; source_phone: string; notes: string;
  order_id: string | null; order_code?: string | undefined; request_hash: string; version: string;
  created_at: Date; updated_at: Date;
}
function day(value: string | Date | null): string | null {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
export function incomeProjection(row: IncomeRow) {
  return { id: row.id, kind: row.kind, category: row.category, description: row.description,
    amountMinor: Number(row.amount_minor), amount: Number(row.amount_minor) / 100, currency: row.currency,
    status: row.status, expectedOn: day(row.expected_on), receivedOn: day(row.received_on),
    sourceName: row.source_name, sourcePhone: row.source_phone, notes: row.notes,
    orderId: row.order_code || row.order_id || "", version: Number(row.version),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export class IncomeService {
  constructor(private readonly pool: Pool) {}

  async list(start: string, end: string) {
    const result = await this.pool.query<IncomeRow>(`SELECT i.*,i.expected_on::text,i.received_on::text,o.order_code FROM finance_income_entries i
      LEFT JOIN orders o ON o.id=i.order_id
      WHERE (CASE WHEN i.status='Received' THEN i.received_on ELSE i.expected_on END) BETWEEN $1::date AND $2::date
      ORDER BY i.created_at DESC,i.id`, [start, end]);
    return result.rows.map(incomeProjection);
  }

  private async transaction<T>(actorId: string, requestId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dart.finance_actor_id',$1,true),set_config('dart.finance_request_id',$2,true)", [actorId, requestId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async create(actorId: string, input: IncomeInput, requestId: string) {
    // Gift entries are created by the authoritative order transaction. Linking
    // here would let a normal COD order be collected again outside its ledger.
    if (input.kind === "Order Collection" || input.orderId) {
      throw new AppError(409, "GIFT_ORDER_REQUIRED", "Select Payment by someone else in the order editor; its linked pending income is created automatically");
    }
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.transaction(actorId, requestId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:income:${input.id}`]);
      const previous = (await client.query<IncomeRow>("SELECT *,expected_on::text,received_on::text FROM finance_income_entries WHERE id=$1 FOR UPDATE", [input.id])).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This income identifier has already been used");
        return incomeProjection(previous);
      }
      const result = await client.query<IncomeRow>(`INSERT INTO finance_income_entries
        (id,kind,category,description,amount_minor,expected_on,source_name,source_phone,notes,request_hash)
        VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10) RETURNING *,expected_on::text,received_on::text`,
      [input.id, input.kind, input.category, input.description, input.amountMinor, input.expectedOn, input.sourceName, input.sourcePhone, input.notes, hash]);
      return incomeProjection(result.rows[0]!);
    });
  }

  async change(actorId: string, id: string, expectedVersion: number, action: "edit" | "receive" | "void",
    input: Partial<IncomeInput> & { receivedOn?: string | undefined }, requestId: string) {
    return this.transaction(actorId, requestId, async client => {
      // All writers lock order -> receipt. Discover the immutable relation before
      // locking; taking these locks in reverse order deadlocks an order edit.
      const hint = (await client.query<{ order_id: string | null }>("SELECT order_id::text FROM finance_income_entries WHERE id=$1", [id])).rows[0];
      if (!hint) throw new AppError(404, "INCOME_NOT_FOUND", "Income entry not found");
      const order = hint.order_id ? (await client.query<{id: string; order_code: string; status: string; final_minor: string; amount_paid_minor: string; amount_refunded_minor: string; legacy: Record<string, unknown>; is_deleted: boolean; is_archived: boolean}>(
        "SELECT id::text,order_code,status,final_minor::text,amount_paid_minor::text,amount_refunded_minor::text,legacy,is_deleted,is_archived FROM orders WHERE id=$1 FOR UPDATE", [hint.order_id])).rows[0] : null;
      const row = (await client.query<IncomeRow>("SELECT *,expected_on::text,received_on::text FROM finance_income_entries WHERE id=$1 FOR UPDATE", [id])).rows[0]!;
      if (action === "receive" && row.status === "Received" && day(row.received_on) === input.receivedOn) {
        return incomeProjection({ ...row, order_code: order?.order_code });
      }
      if (action === "void" && row.status === "Void") return incomeProjection(row);
      if (Number(row.version) !== expectedVersion) throw new AppError(409, "INCOME_VERSION_CONFLICT", "This income changed; refresh before continuing");
      if (row.status !== "Pending") throw new AppError(409, "INCOME_LOCKED", "Only pending income can be changed; received entries retain their history");
      let result;
      if (action === "edit") {
        if (row.order_id && (input.kind !== "Order Collection" || input.amountMinor !== Number(row.amount_minor) || input.orderId !== order?.order_code)) {
          throw new AppError(409, "ORDER_INCOME_LOCKED", "Edit the order to change its linked amount");
        }
        if (!row.order_id && (input.kind === "Order Collection" || input.orderId)) throw new AppError(409, "GIFT_ORDER_REQUIRED", "Create linked income from its gift order");
        result = await client.query<IncomeRow>(`UPDATE finance_income_entries SET kind=$2,category=$3,description=$4,
          amount_minor=$5,expected_on=$6::date,source_name=$7,source_phone=$8,notes=$9,version=version+1,updated_at=now()
          WHERE id=$1 RETURNING *,expected_on::text,received_on::text`, [id,input.kind,input.category,input.description,input.amountMinor,input.expectedOn,input.sourceName,input.sourcePhone,input.notes]);
      } else if (action === "void") {
        if (row.order_id) throw new AppError(409, "ORDER_INCOME_LOCKED", "Cancel or refuse the gift order to cancel its pending income");
        result = await client.query<IncomeRow>("UPDATE finance_income_entries SET status='Void',version=version+1,updated_at=now() WHERE id=$1 RETURNING *,expected_on::text,received_on::text", [id]);
      } else {
        const today = (await client.query<{today: string}>("SELECT to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD') AS today")).rows[0]!.today;
        if (!input.receivedOn || input.receivedOn > today) throw new AppError(422, "INCOME_DATE_INVALID", "Received date cannot be in the future");
        if (row.order_id) {
          if (!order || order.is_deleted || order.is_archived || ["Cancelled","Refused","Returned"].includes(order.status) || order.legacy?.collectionMode !== "Third Party") {
            throw new AppError(409, "ORDER_INCOME_NOT_COLLECTIBLE", "This order is not available for collection");
          }
          if (Number(order.amount_paid_minor) !== 0 || Number(order.amount_refunded_minor) !== 0 || Number(order.final_minor) !== Number(row.amount_minor)) {
            throw new AppError(409, "ORDER_INCOME_BALANCE_CHANGED", "The order balance changed; review the order before collecting");
          }
          await client.query("UPDATE orders SET amount_paid_minor=final_minor,payment_status='Paid',version=version+1,updated_at=now() WHERE id=$1", [order.id]);
          await client.query("UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='orders'");
        }
        result = await client.query<IncomeRow>("UPDATE finance_income_entries SET status='Received',received_on=$2::date,version=version+1,updated_at=now() WHERE id=$1 RETURNING *,expected_on::text,received_on::text", [id,input.receivedOn]);
      }
      return incomeProjection({ ...result.rows[0]!, order_code: order?.order_code });
    });
  }
}
