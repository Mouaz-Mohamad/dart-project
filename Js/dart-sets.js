// DART CODE GUIDE | Js/dart-sets.js
// Shared lightweight browser client for Sets. PostgreSQL/Backend remain the source of truth.
(function (root) {
  "use strict";
  if (!root || root.DartSets) return;

  const DRAFT_KEY = "dart_cart_set_groups_v1";
  let catalog = [];
  let settings = { birthdayPercent: 10, dartCardPercent: 10, version: 1 };
  let loadedAt = 0;
  const CACHE_MS = 30_000;

  function apiBase() {
    return String(root.DART_API_BASE_URL || root.DartApi?.baseUrl || root.location?.origin || "").replace(/\/$/, "");
  }

  function csrfToken() {
    return root.document?.cookie
      ?.split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=") || "";
  }

  async function request(path, options = {}) {
    if (root.DartAdminApi?.request && /\/admin\//.test(path)) {
      return root.DartAdminApi.request(path, options);
    }
    if (root.DartPlatform?.apiRequest) {
      return root.DartPlatform.apiRequest(path, options);
    }
    const method = String(options.method || "GET").toUpperCase();
    const csrf = csrfToken();
    const response = await fetch(`${apiBase()}${path}`, {
      credentials: "include",
      cache: "no-store",
      method,
      headers: {
        Accept: "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "Content-Type": "application/json" } : {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
          ? { "X-CSRF-Token": decodeURIComponent(csrf) }
          : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Dart Sets request failed");
      error.status = response.status;
      error.code = payload?.error?.code || "SETS_REQUEST_FAILED";
      error.details = payload?.error?.details;
      throw error;
    }
    return payload;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readDrafts() {
    try {
      const value = JSON.parse(root.sessionStorage?.getItem(DRAFT_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      try { root.sessionStorage?.removeItem(DRAFT_KEY); } catch {}
      return [];
    }
  }

  function writeDrafts(groups) {
    const safe = Array.isArray(groups) ? clone(groups) : [];
    try { root.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(safe)); } catch {}
    root.dispatchEvent?.(new CustomEvent("dart:set-cart-draft-changed", { detail: { groups: safe } }));
    return safe;
  }

  function clearDrafts() {
    return writeDrafts([]);
  }

  function currentReservationId() {
    return String(
      root.DartPlatform?.cartReservationId ||
      root.sessionStorage?.getItem("dart_cart_reservation_id") ||
      "",
    ).trim();
  }

  function signedIn() {
    return Boolean(root.DartPlatform?.currentUser?.());
  }

  async function loadCatalog(force = false) {
    if (!force && catalog.length && Date.now() - loadedAt < CACHE_MS) return clone(catalog);
    const [setsPayload, settingsPayload] = await Promise.all([
      request("/api/v1/sets"),
      request("/api/v1/sets/settings"),
    ]);
    catalog = Array.isArray(setsPayload?.sets) ? setsPayload.sets : [];
    settings = settingsPayload?.settings || settings;
    loadedAt = Date.now();
    root.dispatchEvent?.(new CustomEvent("dart:sets-catalog-changed", { detail: { sets: clone(catalog), settings: clone(settings) } }));
    return clone(catalog);
  }

  async function detail(setId) {
    const payload = await request(`/api/v1/sets/${encodeURIComponent(String(setId || ""))}`);
    return payload?.set || null;
  }

  async function attachCartGroups(groups = readDrafts(), reservationId = currentReservationId()) {
    if (!reservationId) throw new Error("Cart reservation is not ready yet.");
    const path = signedIn() ? "/api/v1/me/cart/set-groups" : "/api/v1/cart/set-groups";
    const payload = await request(path, {
      method: "PUT",
      body: { reservationId, groups: Array.isArray(groups) ? groups : [] },
    });
    writeDrafts(payload?.groups || groups || []);
    return payload;
  }

  async function cartGroups(reservationId = currentReservationId()) {
    if (!reservationId) return [];
    const path = signedIn()
      ? `/api/v1/me/cart/set-groups?reservationId=${encodeURIComponent(reservationId)}`
      : `/api/v1/cart/set-groups/${encodeURIComponent(reservationId)}`;
    const payload = await request(path);
    const groups = Array.isArray(payload?.groups) ? payload.groups : [];
    writeDrafts(groups);
    return groups;
  }

  function setById(setId) {
    return catalog.find((row) => String(row.setId) === String(setId)) || null;
  }

  function moneyMinor(value) {
    return `${(Math.max(0, Number(value) || 0) / 100).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
  }

  function firstImage(set) {
    return Array.isArray(set?.images) && set.images.length
      ? String(set.images[0] || "")
      : "Photos/logo-1to1.png";
  }

  root.DartSets = Object.freeze({
    request,
    loadCatalog,
    detail,
    setById,
    readDrafts,
    writeDrafts,
    clearDrafts,
    attachCartGroups,
    cartGroups,
    currentReservationId,
    signedIn,
    moneyMinor,
    firstImage,
    catalog: () => clone(catalog),
    settings: () => clone(settings),
  });

  root.dispatchEvent?.(new CustomEvent("dart:sets-client-ready"));
})(typeof window !== "undefined" ? window : globalThis);
