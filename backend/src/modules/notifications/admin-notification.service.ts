// DART CODE GUIDE | backend/src/modules/notifications/admin-notification.service.ts
// Staff history is filtered by current permissions; reading never changes another user's state.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { effectivePermissionsForUser } from "../identity/effective-permissions.js";
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

  // Real, owner-initiated broadcast. No fake business notifications are created.
  private async requireOwner(actorId: string, db: Pool | PoolClient): Promise<void> {
    const result = await db.query(
      "SELECT 1 FROM staff_users s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.is_owner AND s.disabled_at IS NULL AND u.status='active' AND u.deleted_at IS NULL LIMIT 1",
      [actorId],
    );
    if (!result.rows.length) throw new AppError(403, "FORBIDDEN", "Only the Dart owner can send test notifications");
  }

  async queueTestBroadcast(actorId: string, requestId: string) {
    if (!this.push.pushConfig().configured) throw new AppError(503,"PUSH_UNAVAILABLE","Phone notifications are not configured");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.requireOwner(actorId,client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dart_admin_push_broadcast_test'))");
      const recent=await client.query("SELECT 1 FROM outbox_events WHERE event_type='ADMIN_PUSH_TEST' AND created_at>now()-interval '60 seconds' LIMIT 1");
      if(recent.rows.length)throw new AppError(429,"TEST_COOLDOWN","Wait a minute before running another test");
      const candidates=await client.query<{id:string;version:number;customer_user_id:string}>(`
        SELECT p.id::text,p.version,p.customer_user_id::text
        FROM admin_push_subscriptions p JOIN users u ON u.id=p.customer_user_id
        JOIN staff_users staff ON staff.user_id=u.id
        WHERE p.active AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL
          AND staff.disabled_at IS NULL
          AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.family_id=p.session_family_id
            AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version
            AND (NOT staff.mfa_required OR s.mfa_verified_at IS NOT NULL))
        ORDER BY p.id
      `);
      const access=new Map<string,boolean>(),eligible:typeof candidates.rows=[];
      for(const device of candidates.rows) {
        let allowed=access.get(device.customer_user_id);
        if(allowed===undefined){
          allowed=(await effectivePermissionsForUser(device.customer_user_id,client)).includes("notifications.read");
          access.set(device.customer_user_id,allowed);
        }
        if(allowed)eligible.push(device);
      }
      if(!eligible.length)throw new AppError(409,"NO_ACTIVE_PUSH_DEVICES","No dashboard devices have active notification subscriptions");
      const testId=randomUUID();
      await client.query(`
        INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
        SELECT 'admin_push_test',$1,'ADMIN_PUSH_TEST',
          jsonb_build_object('channel','web_push','audience','staff',
            'testId',$1,'subscriptionId',devices.id,'subscriptionVersion',devices.version),
          'admin-push-test:'||$1||':'||devices.id::text
        FROM unnest($2::uuid[],$3::int[]) AS devices(id,version)
      `,[testId,eligible.map(p=>p.id),eligible.map(p=>p.version)]);
      await client.query(`
        INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,new_values)
        VALUES('staff',$1,'ADMIN_PUSH_TEST_QUEUED','admin_push_test',$2,$3,$4::jsonb)
      `,[actorId,testId,requestId,JSON.stringify({targetDevices:eligible.length})]);
      await client.query("COMMIT");
      return {testId,queued:eligible.length};
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async testBroadcastStatus(actorId:string,testId:string) {
    await this.requireOwner(actorId,this.pool);
    const result=await this.pool.query<{total:string;accepted:string;suppressed:string;failed:string;unknown:string}>(`
      SELECT count(*)::text AS total,
        count(*) FILTER(WHERE a.state='accepted')::text AS accepted,
        count(*) FILTER(WHERE a.state='suppressed')::text AS suppressed,
        count(*) FILTER(WHERE a.state='terminal' OR (a.state IS NULL AND e.attempts>=12))::text AS failed,
        count(*) FILTER(WHERE a.state IN ('unknown','executing') AND a.updated_at<now()-interval '5 minutes')::text AS unknown
      FROM outbox_events e LEFT JOIN LATERAL(
        SELECT state,updated_at FROM outbox_delivery_attempts
        WHERE event_id=e.id AND state<>'retryable'
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) a ON true
      WHERE e.aggregate_type='admin_push_test' AND e.event_type='ADMIN_PUSH_TEST' AND e.aggregate_id=$1
    `,[testId]);
    const row=result.rows[0],total=Number(row?.total||0);
    if(!total)throw new AppError(404,"NOT_FOUND","Test notification batch not found");
    const accepted=Number(row?.accepted||0),suppressed=Number(row?.suppressed||0);
    const failed=Number(row?.failed||0),unknown=Number(row?.unknown||0);
    return {testId,total,accepted,suppressed,failed,unknown,pending:Math.max(0,total-accepted-suppressed-failed-unknown)};
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
