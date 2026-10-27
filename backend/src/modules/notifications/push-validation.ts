// DART CODE GUIDE | backend/src/modules/notifications/push-validation.ts
// Validate browser push credentials before storing or sending to a trusted provider.
import { createECDH, createHash, ECDH } from "node:crypto";
import { z } from "zod";

function base64Key(value: string, length: number): boolean {
  return (
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, "base64url").length === length &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

export function trustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted =
      host === "fcm.googleapis.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".push.apple.com");
    return (
      trusted &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      url.pathname !== "/" &&
      value.length <= 2048
    );
  } catch {
    return false;
  }
}

function publicKey(value: string): boolean {
  if (!base64Key(value, 65) || Buffer.from(value, "base64url")[0] !== 4)
    return false;
  try {
    ECDH.convertKey(Buffer.from(value, "base64url"), "prime256v1");
    return true;
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(trustedPushEndpoint, "Unsupported push endpoint"),
    expirationTime: z.number().int().positive().nullable().optional(),
    keys: z
      .object({
        p256dh: z
          .string()
          .max(100)
          .refine(publicKey, "Invalid push public key"),
        auth: z
          .string()
          .max(30)
          .refine((value) => base64Key(value, 16), "Invalid push auth key"),
      })
      .strict(),
  })
  .strict();
export type BrowserPushSubscription = z.infer<typeof pushSubscriptionSchema>;
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validVapidKeys(
  publicValue: string,
  privateValue: string,
): boolean {
  if (!publicKey(publicValue) || !base64Key(privateValue, 32)) return false;
  try {
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(Buffer.from(privateValue, "base64url"));
    return curve.getPublicKey().toString("base64url") === publicValue;
  } catch {
    return false;
  }
}
