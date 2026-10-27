// DART CODE GUIDE | backend/src/modules/notifications/push-dispatch.ts
// Re-check consent, owner, session and key version immediately before delivery.
import type { Pool } from "pg";
import { z } from "zod";
import { decryptSecret } from "../../security/crypto.js";
import { fingerprint, pushSubscriptionSchema } from "./push-validation.js";
import {
  PushDeliveryError,
  type WebPushProvider,
} from "./web-push-provider.js";

const deliverySchema = z.object({
  notificationId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  subscriptionVersion: z.number().int().positive(),
});
export async function deliverWebPush(
  pool: Pool,
  encryptionKey: Buffer,
  provider: WebPushProvider | null,
  payload: Record<string, unknown>,
): Promise<{ suppressed?: boolean }> {
  const input = deliverySchema.safeParse(payload);
  if (!input.success)
    throw new PushDeliveryError(
      "terminal",
      "Push event has invalid delivery identifiers",
    );
  const { notificationId, subscriptionId, subscriptionVersion } = input.data;
  const result = await pool.query<{
    encrypted_subscription: Buffer;
    vapid_fingerprint: string;
  }>(
    `SELECT p.encrypted_subscription,p.vapid_fingerprint
    FROM customer_notifications n JOIN web_push_subscriptions p ON p.customer_user_id=n.customer_user_id
    JOIN users u ON u.id=p.customer_user_id
    JOIN orders o ON o.id=n.order_id AND o.customer_user_id=n.customer_user_id
    WHERE n.id=$1 AND p.id=$2 AND p.version=$3 AND p.active
      AND n.created_at>now()-interval '24 hours'
      AND u.status='active' AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.family_id=p.session_family_id AND s.user_id=u.id
        AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version)
      AND o.status NOT IN ('Cancelled','Refused','Returned')
      AND (n.event_type<>'ORDER_OUT_FOR_DELIVERY' OR o.status='Representative On The Way')`,
    [notificationId, subscriptionId, subscriptionVersion],
  );
  const row = result.rows[0];
  if (!row) return { suppressed: true };
  if (!provider?.configured())
    throw new PushDeliveryError(
      "retryable",
      "Browser notification delivery is not configured",
    );
  if (row.vapid_fingerprint !== fingerprint(provider.publicKey())) {
    await disable("key_changed");
    return { suppressed: true };
  }
  let subscription;
  try {
    subscription = pushSubscriptionSchema.parse(
      JSON.parse(
        decryptSecret(Buffer.from(row.encrypted_subscription), encryptionKey),
      ),
    );
  } catch {
    throw new PushDeliveryError(
      "terminal",
      "Stored push subscription requires renewal",
    );
  }
  if (
    subscription.expirationTime &&
    subscription.expirationTime <= Date.now()
  ) {
    await disable("expired");
    return { suppressed: true };
  }
  // Lockscreen payload intentionally contains no contact details, order code or amount.
  const outcome = await provider.send(
    subscription,
    JSON.stringify({ notificationId }),
    fingerprint(notificationId).slice(0, 32),
  );
  if (outcome === "expired") {
    await disable("provider_expired");
    return { suppressed: true };
  }
  return {};

  async function disable(reason: string) {
    await pool.query(
      `UPDATE web_push_subscriptions SET active=false,version=version+1,disabled_reason=$3,updated_at=now()
      WHERE id=$1 AND version=$2`,
      [subscriptionId, subscriptionVersion, reason],
    );
  }
}
