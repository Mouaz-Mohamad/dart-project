// DART CODE GUIDE | backend/src/modules/notifications/admin-notification.queue.ts
// Atomic event creation; a unique event/entity pair makes retries harmless.
import type { PoolClient } from "pg";
export type AdminNotificationEvent = "ORDER_CREATED" | "RETURN_CREATED" | "EXCHANGE_CREATED" | "REVIEW_CREATED";
export async function queueAdminNotification(client: PoolClient, event: AdminNotificationEvent, entityId: string, code = "") {
  await client.query(`INSERT INTO admin_notifications(event_type,entity_id,entity_code) VALUES($1,$2,$3)
    ON CONFLICT(event_type,entity_id) DO NOTHING`, [event, entityId, code]);
}
export const adminEventPermission: Record<AdminNotificationEvent, string> = {
  ORDER_CREATED: "orders.read", RETURN_CREATED: "returns.read", EXCHANGE_CREATED: "returns.read", REVIEW_CREATED: "reviews.read",
};
export function allowedAdminEvents(permissions: string[]): AdminNotificationEvent[] {
  if (!permissions.includes("notifications.read")) return [];
  return (Object.keys(adminEventPermission) as AdminNotificationEvent[]).filter(event => permissions.includes(adminEventPermission[event]));
}
