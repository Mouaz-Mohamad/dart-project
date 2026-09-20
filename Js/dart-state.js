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
  function read(key, fallback = null) {
    return values.has(key) ? values.get(key) : fallback;
  }
  function write(key, value, options = {}) {
    values.set(key, value);
    if (options.emit !== false) emit(key, value, options.source || "memory");
    return value;
  }
  function remove(key, options = {}) {
    const existed = values.delete(key);
    if (existed && options.emit !== false) emit(key, undefined, options.source || "memory");
    return existed;
  }
  function clearBusiness(options = {}) {
    for (const key of BUSINESS_KEYS) values.delete(key);
    if (options.emit !== false) root.dispatchEvent?.(new CustomEvent("dart:business-state-cleared"));
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
  purgeLegacyBrowserBusinessData();
  root.DartState = Object.freeze({
    read, write, remove, clearBusiness, purgeLegacyBrowserBusinessData,
    has: (key) => values.has(key),
    revision: (key) => revisions.get(key) || 0,
    isBusinessKey: (key) => BUSINESS_KEYS.has(key),
    keys: () => [...values.keys()],
  });
})(typeof window !== "undefined" ? window : globalThis);
