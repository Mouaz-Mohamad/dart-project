import type { PoolClient } from "pg";

// Only a new operation is queued. Deployment never emails historical orders.
export async function queueOrderEmail(client: PoolClient, orderId: string, eventType: "order.created" | "order.status_changed"): Promise<void> {
  const result = await client.query<{
    order_code: string; status: string; final_minor: string; version: string;
    recipient: string | null; customer_name: string;
  }>(
    `SELECT o.order_code,o.status,o.final_minor::text,o.version::text,
            CASE WHEN o.customer_user_id IS NULL THEN o.contact_snapshot->>'email'
                 WHEN u.status='active' AND u.deleted_at IS NULL THEN u.email ELSE NULL END AS recipient,
            COALESCE(NULLIF(o.contact_snapshot->>'name',''),c.full_name,'Dart customer') AS customer_name
       FROM orders o LEFT JOIN users u ON u.id=o.customer_user_id
       LEFT JOIN customers c ON c.user_id=o.customer_user_id WHERE o.id=$1`, [orderId],
  );
  const order = result.rows[0];
  const recipient = String(order?.recipient || "").trim();
  if (!order || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return;
  const key = eventType === "order.created" ? `${eventType}:${orderId}` : `${eventType}:${orderId}:${order.version}`;
  await client.query(
    `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
     VALUES('order',$1,$2,$3::jsonb,$4)
     ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [orderId, eventType, JSON.stringify({ channel: "email", to: recipient, orderId,
      parameters: { orderCode: order.order_code, customerName: order.customer_name,
        status: order.status, total: (Number(order.final_minor) / 100).toFixed(2) } }), key],
  );
}
