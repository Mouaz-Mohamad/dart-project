// DART CODE GUIDE | backend/src/modules/notifications/notification.queue.ts
// Three initial customer events are committed atomically with the order operation.
import type { PoolClient } from "pg";

export type OrderNotificationEvent =
  | "ORDER_PLACED"
  | "ORDER_OUT_FOR_DELIVERY"
  | "ORDER_DELIVERED";
export async function sendNotification(
  client: PoolClient,
  input: {
    customerUserId: string;
    orderId: string;
    orderCode: string;
    eventType: OrderNotificationEvent;
  },
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO customer_notifications
    (customer_user_id,order_id,order_code,event_type,event_key)
    SELECT $1,$2,$3,$4,$5 FROM users u JOIN customers c ON c.user_id=u.id
      WHERE u.id=$1 AND u.status='active' AND u.deleted_at IS NULL
    ON CONFLICT(event_key) DO NOTHING RETURNING id::text`,
    [
      input.customerUserId,
      input.orderId,
      input.orderCode,
      input.eventType,
      `${input.orderId}:${input.eventType}`,
    ],
  );
  const notificationId = result.rows[0]?.id;
  if (!notificationId) return;
  await client.query(
    `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
    SELECT 'customer_notification',$1,$2,jsonb_build_object('channel','web_push','notificationId',$1::text,
      'subscriptionId',p.id::text,'subscriptionVersion',p.version), 'web-push:'||$1::text||':'||p.id::text
      FROM web_push_subscriptions p JOIN users u ON u.id=p.customer_user_id
      WHERE p.customer_user_id=$3 AND p.active AND u.status='active' AND u.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM sessions s WHERE s.family_id=p.session_family_id AND s.user_id=u.id
          AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version)
    ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [notificationId, input.eventType, input.customerUserId],
  );
}
