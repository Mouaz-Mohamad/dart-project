// DART CODE GUIDE | backend/src/modules/notifications/admin-push-dispatch.ts
// Revalidate staff role, effective permissions and session immediately before a generic lockscreen alert.
import type { Pool } from "pg";
import { z } from "zod";
import { decryptSecret } from "../../security/crypto.js";
import { effectivePermissionsForUser } from "../identity/effective-permissions.js";
import { allowedAdminEvents, type AdminNotificationEvent } from "./admin-notification.queue.js";
import { fingerprint,pushSubscriptionSchema } from "./push-validation.js";
import { PushDeliveryError, type WebPushProvider } from "./web-push-provider.js";
const schema=z.object({notificationId:z.string().uuid(),subscriptionId:z.string().uuid(),subscriptionVersion:z.number().int().positive()});
export async function deliverAdminPush(pool: Pool,encryptionKey: Buffer,provider: WebPushProvider|null,payload:Record<string,unknown>):Promise<{suppressed?:boolean}> {
  const input=schema.safeParse(payload);
  if(!input.success)throw new PushDeliveryError("terminal","Invalid staff push identifiers");
  const {notificationId,subscriptionId,subscriptionVersion}=input.data;
  const result=await pool.query<{customer_user_id:string;event_type:AdminNotificationEvent;encrypted_subscription:Buffer;vapid_fingerprint:string}>(
    `SELECT p.customer_user_id::text,n.event_type,p.encrypted_subscription,p.vapid_fingerprint FROM admin_notifications n
     JOIN admin_push_subscriptions p ON p.id=$2 JOIN users u ON u.id=p.customer_user_id JOIN staff_users staff ON staff.user_id=u.id
     WHERE n.id=$1 AND p.version=$3 AND p.active AND n.created_at>now()-interval '24 hours'
       AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL
       AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.family_id=p.session_family_id
         AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version
         AND (NOT staff.mfa_required OR s.mfa_verified_at IS NOT NULL))
       AND NOT EXISTS(SELECT 1 FROM admin_notification_reads r WHERE r.user_id=u.id AND r.notification_id=n.id)`,
    [notificationId,subscriptionId,subscriptionVersion]);
  const row=result.rows[0];
  if(!row||!allowedAdminEvents(await effectivePermissionsForUser(row.customer_user_id,pool)).includes(row.event_type))return {suppressed:true};
  if(!provider?.configured())throw new PushDeliveryError("retryable","Browser notification delivery is not configured");
  if(row.vapid_fingerprint!==fingerprint(provider.publicKey()))return disable("key_changed");
  let subscription;
  try {subscription=pushSubscriptionSchema.parse(JSON.parse(decryptSecret(Buffer.from(row.encrypted_subscription),encryptionKey)));}
  catch {throw new PushDeliveryError("terminal","Stored staff subscription requires renewal");}
  if(subscription.expirationTime&&subscription.expirationTime<=Date.now())return disable("expired");
  const outcome=await provider.send(subscription,JSON.stringify({notificationId,eventType:row.event_type}),fingerprint(notificationId).slice(0,32));
  if(outcome==="expired")return disable("provider_expired");
  return {};
  async function disable(reason:string){
    await pool.query(`UPDATE admin_push_subscriptions SET active=false,version=version+1,disabled_reason=$3,updated_at=now() WHERE id=$1 AND version=$2`,[subscriptionId,subscriptionVersion,reason]);
    return {suppressed:true};
  }
}
