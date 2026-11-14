// DART CODE GUIDE | backend/src/security/guest-cart-owner.ts
// الغرض: اشتقاق هوية ملكية سلة الضيف بشكل موحد بين Commerce وAnalytics بدون تخزين التوكن الخام.
import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../http/app-error.js";

export const GUEST_CART_COOKIE = "dart_guest_cart";

// A non-simple header forces cross-origin browsers through the application's
// existing origin allowlist before a cookie-authorized cart write can run.
export const guestCartWrite: RequestHandler = (request, _response, next) => {
  if (request.get("X-Dart-Guest-Cart") !== "1") {
    next(new AppError(403, "GUEST_CART_REQUEST_INVALID", "Reload your cart and try again"));
    return;
  }
  next();
};

export function hashGuestCartToken(token: unknown, authPepper: string): string | null {
  const value = typeof token === "string" ? token.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(value)) return null;
  return createHmac("sha256", authPepper)
    .update(`guest-cart:${value}`)
    .digest("hex");
}
