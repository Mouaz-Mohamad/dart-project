import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { birthdayWindow, flexibleDateExpiry } from "../commerce/commerce.rewards.js";

export const CUSTOMER_DETAIL_PERMISSIONS = {
  orders: "orders.read", reviews: "reviews.read", waiting: "waiting.read", returns: "returns.read", discounts: "promotions.read",
} as const;
export type CustomerDetailSection = keyof typeof CUSTOMER_DETAIL_PERMISSIONS;

export async function customerDetails(pool: Pool, ref: string, section: CustomerDetailSection, offset: number,
  actorId: string, permissions: string[]) {
  const customer = (await pool.query<{ user_id: string; client_code: string; birthday: string | null }>(
    "SELECT user_id::text,client_code,birthday::text FROM customers WHERE user_id::text=$1 OR client_code=$1", [ref])).rows[0];
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer not found");
  const limit = 50;
  let rows: Record<string, unknown>[] = [];
  let extra: Record<string, unknown> = {};
  if (section === "orders") {
    rows = (await pool.query(`SELECT o.id::text,o.order_code AS "orderId",o.status,o.created_at AS date,
      o.final_minor::text AS "finalMinor",o.amount_refunded_minor::text AS "refundedMinor",o.is_archived AS archived,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('itemCode',oi.item_code,'name',oi.model_name,'color',oi.color,
        'size',oi.size,'finalMinor',oi.final_unit_minor::text) ORDER BY oi.created_at,oi.id)
        FROM order_items oi WHERE oi.order_id=o.id),'[]'::jsonb) AS items
      FROM orders o WHERE (o.customer_user_id=$1 OR (o.customer_user_id IS NULL AND o.legacy->>'clientId'=$2))
        AND NOT o.is_deleted ORDER BY o.created_at DESC,o.id DESC LIMIT $3 OFFSET $4`,
    [customer.user_id, customer.client_code, limit + 1, offset])).rows;
  } else if (section === "reviews") {
    rows = (await pool.query(`SELECT value AS payload FROM dashboard_domain_state s CROSS JOIN LATERAL jsonb_array_elements(s.data) value
      WHERE s.domain='reviews' AND COALESCE(value->>'clientId',value->>'customerId')=ANY($1::text[])
        AND COALESCE(value->>'isDeleted','false')<>'true'
        AND lower(COALESCE(value->>'recordType',value->>'source','review')) NOT IN ('contact','contact us')
      ORDER BY COALESCE(value->>'createdAt',value->>'date','') DESC,value->>'id' LIMIT $2 OFFSET $3`,
    [[customer.client_code, customer.user_id], limit + 1, offset])).rows.map((row) => row.payload as Record<string, unknown>);
  } else if (section === "waiting") {
    // Waiting demand is separate from the customer's temporary shopping-cart hold.
    rows = (await pool.query(`SELECT w.id::text,w.model_id AS "modelId",m.name,w.desired_color AS color,w.size,w.status,
      w.requested_at AS date,w.reserved_until AS "reservedUntil",w.converted_order_code AS "orderId",1 AS "pieceCount",'[]'::jsonb AS selections
      FROM waitlist_entries w JOIN catalog_models m ON m.model_id=w.model_id
      WHERE w.customer_user_id=$1 AND w.status IN ('waiting','reserved','confirmed')
      UNION ALL SELECT w.id::text,w.set_id,w.set_name_snapshot,''::text,''::text,w.status,w.requested_at,w.reserved_until,NULL::text,w.piece_count,w.selections
      FROM set_waiting_entries w
      WHERE w.customer_user_id=$1 AND w.status IN ('waiting','reserved','confirmed')
      ORDER BY date DESC,id LIMIT $2 OFFSET $3`, [customer.user_id, limit + 1, offset])).rows;
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM waitlist_entries WHERE customer_user_id=$1 AND status IN ('waiting','reserved','confirmed'))::int
      + COALESCE((SELECT sum(w.piece_count) FROM set_waiting_entries w
        WHERE w.customer_user_id=$1 AND w.status IN ('waiting','reserved','confirmed')),0)::int AS pieces`, [customer.user_id]);
    extra = { pieces: Number(counts.rows[0]?.pieces || 0) };
  } else if (section === "returns") {
    rows = (await pool.query(`SELECT payload FROM return_requests WHERE customer_code=$1
      AND COALESCE(payload->>'isDeleted','false')<>'true'
      ORDER BY COALESCE(payload->>'createdAt',payload->>'date','') DESC,record_id LIMIT $2 OFFSET $3`,
    [customer.client_code, limit + 1, offset])).rows.map((row) => row.payload as Record<string, unknown>);
  } else {
    rows = (await pool.query(`SELECT d.id::text,d.name,d.kind,d.value,d.starts_on::text AS "startsOn",d.ends_on::text AS "endsOn",
        d.piece_limit AS "pieceLimit",d.status,d.version,o.order_code AS "orderId",d.used_at AS "usedAt"
      FROM customer_manual_discounts d LEFT JOIN orders o ON o.id=d.order_id WHERE d.customer_user_id=$1
      ORDER BY d.created_at DESC,d.id DESC LIMIT $2 OFFSET $3`, [customer.user_id, limit + 1, offset])).rows;
    const owner = await pool.query<{ is_owner: boolean }>("SELECT is_owner FROM staff_users WHERE user_id=$1", [actorId]);
    const benefits: Record<string, unknown>[] = [];
    if (permissions.includes("loyalty.read")) {
      const cards = await pool.query<{ payload: Record<string, unknown> }>("SELECT payload FROM loyalty_cards WHERE customer_code=$1 AND status='Active'", [customer.client_code]);
      for (const { payload: card } of cards.rows) {
        const remaining = Math.max(0, Number(card.itemLimit || card.purchasedLimit || 10) - Number(card.purchasedItems || 0) - Number(card.reservedItems || 0));
        const expiry = flexibleDateExpiry(card.expDate);
        if (remaining && (!expiry || expiry >= Date.now()) && !card.isDeleted && !card.isArchived) benefits.push({
          type: "Dart Card", name: card.cardId || "Dart Card", discountPercent: card.discountPercent || 40, remaining, expiresAt: card.expDate,
        });
      }
      const window = birthdayWindow(customer.birthday);
      if (window) {
        const used = await pool.query("SELECT 1 FROM birthday_discount_usage WHERE customer_user_id=$1 AND reward_year=$2 AND status IN ('Used','Reserved')", [customer.user_id, window.year]);
        const settings = await pool.query<{ data: Record<string, unknown> }>("SELECT data FROM site_settings WHERE id='main'");
        if (!used.rows.length) benefits.push({ type: "Birthday", name: "Birthday", discountPercent: Number(settings.rows[0]?.data.birthdayDiscountPercent || 30), expiresAt: window.expiresAt });
      }
    }
    extra = { canManageManual: Boolean(owner.rows[0]?.is_owner), benefits };
  }
  return { rows: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null, ...extra };
}
