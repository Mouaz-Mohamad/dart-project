// DART EYE / Session boundaries.
// Customer and Staff logins are independent browser sessions, even on the same origin.
// Staff credentials never fall back to the customer cookie.
export const STAFF_CSRF_COOKIE_NAME = "dart_staff_csrf";

export function staffSessionCookieName(customerSessionCookieName: string): string {
  return `${customerSessionCookieName}_staff`;
}

export function isStaffApiRequest(originalUrl: string): boolean {
  return /^\/api\/v1\/admin(?:\/|\?|$)/i.test(originalUrl);
}
