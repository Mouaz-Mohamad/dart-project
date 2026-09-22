// DART CODE GUIDE | Js/dart-site-settings.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-site-settings.js
// Public site settings cache, live refresh, and template propagation.
// BEGIN MODULE

/* ========================================================================== */
/* DART SITE SETTINGS — browser repository prepared for a future backend API  */
/* ========================================================================== */
(function (root) {
  "use strict";

  const STORAGE_KEY = "dart_site_settings";
  const PUBLIC_CACHE_KEY = "dart_public_site_settings_v2";
  const API_BASE = String(root.DART_API_BASE_URL || root.location?.origin || "").replace(/\/$/, "");
  const IS_ADMIN = /\/Eye\//i.test(root.location?.pathname || "");
  let serverVersion = 0;
  let cachedSettings = null;
  let syncTimer = 0;
  let publicSettingsEtag = "";
  let lastSettingsCheckAt = 0;
  const SETTINGS_POLL_MS = 60_000;
  const defaults = Object.freeze({
    version: 1,
    heroDayImage: null,
    heroNightImage: null,
    founderImage: null,
    defaultMarkupPercent: 50,
    courierFeePerOrder: 100,
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
      courierFeePerOrder: number(
        value.courierFeePerOrder ?? value.deliveryCostPerPiece,
        defaults.courierFeePerOrder,
        0,
        1000000,
      ),
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
    try {
      const cached = JSON.parse(root.localStorage?.getItem(PUBLIC_CACHE_KEY) || "null");
      if (cached && typeof cached === "object") return cached;
    } catch {
      try { root.localStorage?.removeItem(PUBLIC_CACHE_KEY); } catch {}
    }
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
    if (persist) {
      root.DartState?.write?.(STORAGE_KEY, normalized, { source: "site-settings" });
      try { root.localStorage?.setItem(PUBLIC_CACHE_KEY, JSON.stringify(normalized)); } catch {}
    }
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
        ...(options.headers || {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
          ? { "X-CSRF-Token": decodeURIComponent(csrf) }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 304) {
      lastSettingsCheckAt = Date.now();
      return { notModified: true, etag: response.headers.get("etag") || publicSettingsEtag };
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Site settings request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    lastSettingsCheckAt = Date.now();
    const etag = response.headers.get("etag");
    if (etag) publicSettingsEtag = etag;
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
    const payload = await api("/api/v1/site-settings", {
      headers: publicSettingsEtag ? { "If-None-Match": publicSettingsEtag } : {},
    });
    if (payload?.notModified) return get();
    serverVersion = Number(payload.version || 1);
    return setCache(payload.settings || {});
  }

  async function checkForChanges() {
    if (!API_BASE || root.document?.hidden) return;
    if (Date.now() - lastSettingsCheckAt < SETTINGS_POLL_MS) return;
    try {
      const payload = await api("/api/v1/site-settings", {
        headers: publicSettingsEtag ? { "If-None-Match": publicSettingsEtag } : {},
      });
      if (payload?.notModified) return;
      const remoteVersion = Number(payload.version || 0);
      if (remoteVersion && remoteVersion !== serverVersion) {
        serverVersion = remoteVersion;
        setCache(payload.settings || {});
      }
    } catch (error) {
      if (error.status !== 401)
        console.warn("Dart site settings live refresh failed", error);
    }
  }

  function cairoParts(value = new Date()) {
    try {
      return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(value).filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]));
    } catch {
      return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(), hour: value.getHours() };
    }
  }

  function cairoDateKey(value = new Date()) {
    const parts = cairoParts(value);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function activeSiteDiscount(value = new Date(), settings = get()) {
    const discount = settings.siteDiscount || {};
    const percent = number(discount.percent, 0, 0, 100);
    const today = cairoDateKey(value);
    if (!discount.enabled || !percent) return null;
    if (discount.startsAt && today < discount.startsAt) return null;
    if (discount.endsAt && today > discount.endsAt) return null;
    return { type: "Site", percent, startsAt: discount.startsAt || "", endsAt: discount.endsAt || "" };
  }

  function activeAnnouncements(value = new Date(), settings = get()) {
    const today = cairoDateKey(value);
    return settings.announcements
      .filter((row) => row && row.enabled !== false && String(row.text || "").trim())
      .filter((row) => (!row.startsAt || row.startsAt <= today) && (!row.endsAt || row.endsAt >= today))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function visibleColors(modelId, colors, settings = get()) {
    const all = Array.isArray(colors) ? colors : [];
    const rule = settings.modelCards?.[modelId] || { mode: "all" };
    if (rule.mode === "custom") {
      const chosen = new Set((rule.colors || []).map(String));
      const filtered = all.filter((color) => chosen.has(String(color.name)));
      return filtered.length ? filtered : all.slice(0, 1);
    }
    if (rule.mode === "one") return all.slice(0, 1);
    if (rule.mode === "two") return all.slice(0, 2);
    if (rule.mode === "count") return all.slice(0, Math.max(1, Number(rule.count) || 1));
    return all;
  }

  async function resolveImage(asset, fallback) {
    if (!asset) return fallback;
    try {
      await root.DartCatalog?.loadImage?.(asset);
      return root.DartCatalog?.imageSrc?.(asset) || fallback;
    } catch {
      return fallback;
    }
  }

  async function applyPublicMedia() {
    const settings = get();
    const hero = root.document?.querySelector(".hero > img[data-dart-hero]");
    if (hero) {
      const isDay = cairoParts().hour >= 6 && cairoParts().hour < 18;
      const selected = isDay
        ? settings.heroDayImage || settings.heroNightImage
        : settings.heroNightImage || settings.heroDayImage;
      hero.dataset.dartMediaReady = "false";
      hero.src = await resolveImage(
        selected,
        hero.getAttribute("src") || "/Photos/hero 2.png",
      );
      hero.dataset.timeMode = isDay ? "day" : "night";
      hero.dataset.dartMediaReady = "true";
    }
    const founder = root.document?.getElementById("dart-founder-image");
    if (founder && settings.founderImage)
      founder.src = await resolveImage(settings.founderImage, founder.getAttribute("src") || "/Photos/me.png");
  }

  const siteSettingsApi = {
    STORAGE_KEY, defaults, get, save, hydrate, sync, checkForChanges,
    serverVersion: () => serverVersion,
    cairoParts, cairoDateKey, activeSiteDiscount, activeAnnouncements,
    visibleColors, applyPublicMedia, number, heroWordSize,
  };

  root.DartSiteSettings = siteSettingsApi;
  if (typeof module !== "undefined" && module.exports) module.exports = siteSettingsApi;

  if (!root.document) return;
  root.document.addEventListener("DOMContentLoaded", () => {
    let hasCachedPublicSettings = false;
    try {
      hasCachedPublicSettings = Boolean(root.localStorage?.getItem(PUBLIC_CACHE_KEY));
    } catch {}
    const hero = root.document?.querySelector(".hero > img[data-dart-hero]");
    if (hasCachedPublicSettings) {
      void applyPublicMedia();
    } else if (hero) {
      // On a brand-new browser, keep the default hero hidden until the
      // authoritative site settings arrive. This prevents old/default media flash.
      hero.dataset.dartMediaReady = "false";
    }
    hydrate()
      .then(applyPublicMedia)
      .catch((error) => {
        // If the settings API is genuinely unavailable, reveal the local fallback
        // instead of leaving the hero blank indefinitely.
        if (hero) hero.dataset.dartMediaReady = "true";
        if (error.status !== 401) {
          root.dispatchEvent?.(
            new CustomEvent("dart:site-settings-unavailable", {
              detail: { code: error?.code || "SITE_SETTINGS_UNAVAILABLE" },
            }),
          );
        }
      });
  });
  root.document.addEventListener("dart:section-loaded", applyPublicMedia);
  root.document.addEventListener("dart:sections-loaded", applyPublicMedia);
  root.addEventListener("dart:site-settings-changed", applyPublicMedia);
  root.addEventListener("focus", checkForChanges);
  root.document.addEventListener("visibilitychange", () => {
    if (!root.document.hidden) checkForChanges();
  });
  root.setInterval?.(checkForChanges, SETTINGS_POLL_MS);
})(typeof window !== "undefined" ? window : globalThis);


// END MODULE
