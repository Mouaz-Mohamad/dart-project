  "use strict";

  const KEYS = Object.freeze({
    users: "dart_users",
    session: "dart_session",
    customers: "dart_customers",
    models: "dart_models",
    items: "dart_items",
    orders: "dart_orders",
    returns: "dart_returns",
    reviews: "dart_reviews",
    contacts: "dart_contact_messages",
    audit: "dart_audit",
    notifications: "dart_notifications",
    counters: "dart_platform_counters",
    catalogSeed: "dart_catalog_seed_v4",
    resetMarker: "dart_demo_reset_2026_09_05",
    passwordResets: "dart_password_reset_requests",
    representatives: "dart_representatives",
    repSession: "dart_rep_session",
    cards: "dart_cards",
    birthdayRewards: "dart_birthday_rewards",
    birthdayMessages: "dart_birthday_messages",
  });
  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const API_USER_CACHE_KEY = "dart_api_user_cache";
  const CART_UI_CACHE_KEY = "dart_cart_ui_cache_v1";
  let checkoutSubmissionBusy = false;
  let serverReviewEligible = null;
  let serverPurchaseStats = null;
  let waitingEntriesCache = [];
  let waitingPromise = null;
  let customerCommercePromise = null;
  let customerCommerceGeneration = 0;
  const API_REQUIRED =
    location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname);
  let apiUserCache = null;
  try {
    sessionStorage.removeItem(API_USER_CACHE_KEY);
    sessionStorage.removeItem(CART_UI_CACHE_KEY);
  } catch {}
  const CART_RESERVATION_MS = 15 * 60 * 1000;
  const configuredBirthdayPercent = Number(
    window.DartSiteSettings?.get?.().birthdayDiscountPercent,
  );
  const BIRTHDAY_DISCOUNT_PERCENT = Math.max(
    0,
    Math.min(100, Number.isFinite(configuredBirthdayPercent) ? configuredBirthdayPercent : 30),
  );
  const BIRTHDAY_REWARD_DAYS = 7;
  const CAIRO_TIME_ZONE = "Africa/Cairo";

  const read = (key, fallback) => window.DartState?.read?.(key, fallback) ?? fallback;
  const write = (key, value) => {
    window.DartState?.write?.(key, value, { source: "platform" });
    if (
      [
        KEYS.items,
        KEYS.models,
        KEYS.orders,
        KEYS.returns,
        KEYS.customers,
        KEYS.cards,
      ].includes(key)
    )
      window.dispatchEvent(
        new CustomEvent("dart:data-changed", { detail: { key } }),
      );
  };
  const now = () => new Date().toISOString();
  const uid = (prefix) => {
    const randomPart =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint32Array(4)))
            .map((value) => value.toString(36))
            .join("-");
    return `${prefix}-${randomPart}`;
  };
  let CART_RESERVATION_ID =
    sessionStorage.getItem("dart_cart_reservation_id") || uid("CART");
  sessionStorage.setItem("dart_cart_reservation_id", CART_RESERVATION_ID);

