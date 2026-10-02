// DART CODE GUIDE | Js/dart-site-settings.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-site-settings.js
// Public runtime settings shared between dashboard controls and storefront rendering.
// BEGIN MODULE

(function (root) {
  "use strict";

  const LOCAL_KEY = "dart_public_site_settings_v2";
  const API_BASE = String(root.DART_API_BASE_URL || root.location?.origin || "").replace(/\/$/, "");
  const DEFAULTS = Object.freeze({
    heroImage: "/Photos/hero 1.webp",
    founderImage: "/Photos/me.png",
    founderName: "Mouaz Mohammed",
    birthdayDiscountPercent: 30,
    dartCardDiscountPercent: 40,
    waiting: { enabled: true, reservationHours: 24 },
    returns: { returnDays: 14, exchangeDays: 30 },
    delivery: { text: "Delivery within 12h" },
    liveChat: { enabled: false, whatsapp: "" },
    socials: { instagram: "", facebook: "", tiktok: "", whatsapp: "" },
    sizing: { heroWordScale: 1 },
    typing: {
      typingSpeed: 70,
      deletingSpeed: 10,
      wordDelay: 100,
      nextSceneDelay: 400,
      scenes: [],
    },
  });

  let current = null;
  let lastFingerprint = "";
  let hydratePromise = null;
  const SETTINGS_POLL_MS = 60_000;

  const clone = (value) => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  function merge(base, patch) {
    const out = { ...base };
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        base[key] &&
        typeof base[key] === "object" &&
        !Array.isArray(base[key])
      ) {
        out[key] = merge(base[key], value);
      } else if (value !== undefined) {
        out[key] = value;
      }
    });
    return out;
  }

  function normalize(value) {
    const merged = merge(DEFAULTS, value || {});
    merged.birthdayDiscountPercent = Math.max(0, Math.min(100, Number(merged.birthdayDiscountPercent) || 30));
    merged.dartCardDiscountPercent = Math.max(0, Math.min(100, Number(merged.dartCardDiscountPercent) || 40));
    merged.waiting.reservationHours = Math.max(1, Math.min(168, Number(merged.waiting.reservationHours) || 24));
    merged.returns.returnDays = Math.max(0, Math.min(365, Number(merged.returns.returnDays) || 14));
    merged.returns.exchangeDays = Math.max(0, Math.min(365, Number(merged.returns.exchangeDays) || 30));
    merged.sizing.heroWordScale = Math.max(0.5, Math.min(1.5, Number(merged.sizing.heroWordScale) || 1));
    merged.typing.typingSpeed = Math.max(10, Number(merged.typing.typingSpeed) || 70);
    merged.typing.deletingSpeed = Math.max(5, Number(merged.typing.deletingSpeed) || 10);
    merged.typing.wordDelay = Math.max(0, Number(merged.typing.wordDelay) || 100);
    merged.typing.nextSceneDelay = Math.max(0, Number(merged.typing.nextSceneDelay) || 400);
    merged.typing.scenes = Array.isArray(merged.typing.scenes) ? merged.typing.scenes : [];
    return merged;
  }

  function readLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
      return parsed && typeof parsed === "object" ? normalize(parsed) : normalize(DEFAULTS);
    } catch {
      localStorage.removeItem(LOCAL_KEY);
      return normalize(DEFAULTS);
    }
  }

  function saveLocal(value) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
    } catch {}
  }

  function fingerprint(value) {
    return JSON.stringify(value || {});
  }

  function emitIfChanged(next, source) {
    const normalized = normalize(next);
    const nextFingerprint = fingerprint(normalized);
    current = normalized;
    saveLocal(current);
    if (nextFingerprint === lastFingerprint) return current;
    lastFingerprint = nextFingerprint;
    root.dispatchEvent?.(
      new CustomEvent("dart:site-settings-changed", {
        detail: { settings: clone(current), source },
      }),
    );
    return current;
  }

  async function apiRequest(path, options = {}) {
    if (!API_BASE) throw new Error("Settings API is unavailable");
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      const error = new Error(`Settings request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function hydrate(force = false) {
    if (!API_BASE) return current;
    if (hydratePromise && !force) return hydratePromise;
    hydratePromise = apiRequest("/api/v1/settings/public")
      .then((payload) => emitIfChanged(payload?.settings || {}, "api"))
      .finally(() => {
        hydratePromise = null;
      });
    return hydratePromise;
  }

  function get() {
    return clone(current || DEFAULTS);
  }

  function heroWordSize(sizeValue, fallback = 60) {
    const numeric = Math.max(10, Number.parseFloat(sizeValue) || Number(fallback) || 60);
    return `${Math.round(numeric * Number(current?.sizing?.heroWordScale || 1))}px`;
  }

  function setImageSource(image, configuredSource, fallbackSource) {
    if (!image) return;
    const source = String(configuredSource || fallbackSource || "").trim();
    if (!source) return;
    if (image.dataset.dartConfiguredSrc !== source) {
      image.dataset.dartConfiguredSrc = source;
      image.src = source;
    }
    if (fallbackSource && !image.dataset.dartFallbackBound) {
      image.dataset.dartFallbackBound = "1";
      image.addEventListener("error", () => {
        const fallback = String(fallbackSource || "").trim();
        if (fallback && !image.src.endsWith(fallback)) image.src = fallback;
      });
    }
  }

  function firstExisting(selectors) {
    for (const selector of selectors) {
      const element = root.document?.querySelector?.(selector);
      if (element) return element;
    }
    return null;
  }

  function applySocialLinks(settings) {
    const links = [
      ["instagram", settings.socials?.instagram],
      ["facebook", settings.socials?.facebook],
      ["tiktok", settings.socials?.tiktok],
      ["whatsapp", settings.socials?.whatsapp],
    ];
    links.forEach(([name, href]) => {
      if (!href) return;
      root.document
        ?.querySelectorAll?.(`[data-social="${name}"], a[href*="${name === "whatsapp" ? "wa.me" : name}"]`)
        ?.forEach?.((link) => {
          link.href = href;
          if (link.target === "_blank") link.rel = "noopener noreferrer";
        });
    });
  }

  function applyPublicMedia() {
    const settings = current || DEFAULTS;
    const hero = firstExisting(["[data-dart-hero-image]", ".hero img"]);
    if (hero) {
      const configuredHero = String(settings.heroImage || "").trim();
      const fallbackHero = "/Photos/hero 1.webp";
      if (configuredHero) setImageSource(hero, configuredHero, fallbackHero);
      hero.dataset.dartMediaReady = "true";
    }

    const founder = firstExisting(["#dart-founder-image", "[data-dart-founder-image]"]);
    if (founder) setImageSource(founder, settings.founderImage, "/Photos/me.png");

    root.document
      ?.querySelectorAll?.("[data-birthday-discount-percent]")
      ?.forEach?.((element) => {
        element.textContent = String(Math.round(settings.birthdayDiscountPercent));
      });
    root.document
      ?.querySelectorAll?.("[data-dart-card-discount-percent]")
      ?.forEach?.((element) => {
        element.textContent = String(Math.round(settings.dartCardDiscountPercent));
      });
    root.document
      ?.querySelectorAll?.("[data-delivery-copy]")
      ?.forEach?.((element) => {
        element.textContent = String(settings.delivery?.text || DEFAULTS.delivery.text);
      });
    root.document
      ?.querySelectorAll?.("[data-founder-name]")
      ?.forEach?.((element) => {
        element.textContent = String(settings.founderName || DEFAULTS.founderName);
      });

    applySocialLinks(settings);
  }

  async function checkForChanges() {
    try {
      await hydrate(true);
    } catch {}
  }

  current = readLocal();
  lastFingerprint = fingerprint(current);

  root.DartSiteSettings = Object.freeze({
    get,
    hydrate,
    refresh: checkForChanges,
    heroWordSize,
  });

  root.addEventListener?.("DOMContentLoaded", () => {
    const hero = firstExisting(["[data-dart-hero-image]", ".hero img"]);
    const markHeroReady = () => {
      if (hero) hero.dataset.dartMediaReady = "true";
    };
    hydrate()
      .then(() => {
        applyPublicMedia();
        if (!hero) return;
        if (hero.complete && hero.naturalWidth > 0) markHeroReady();
        else {
          hero.addEventListener("load", markHeroReady, { once: true });
          hero.addEventListener("error", markHeroReady, { once: true });
          root.setTimeout(markHeroReady, 1200);
        }
      })
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
  root.document?.addEventListener?.("dart:section-loaded", applyPublicMedia);
  root.document?.addEventListener?.("dart:sections-loaded", applyPublicMedia);
  root.addEventListener?.("dart:site-settings-changed", applyPublicMedia);
  root.addEventListener?.("focus", checkForChanges);
  root.document?.addEventListener?.("visibilitychange", () => {
    if (!root.document.hidden) checkForChanges();
  });
  root.setInterval?.(checkForChanges, SETTINGS_POLL_MS);
})(typeof window !== "undefined" ? window : globalThis);


// END DART | MODULE: dart-site-settings.js
