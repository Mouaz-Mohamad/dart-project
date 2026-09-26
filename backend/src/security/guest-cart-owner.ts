// DART CODE GUIDE | backend/src/security/guest-cart-owner.ts
// الغرض: اشتقاق هوية ملكية سلة الضيف بشكل موحد بين Commerce وAnalytics بدون تخزين التوكن الخام.
import { createHmac } from "node:crypto";

export const GUEST_CART_COOKIE = "dart_guest_cart";

export function hashGuestCartToken(token: unknown, authPepper: string): string | null {
  const value = typeof token === "string" ? token.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(value)) return null;
  return createHmac("sha256", authPepper)
    .update(`guest-cart:${value}`)
    .digest("hex");
}
