// DART CODE GUIDE | backend/src/modules/notifications/notification.service.ts
// Customer-owned notification history and explicit, session-bound browser consent.
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { encryptSecret } from "../../security/crypto.js";
import {
  fingerprint,
  pushSubscriptionSchema,
  type BrowserPushSubscription,
} from "./push-validation.js";

const cursorSchema = z
  .object({ at: z.string().datetime(), id: z.string().uuid() })
  .strict();
const messages: Record<string, { title: string; message: string }> = {
  ORDER_PLACED: {
    title: "Order placed",
    message: "Your order has been placed.",
  },
  ORDER_OUT_FOR_DELIVERY: {
    title: "Out for delivery",
    message: "Your representative is on the way with your order.",
  },
  ORDER_DELIVERED: {
    title: "Order delivered",
    message: "Your order has been delivered. Thank you for choosing Dart.",
  },
};
type NotificationConfig = Pick<
  AppConfig,
  | "mfaEncryptionKey"
  | "webPushVapidPublicKey"
  | "webPushVapidPrivateKey"
  | "webPushVapidSubject"
>;

export class CustomerNotificationService {
  constructor(
    private readonly pool: Pool,
    private readonly config: NotificationConfig,
  ) {}

  public pushConfig(): { configured: boolean; publicKey: string | null } {
    const configured = Boolean(
      this.config.webPushVapidPublicKey &&
        this.config.webPushVapidPrivateKey &&
        this.config.webPushVapidSubject,
    );
    return {
      configured,
      publicKey: configured ? this.config.webPushVapidPublicKey! : null,
    };
  }

