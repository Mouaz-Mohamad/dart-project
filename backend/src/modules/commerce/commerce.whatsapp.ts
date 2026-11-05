import type { PoolClient } from "pg";
import { normalizeEgyptianPhone } from "../../security/normalization.js";

export interface OrderWhatsAppReply {
  messageId: string;
  from: string;
  payload: string;
  timestamp: number;
}

// The workflow calls this only after physical handover, in its own transaction.
// An order has one outbound notification intent; retries and route restarts reuse it.
export async function queueOrderDispatch(client: PoolClient, orderId: string): Promise<void> {
  const order = (await client.query<{ order_code: string; phone: string; customer_name: string; confirmed_at: string }>(
    `SELECT order_code,contact_snapshot->>'phone1' AS phone,
       COALESCE(NULLIF(contact_snapshot->>'name',''),'عميل دارت') AS customer_name,legacy->>'dispatchConfirmedAt' AS confirmed_at
       FROM orders WHERE id=$1 AND status='Out With Representative' AND NOT is_deleted`, [orderId],
  )).rows[0];
  if (!order?.confirmed_at) return;
  let phone: string;
  try { phone = normalizeEgyptianPhone(order.phone || ""); }
  catch {
    await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id)
      VALUES('system','ORDER_DISPATCH_WHATSAPP_PHONE_INVALID','orders',$1)`, [orderId]);
    return;
  }
  await client.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
    VALUES('order',$1,'ORDER_WHATSAPP_DISPATCHED',$2::jsonb,$3)
    ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [orderId, JSON.stringify({ channel: "whatsapp", category: "utility", to: phone,
      confirmedAt: order.confirmed_at, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      parameters: [order.customer_name, order.order_code] }), `order-whatsapp-dispatched:${orderId}`]);
}

// Called in the checkout transaction. Email/push eligibility must not gate this message.
export async function queueOrderConfirmation(client: PoolClient, orderId: string): Promise<void> {
  const order = (await client.query<{
    order_code: string; final_minor: string; version: string; phone: string;
  }>(`SELECT order_code,final_minor::text,version::text,contact_snapshot->>'phone1' AS phone
      FROM orders WHERE id=$1 AND status='New' AND order_source='Website'
        AND NOT is_deleted`, [orderId])).rows[0];
  if (!order) return;
  let phone: string;
  try { phone = normalizeEgyptianPhone(order.phone || ""); }
  catch {
    await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id)
      VALUES('system','ORDER_WHATSAPP_PHONE_INVALID','orders',$1)`, [orderId]);
    return;
  }
  const confirmation = (await client.query<{ id: string }>(
    `INSERT INTO order_whatsapp_confirmations(order_id,phone_normalized,expected_version,final_minor)
     VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING id::text`,
    [orderId, phone, order.version, order.final_minor])).rows[0];
  if (!confirmation) return;
  await client.query(`INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
    VALUES('order',$1,'ORDER_WHATSAPP_CONFIRMATION',$2::jsonb,$3)
    ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [orderId, JSON.stringify({channel:"whatsapp",category:"utility",to:phone,
      confirmationId:confirmation.id, parameters:[order.order_code,(Number(order.final_minor)/100).toFixed(2)]}),
    `order-whatsapp-confirmation:${orderId}`]);
  await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,new_values)
    VALUES('system','ORDER_WHATSAPP_QUEUED','orders',$1,$2::jsonb)`,
    [orderId, JSON.stringify({confirmationId:confirmation.id,category:"utility"})]);
}
