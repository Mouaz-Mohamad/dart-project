/* ========================================================================== */
/* DART SITE SETTINGS — browser repository prepared for a future backend API  */
/* ========================================================================== */
(function (root) {
  "use strict";

  const STORAGE_KEY = "dart_site_settings";
  const API_BASE = String(root.DART_API_BASE_URL || root.location?.origin || "").replace(/\/$/, "");
  const IS_ADMIN = /\/Eye\//i.test(root.location?.pathname || "");
  const CSRF_STORAGE_KEY = "dart_csrf_token";
  const LEGACY_MIGRATION_KEY = "dart_site_settings_server_migration_v1";
  let serverVersion = 0;
  let cachedSettings = null;
  let syncTimer = 0;
  const defaults = Object.freeze({
    version: 1,
    heroDayImage: null,
    heroNightImage: null,
    founderImage: null,
    defaultMarkupPercent: 50,
    deliveryCostPerPiece: 100,
    birthdayDiscountPercent: 30,
    dartCardDiscountPercent: 40,
    refundCustomerFee: 100,
    repeatExchangeCustomerFee: 50,
    siteDiscount: { enabled: false, percent: 0, startsAt: "", endsAt: "" },
    announcements: [],
    modelCards: {},
    typing: {
      typingSpeed: 70,
      deletingSpeed: 10,
      wordDelay: 100,
      nextSceneDelay: 400,
      scenes: [
        { hold: 2000, words: [{ text: "Dart |", color: "#AB012B", size: 50, weight: 600 }, { text: "For You", color: "#ffffff", size: 50, weight: 400 }] },
        { hold: 2000, words: [{ text: "Delivered Fast", color: "#ffffff", size: 35, weight: 400 }, { text: "up to", color: "#ffffff", size: 35, weight: 400 }, { text: "12h.", color: "#AB012B", size: 50, weight: 600 }] },
        { hold: 2500, words: [{ text: "30%", color: "#AB012B", size: 40, weight: 700 }, { text: "birthday", color: "#ffffff", size: 30, weight: 500 }, { text: "discount.", color: "#ffffff", size: 30, weight: 800 }] },
        { hold: 2200, words: [{ text: "Easy", color: "#AB012B", size: 50, weight: 500 }, { text: "R&E", color: "#ffffff", size: 30, weight: 300 }] },
        { hold: 2200, words: [{ text: "Made", color: "#ffffff", size: 30, weight: 300 }, { text: "For You", color: "#AB012B", size: 40, weight: 500 }] },
      ],
    },
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function number(value, fallback, min = 0, max = 1000000) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function heroWordSize(value, fallback = 36) {
    const pixels = number(parseFloat(value), fallback, 10, 120);
    return `${pixels}px`;
  }

  function normalizeTypingScenes(scenes) {
    if (!Array.isArray(scenes) || !scenes.length) return clone(defaults.typing.scenes);
    const normalized = scenes
      .map((scene) => ({
        hold: number(scene?.hold, 2000, 0, 60000),
        words: (Array.isArray(scene?.words) ? scene.words : [])
          .map((word) => ({
            text: String(word?.text || "").trim(),
            color: String(word?.color || "#ffffff"),
            size: number(parseFloat(word?.size), 36, 10, 120),
            weight: number(word?.weight, 400, 100, 900),
          }))
          .filter((word) => word.text),
      }))
      .filter((scene) => scene.words.length);
    return normalized.length ? normalized : clone(defaults.typing.scenes);
  }

  function merge(raw = {}) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      ...clone(defaults),
      ...value,
      siteDiscount: { ...defaults.siteDiscount, ...(value.siteDiscount || {}) },
      typing: {
        ...clone(defaults.typing),
        ...(value.typing || {}),
        scenes: normalizeTypingScenes(value.typing?.scenes),
      },
      announcements: Array.isArray(value.announcements) ? value.announcements : [],
      modelCards: value.modelCards && typeof value.modelCards === "object" ? value.modelCards : {},
    };
  }

  function localRaw() {
    const value = root.DartState?.read?.(STORAGE_KEY, {});
    return value && typeof value === "object" ? value : {};
  }

  function announce(normalized) {
    root.dispatchEvent?.(new CustomEvent("dart:site-settings-changed", { detail: normalized }));
    root.dispatchEvent?.(new CustomEvent("dart:data-changed", { detail: { key: STORAGE_KEY } }));
  }

  function setCache(value, persist = true) {
    const normalized = merge(value);
    cachedSettings = normalized;
    if (persist) root.DartState?.write?.(STORAGE_KEY, normalized, { source: "site-settings" });
    announce(normalized);
    return normalized;
  }

  async function api(path, options = {}) {
    if (!API_BASE) throw new Error("Site settings API is not configured.");
    const method = String(options.method || "GET").toUpperCase();
    const cookieCsrf = root.document?.cookie
      ?.split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    const csrf = cookieCsrf;
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      method,
      headers: {
        "Content-Type": "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
          ? { "X-CSRF-Token": decodeURIComponent(csrf) }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Site settings request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  function get() {
    if (cachedSettings) return cachedSettings;
    cachedSettings = merge(localRaw());
    return cachedSettings;
  }

  async function sync() {
    if (!IS_ADMIN || !API_BASE || !serverVersion) return get();
    const payload = await api("/api/v1/admin/site-settings", {
      method: "PUT",
      body: { expectedVersion: serverVersion, settings: get() },
    });
    serverVersion = Number(payload.version || serverVersion);
    return setCache(payload.settings || get());
  }

  function scheduleSync() {
    if (!IS_ADMIN || !API_BASE) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void sync().catch(async (error) => {
        console.error("Dart site settings sync failed", error);
        if (error.status === 409) await hydrate(true).catch(() => {});
      });
    }, 150);
  }

  function save(value) {
    const normalized = setCache(value);
    scheduleSync();
    return normalized;
  }

  async function hydrate(_force = false) {
    if (!API_BASE) throw new Error("Site settings API is not configured.");
    const payload = await api("/api/v1/site-settings");
    serverVersion = Number(payload.version || 1);
    return setCache(payload.settings || {});
  }

  root.DartSiteSettings = siteSettingsApi;
  if (typeof module !== "undefined" && module.exports) module.exports = siteSettingsApi;

  if (!root.document) return;
  root.document.addEventListener("DOMContentLoaded", () => {
    applyPublicMedia();
    hydrate().then(applyPublicMedia).catch((error) => {
      if (error.status !== 401) console.warn("Dart site settings hydration failed", error);
    });
  });
  root.document.addEventListener("dart:sections-loaded", applyPublicMedia);
  root.addEventListener("dart:site-settings-changed", applyPublicMedia);
  root.addEventListener("focus", checkForChanges);
  root.document.addEventListener("visibilitychange", () => {
    if (!root.document.hidden) checkForChanges();
  });
  root.setInterval?.(checkForChanges, 5000);
})(typeof window !== "undefined" ? window : globalThis);
