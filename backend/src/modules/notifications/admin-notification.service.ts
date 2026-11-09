// DART CODE GUIDE | backend/src/modules/notifications/admin-notification.service.ts
// Staff history is filtered by current permissions; reading never changes another user's state.
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../../http/app-error.js";
import type { AppConfig } from "../../config/env.js";
import { CustomerNotificationService } from "./notification.service.js";
import { allowedAdminEvents, type AdminNotificationEvent } from "./admin-notification.queue.js";
const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() }).strict();
export const adminMessages: Record<AdminNotificationEvent, { title: string; section: string }> = {
  ORDER_CREATED: { title: "New order", section: "orders" },
  RETURN_CREATED: { title: "New return request", section: "returns" },
  EXCHANGE_CREATED: { title: "New exchange request", section: "returns" },
  REVIEW_CREATED: { title: "New review", section: "review" },
};
export class AdminNotificationService {
  readonly push: CustomerNotificationService;
  constructor(private readonly pool: Pool, config: Pick<AppConfig, "mfaEncryptionKey" | "webPushVapidPublicKey" | "webPushVapidPrivateKey" | "webPushVapidSubject">) {
    this.push = new CustomerNotificationService(pool, config, "staff");
  }
  async list(userId: string, permissions: string[], limit = 25, cursor?: string, id?: string) {
    let before: z.infer<typeof cursorSchema> | undefined;
    if (cursor) {
      try { before = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))); }
      catch { throw new AppError(422, "INVALID_CURSOR", "Invalid notification page"); }
    }
    const events = allowedAdminEvents(permissions);
    const result = await this.pool.query<{ id: string; event_type: AdminNotificationEvent; entity_id: string; entity_code: string; created_at: Date; read_at: Date | null }>(
      `SELECT n.*,r.read_at FROM admin_notifications n
       LEFT JOIN admin_notification_reads r ON r.notification_id=n.id AND r.user_id=$1
       WHERE n.event_type=ANY($2::text[]) AND ($6::uuid IS NULL OR n.id=$6) AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3::timestamptz,$4::uuid))
       ORDER BY n.created_at DESC,n.id DESC LIMIT $5`, [userId,events,before?.at||null,before?.id||null,limit+1,id||null]);
    const counts = await this.pool.query<{ event_type: AdminNotificationEvent; count: string }>(
      `SELECT n.event_type,count(*)::text FROM admin_notifications n
       WHERE n.event_type=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM admin_notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)
       GROUP BY n.event_type`, [userId,events]);
    const unread = { orders: 0, returns: 0, review: 0 }, rows = result.rows.slice(0,limit), last = rows.at(-1);
    for (const row of counts.rows) unread[adminMessages[row.event_type].section as keyof typeof unread] += Number(row.count);
    return { notifications: rows.map(row => ({ id: row.id, eventType: row.event_type, entityId: row.entity_id,
      entityCode: row.entity_code, ...adminMessages[row.event_type], createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString()||null })),
      unread, unreadCount: Object.values(unread).reduce((a,b)=>a+b,0),
      nextCursor: result.rows.length>limit && last ? Buffer.from(JSON.stringify({at:last.created_at.toISOString(),id:last.id})).toString("base64url") : null };
  }
  async markRead(userId: string, permissions: string[], ids: string[]) {
    const result = await this.pool.query(`WITH inserted AS (INSERT INTO admin_notification_reads(user_id,notification_id)
      SELECT $1,n.id FROM admin_notifications n WHERE n.id=ANY($2::uuid[]) AND n.event_type=ANY($3::text[])
      ON CONFLICT DO NOTHING RETURNING notification_id)
      UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='admin_notifications' AND EXISTS(SELECT 1 FROM inserted)
      RETURNING (SELECT count(*)::int FROM inserted) AS updated`, [userId,ids,allowedAdminEvents(permissions)]);
    return { updated: Number(result.rows[0]?.updated || 0) };
  }
}