  public async list(userId: string, limit = 25, cursor?: string) {
    let before: z.infer<typeof cursorSchema> | undefined;
    if (cursor) {
      try {
        before = cursorSchema.parse(
          JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new AppError(422, "INVALID_CURSOR", "Invalid notification page");
      }
    }
    const size = Math.min(50, Math.max(1, limit));
    const result = await this.pool.query<{
      id: string;
      event_type: string;
      order_code: string;
      created_at: Date;
      read_at: Date | null;
    }>(
      `
      SELECT id::text,event_type,order_code,created_at,read_at FROM customer_notifications
       WHERE customer_user_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
      [userId, before?.at || null, before?.id || null, size + 1],
    );
    const unread = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text FROM customer_notifications WHERE customer_user_id=$1 AND read_at IS NULL",
      [userId],
    );
    const rows = result.rows.slice(0, size),
      last = rows.at(-1);
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        orderCode: row.order_code,
        ...messages[row.event_type],
        createdAt: row.created_at.toISOString(),
        readAt: row.read_at?.toISOString() || null,
      })),
      unreadCount: Number(unread.rows[0]?.count || 0),
      nextCursor:
        result.rows.length > size && last
          ? Buffer.from(
              JSON.stringify({
                at: last.created_at.toISOString(),
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  }

  public async markRead(
    userId: string,
    ids: string[],
  ): Promise<{ updated: number }> {
    // Only explicit visible IDs are marked; arrivals during this request stay unread.
    const result = await this.pool.query(
      `UPDATE customer_notifications SET read_at=COALESCE(read_at,now())
      WHERE customer_user_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL RETURNING id`,
      [userId, ids],
    );
    return { updated: result.rows.length };
  }

  public async subscriptions(userId: string, sessionId: string) {
    const result = await this.pool.query<{
      id: string;
      endpoint_hash: string;
      enabled: boolean;
    }>(
      `SELECT p.id::text,p.endpoint_hash,
      (p.active AND p.session_family_id=s.family_id AND p.vapid_fingerprint=$3 AND s.revoked_at IS NULL AND s.expires_at>now()
        AND s.user_session_version=u.session_version) AS enabled
      FROM web_push_subscriptions p JOIN users u ON u.id=p.customer_user_id JOIN sessions s ON s.id=$2 AND s.user_id=u.id
      WHERE p.customer_user_id=$1 ORDER BY p.updated_at DESC LIMIT 100`,
      [userId, sessionId, fingerprint(this.config.webPushVapidPublicKey || "")],
    );
    return {
      subscriptions: result.rows.map((row) => ({
        id: row.id,
        endpointHash: row.endpoint_hash,
        enabled: row.enabled,
      })),
    };
  }

  public async subscribe(
    userId: string,
    sessionId: string,
    subscription: BrowserPushSubscription,
    publicKey: string,
    requestId: string,
  ) {
    if (!this.pushConfig().configured)
      throw new AppError(
        503,
        "PUSH_UNAVAILABLE",
        "Browser notifications are not configured yet",
      );
    if (publicKey !== this.config.webPushVapidPublicKey)
      throw new AppError(
        409,
        "PUSH_KEY_CHANGED",
        "Reload the page before enabling browser notifications",
      );
    const parsed = pushSubscriptionSchema.parse(subscription);
    if (parsed.expirationTime && parsed.expirationTime <= Date.now())
      throw new AppError(
        422,
        "PUSH_EXPIRED",
        "This browser subscription has expired",
      );
    return this.transaction(async (client) => {
      // Serialize the per-account device cap and verify the session again at commit time.
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        userId,
      ]);
      const session = await client.query<{ family_id: string }>(
        `SELECT s.family_id::text FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
          AND s.user_session_version=u.session_version AND u.status='active' AND u.deleted_at IS NULL FOR SHARE OF s`,
        [sessionId, userId],
      );
      if (!session.rows.length)
        throw new AppError(
          401,
          "SESSION_INVALID",
          "Sign in again to enable browser notifications",
        );
      const familyId = session.rows[0]!.family_id;
      const endpointHash = fingerprint(parsed.endpoint);
      const credentialsHash = fingerprint(JSON.stringify(parsed));
      const existing = await client.query<{
        id: string;
        customer_user_id: string;
        session_family_id: string;
        active: boolean;
        credentials_fingerprint: string;
        vapid_fingerprint: string;
      }>(
        "SELECT id::text,customer_user_id::text,session_family_id::text,active,credentials_fingerprint,vapid_fingerprint FROM web_push_subscriptions WHERE endpoint_hash=$1 FOR UPDATE",
        [endpointHash],
      );
      if (existing.rows[0] && existing.rows[0].customer_user_id !== userId)
        throw new AppError(
          409,
          "PUSH_BROWSER_IN_USE",
          "Reset this browser subscription before enabling notifications",
        );
      const prior = existing.rows[0];
      if (
        prior?.active &&
        prior.session_family_id === familyId &&
        prior.credentials_fingerprint === credentialsHash &&
        prior.vapid_fingerprint === fingerprint(publicKey)
      )
        return { id: prior.id, enabled: true };
      // Clear consent from ended sessions; queued versions will fail their dispatch check.
      await client.query(
        `UPDATE web_push_subscriptions p SET active=false,version=version+1,disabled_reason='session_ended',updated_at=now()
        WHERE p.customer_user_id=$1 AND p.active AND NOT EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.family_id=p.session_family_id AND s.user_id=p.customer_user_id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version)`,
        [userId],
      );
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text FROM web_push_subscriptions WHERE customer_user_id=$1 AND active AND endpoint_hash<>$2",
        [userId, endpointHash],
      );
      if (Number(count.rows[0]?.count || 0) >= 10)
        throw new AppError(
          409,
          "PUSH_DEVICE_LIMIT",
          "The browser notification device limit has been reached",
        );
      const result = await client.query<{ id: string }>(
        `INSERT INTO web_push_subscriptions
        (customer_user_id,session_family_id,endpoint_hash,encrypted_subscription,vapid_fingerprint,credentials_fingerprint)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(endpoint_hash) DO UPDATE SET session_family_id=EXCLUDED.session_family_id,
          encrypted_subscription=EXCLUDED.encrypted_subscription,vapid_fingerprint=EXCLUDED.vapid_fingerprint,credentials_fingerprint=EXCLUDED.credentials_fingerprint,
          active=true,disabled_reason=NULL,version=web_push_subscriptions.version+1,updated_at=now()
        WHERE web_push_subscriptions.customer_user_id=EXCLUDED.customer_user_id RETURNING id::text`,
        [
          userId,
          familyId,
          endpointHash,
          encryptSecret(JSON.stringify(parsed), this.config.mfaEncryptionKey),
          fingerprint(publicKey),
          credentialsHash,
        ],
      );
      if (!result.rows[0])
        throw new AppError(
          409,
          "PUSH_BROWSER_IN_USE",
          "Reset this browser subscription before enabling notifications",
        );
      await this.audit(
        client,
        userId,
        result.rows[0].id,
        "WEB_PUSH_ENABLED",
        requestId,
        prior?.active ?? false,
      );
      return { id: result.rows[0].id, enabled: true };
    });
  }

  public async unsubscribe(
    userId: string,
    id: string,
    requestId: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE web_push_subscriptions SET active=false,version=version+1,
        disabled_reason='customer_opt_out',updated_at=now() WHERE id=$1 AND customer_user_id=$2 AND active RETURNING id`,
        [id, userId],
      );
      if (result.rows.length)
        await this.audit(client, userId, id, "WEB_PUSH_DISABLED", requestId);
    });
  }

  private async audit(
    client: PoolClient,
    userId: string,
    id: string,
    action: string,
    requestId: string,
    oldActive = true,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,old_values,new_values)
      VALUES('customer',$1,$2,'web_push_subscriptions',$3,$4,$5::jsonb,$6::jsonb)`,
      [
        userId,
        action,
        id,
        requestId,
        JSON.stringify({ enabled: oldActive }),
        JSON.stringify({ enabled: action === "WEB_PUSH_ENABLED" }),
      ],
    );
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
