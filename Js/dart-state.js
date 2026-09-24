// DART CODE GUIDE | Js/dart-state.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-state.js
// Small browser-state compatibility adapter; never the production business authority.
// BEGIN MODULE

/* DART DATABASE-FIRST RUNTIME STATE
 * Business data lives in PostgreSQL. This file is an in-memory projection only.
 */
(function (root) {
  "use strict";
  const BUSINESS_KEYS = new Set([
    "dart_models","dart_items","dart_customers","dart_orders","dart_returns",
    "dart_reviews","dart_cards","dart_representatives","dart_damage",
    "dart_notifications","dart_contact_messages","dart_birthday_rewards",
    "dart_birthday_messages","dart_message_queue","dart_promotions",
    "dart_finance_expenses","dart_finance_budgets","dart_finance_invoices",
    "dart_finance_goals","dart_finance_marketing","dart_finance_cod_settlements",
    "dart_finance_audit","dart_draw_eligibility_audit","dart_audit",
    "dart_users","dart_password_reset_requests","dart_platform_counters",
    "dart_rep_session","dart_cart","user_last_address","dart_site_settings"
  ]);
  const values = new Map();
  const revisions = new Map();
  let sequence = 0;

  function emit(key, value, source = "memory") {
    sequence += 1;
    revisions.set(key, sequence);
    root.dispatchEvent?.(new CustomEvent("dart:data-changed", {
      detail: { key, value, source, revision: sequence }
    }));
  }
  function clone(value) {
    if (typeof root.structuredClone === "function") return root.structuredClone(value);
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }
  function read(key, fallback = null) {
    return values.has(key) ? values.get(key) : fallback;
  }
  function write(key, value, options = {}) {
    values.set(key, value);
    if (options.emit !== false) emit(key, value, options.source || "memory");
    return value;
  }
  function purgeLegacyBrowserBusinessData() {
    const marker = "dart_database_only_migration_v1";
    try {
      if (root.localStorage?.getItem(marker) === "1") return;
      for (const key of BUSINESS_KEYS) root.localStorage?.removeItem(key);
      root.localStorage?.removeItem("dart_csrf_token");
      if (root.indexedDB) root.indexedDB.deleteDatabase("dart-catalog-media-v7");
      root.localStorage?.setItem(marker, "1");
    } catch {}
  }
  function purgeStaleNavbarFragment() {
    const marker = "dart_navbar_asset_restore_ad1a226_v1";
    try {
      if (root.localStorage?.getItem(marker) === "1") return;
      const staleKeys = [];
      for (let index = 0; index < root.localStorage.length; index += 1) {
        const key = root.localStorage.key(index);
        if (key && key.startsWith("dart_fragment_") && key.includes("Nav-Bar.html")) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach((key) => root.localStorage.removeItem(key));
      root.localStorage?.setItem(marker, "1");
    } catch {}
  }

  function loadProductButtonStateWhenNeeded() {
    const document = root.document;
    if (!document?.getElementById?.("SectionModel")) return;
    if (root.DartProductButtonState?.sync) {
      root.DartProductButtonState.sync();
      return;
    }
    if (document.querySelector?.('script[data-dart-product-button-state="1"]')) return;
    const script = document.createElement("script");
    script.src = "/Js/dart-product-button-state.js?v=20260924-single-action-v4";
    script.async = false;
    script.dataset.dartProductButtonState = "1";
    script.addEventListener("load", () => root.DartProductButtonState?.sync?.(), { once: true });
    script.addEventListener("error", () => {
      console.error("Dart product button-state controller failed to load.");
    }, { once: true });
    document.head?.appendChild(script);
  }

  function scheduleProductButtonState() {
    const document = root.document;
    if (!document) return;
    if (document.readyState === "loading" || document.readyState === "interactive") {
      document.addEventListener("DOMContentLoaded", loadProductButtonStateWhenNeeded, { once: true });
      return;
    }
    loadProductButtonStateWhenNeeded();
  }

  function loadCheckoutStabilityWhenNeeded() {
    const document = root.document;
    if (!document?.getElementById?.("checkoutForm")) return;
    if (document.querySelector?.('script[data-dart-checkout-stability="1"]')) return;
    const script = document.createElement("script");
    script.src = "/Js/dart-checkout-stability.js?v=20260924-mobile-checkout-v1";
    script.async = false;
    script.dataset.dartCheckoutStability = "1";
    script.addEventListener("error", () => {
      console.error("Dart checkout stability controller failed to load.");
    }, { once: true });
    document.head?.appendChild(script);
  }

  function scheduleCheckoutStability() {
    const document = root.document;
    if (!document) return;
    if (document.readyState === "loading" || document.readyState === "interactive") {
      document.addEventListener("DOMContentLoaded", loadCheckoutStabilityWhenNeeded, { once: true });
      return;
    }
    loadCheckoutStabilityWhenNeeded();
  }

  purgeLegacyBrowserBusinessData();
  purgeStaleNavbarFragment();
  root.DartState = Object.freeze({ read, write, clone });
  scheduleProductButtonState();
  scheduleCheckoutStability();
})(typeof window !== "undefined" ? window : globalThis);


// END MODULE
