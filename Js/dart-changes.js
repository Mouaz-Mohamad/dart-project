// Direct read-only invalidations. Business data is always fetched from its authorized API.
(() => {
  "use strict";
  if (window.DartChanges || typeof window.EventSource !== "function") return;
  const admin = /\/Eye\//i.test(location.pathname);
  const base = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  let source = null, retryTimer = 0, startupTimer = 0, active = false, epoch = 0, backoff = 1000;
  let capability = null;
  let reconcileTimer = 0;
  let authenticated = !admin || Boolean(window.DartAdminAccess?.can?.("orders.read") || window.DartAdminHydration?.ready);
  const emit = detail => window.dispatchEvent(new CustomEvent("dart:server-change", { detail }));
  function stop() {
    epoch++; active = false;
    clearTimeout(retryTimer); clearTimeout(startupTimer);
    clearTimeout(reconcileTimer); reconcileTimer = 0;
    retryTimer = startupTimer = 0;
    source?.close(); source = null;
  }
  async function connect() {
    if (source || !authenticated || document.hidden || navigator.onLine === false) return;
    const probeEpoch = epoch;
    if (!capability) capability = fetch(base + "/api/v1/health/live", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(payload => payload?.capabilities?.includes("direct-updates-v1") === true)
      .catch(() => { capability = null; return false; });
    const supported = await capability;
    if (!supported) {
      // Retry a transiently failed live-capability probe rather than disabling SSE until reload.
      capability = null;
      if (probeEpoch === epoch && authenticated && !document.hidden && navigator.onLine !== false)
        retryTimer = window.setTimeout(connect, 60000);
      return;
    }
    if (probeEpoch !== epoch || source || !authenticated || document.hidden || navigator.onLine === false) return;
    const generation = ++epoch;
    let current;
    try { current = new window.EventSource(base + (admin ? "/api/v1/admin/changes" : "/api/v1/catalog/changes"), { withCredentials: true }); }
    catch {
      retryTimer = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
      return;
    }
    source = current;
    const failed = () => {
      if (generation !== epoch) return;
      stop();
      retryTimer = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    };
    startupTimer = window.setTimeout(failed, 10000);
    current.addEventListener("unavailable", () => {
      if (generation !== epoch) return;
      stop(); backoff = 60000;
      retryTimer = window.setTimeout(connect, backoff);
    });
    current.addEventListener("ready", () => {
      if (generation !== epoch) return;
      clearTimeout(startupTimer); startupTimer = 0;
      active = true; backoff = 1000;
      emit({ reconcile: true }); // Catch changes committed during disconnect/hidden tabs.
      // Expiring reservations are clock-driven, and NOTIFY is not a replay log.
      // A small once-per-minute version check protects those cases without full data polling.
      const reconcile = () => {
        if (generation !== epoch || !active) return;
        emit({ reconcile: true });
        reconcileTimer = window.setTimeout(reconcile, 600000);
      };
      clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(reconcile, 600000);
    });
    current.addEventListener("change", event => {
      if (generation !== epoch || !active) return;
      try {
        const value = JSON.parse(event.data);
        if (!["version", "domain"].includes(value.scope) || !/^[a-z_]{1,50}$/.test(value.name) || !Number.isSafeInteger(value.version) || value.version < 1) return;
        emit({ scope: value.scope, name: value.name, version: value.version });
      } catch { /* Signals never directly write business state. */ }
    });
    current.addEventListener("error", failed);
  }
  window.DartChanges = Object.freeze({ get active() { return active; } });
  window.addEventListener("dart:admin-authenticated", () => { authenticated = true; stop(); connect(); });
  window.addEventListener("dart:data-changed", event => {
    if (admin && event.detail?.source === "logout") { authenticated = false; stop(); }
  });
  document.addEventListener("visibilitychange", () => { stop(); if (!document.hidden) connect(); });
  window.addEventListener("offline", stop);
  window.addEventListener("online", () => { stop(); connect(); });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", connect);
  connect();
})();
