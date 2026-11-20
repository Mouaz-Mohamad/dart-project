// Optional one-time purchase milestone; monthly Dart Card draws keep their existing rules.
import type { PoolClient } from "pg";
import { cairoDateKey } from "../commerce/commerce.rewards.js";
import { isDartCardEnabled } from "../settings/dart-card-switch.js";

type Goal = { enabled: boolean; targetPieces: number; showWithin: number; message: string };
function goalFor(settings: Record<string, unknown>): Goal | null {
  const bar = settings.shoppingBar as { enabled?: boolean; cardGoal?: Goal } | undefined;
  return isDartCardEnabled(settings) && bar?.cardGoal?.enabled ? bar.cardGoal : null;
}
async function facts(client: PoolClient, userId: string) {
  const result = await client.query<{ client_code: string; full_name: string; pieces: string }>(`
    SELECT c.client_code,c.full_name,(SELECT count(*)::text FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.customer_user_id=c.user_id AND o.status='Delivered' AND NOT o.is_deleted AND oi.final_unit_minor>0
        AND NOT EXISTS(SELECT 1 FROM return_requests r WHERE r.order_id=o.id AND r.inventory_item_id=oi.inventory_item_id
          AND lower(r.request_type) IN ('return','refund') AND
          (lower(r.status) IN ('completed','returned','closed','done','good','damaged','bad') OR r.payload->>'financialCompletionApplied'='true'))
      ) AS pieces FROM customers c WHERE c.user_id=$1`, [userId]);
  const customer = result.rows[0];
  if (!customer) return null;
  const cards = await client.query<{ payload: Record<string, unknown> }>("SELECT payload FROM loyalty_cards WHERE customer_code=$1", [customer.client_code]);
  const hasCard = cards.rows.some(({ payload }) => payload.source === "Purchase Goal" ||
    (payload.status === "Active" && !payload.isArchived && !payload.isDeleted &&
      Number(payload.purchasedItems || 0) + Number(payload.reservedItems || 0) < Number(payload.itemLimit || payload.purchasedLimit || 10) &&
      (!payload.expDate || String(payload.expDate).slice(0, 10) >= cairoDateKey())));
  return { ...customer, pieces: Number(customer.pieces), hasCard };
}

export async function cardGoalProgress(client: PoolClient, userId: string | null, settings: Record<string, unknown>, cartPaidPieces = 0) {
  const goal = goalFor(settings);
  if (!goal || !userId) return [];
  const customer = await facts(client, userId);
  if (!customer || customer.hasCard) return [];
  const remaining = Math.max(0, goal.targetPieces - customer.pieces);
  // A delivered milestone is awarded by the order transaction. Never invent
  // a guarantee for the competitive monthly draw or count undelivered orders.
  if (!remaining || remaining > goal.showWithin) return [];
  let message = goal.message ? goal.message.replaceAll("{remaining}", String(remaining)).replaceAll("{target}", String(goal.targetPieces))
    : `فاضلك ${remaining} قطعة مشتراة ومستلمة وتحصل على Dart Card.`;
  message += cartPaidPieces >= remaining ? " سلتك تكمل الهدف — كمّل طلبك ليُحتسب بعد الاستلام."
    : cartPaidPieces ? ` بعد استلام اختياراتك الحالية يتبقى ${remaining - cartPaidPieces} قطعة.` : " اختار قطعك الجديدة وقرّب من الهدف.";
  return [{ id: "card-purchase-goal", type: "card", title: "قرّبت من Dart Card", message,
    target: goal.targetPieces, current: customer.pieces, remaining, achieved: false, priority: 0 }];
}

export async function awardPurchaseGoalCard(client: PoolClient, orderId: string) {
  const settings = (await client.query<{ data: Record<string, unknown> }>("SELECT data FROM site_settings WHERE id='main'")).rows[0]?.data || {};
  const goal = goalFor(settings);
  if (!goal) return;
  const order = (await client.query<{ customer_user_id: string }>("SELECT customer_user_id::text FROM orders WHERE id=$1 AND status='Delivered'", [orderId])).rows[0];
  if (!order?.customer_user_id) return;
  // The shared cards-domain lock also serializes monthly/manual card writers.
  await client.query("SELECT version FROM dashboard_domain_state WHERE domain='cards' FOR UPDATE");
  const customer = await facts(client, order.customer_user_id);
  if (!customer || customer.hasCard || customer.pieces < goal.targetPieces) return;
  const id = `CARD-GOAL-${order.customer_user_id}`, issueDate = cairoDateKey();
  const expiry = new Date(`${issueDate}T12:00:00Z`); expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  const payload = { id, cardId: id, clientId: customer.client_code, customerId: customer.client_code, customerName: customer.full_name,
    source: "Purchase Goal", status: "Active", discountPercent: Number(settings.dartCardDiscountPercent ?? 40),
    itemLimit: 10, purchasedLimit: 10, purchasedItems: 0, reservedItems: 0, issueDate, expDate: expiry.toISOString().slice(0, 10),
    earnedTargetPieces: goal.targetPieces, awardedPieceCount: customer.pieces, earnedOrderId: orderId, createdAt: new Date().toISOString() };
  const inserted = await client.query(`INSERT INTO loyalty_cards(record_id,position,payload)
    VALUES($1,(SELECT COALESCE(max(position),0)+1 FROM loyalty_cards),$2::jsonb) ON CONFLICT(record_id) DO NOTHING RETURNING record_id`,
    [id, JSON.stringify(payload)]);
  if (!inserted.rows.length) return;
  await client.query("UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='cards'");
  await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
    VALUES('system','PURCHASE_GOAL_CARD_AWARDED','cards',$1,$2::jsonb)`, [id, JSON.stringify({ orderId, targetPieces: goal.targetPieces })]);
}
