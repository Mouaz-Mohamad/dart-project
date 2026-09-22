// DART CODE GUIDE | Eye/dart-orders-api.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-orders-api.js
// Server-backed order hydration, writes, and synchronization.
// BEGIN MODULE

(function () {
  "use strict";

  const API_BASE = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const STORAGE_KEY = "dart_orders";
  let serverVersion = 0;
  let dirty = false;
  let syncTimer = 0;
  let syncChain = Promise.resolve();
  let adminPollingEnabled = false;

  function readLocal() {
    return window.DartState?.read?.(STORAGE_KEY, []) || [];
  }

  function cache(orders) {
    window.DartState?.write?.(STORAGE_KEY, Array.isArray(orders) ? orders : [], { source: "orders" });
    window.dispatchEvent(
      new CustomEvent("dart:orders-hydrated", {
        detail: { version: serverVersion, orders: Array.isArray(orders) ? orders : [] },
      }),
    );
  }

  function csrfToken() {
    return document.cookie
      .split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const csrf = csrfToken();
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
      const error = new Error(payload?.error?.message || "Orders request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function refreshRelatedServerState() {
    const jobs = [];
    if (window.DartCatalog?.hydrate) jobs.push(window.DartCatalog.hydrate(true));
    if (window.DartDomainState?.hydrateDomain) {
      ["cards", "birthday_rewards", "returns", "damage", "notifications"].forEach(
        (domain) => jobs.push(window.DartDomainState.hydrateDomain(domain, true)),
      );
    }
    if (window.DartDomainState?.hydrateAudit) {
      jobs.push(window.DartDomainState.hydrateAudit());
    }
    if (jobs.length) await Promise.allSettled(jobs);
  }

  async function sync() {
    if (!serverVersion) return readLocal();
    const payload = await api("/api/v1/admin/orders-state", {
      method: "PUT",
      body: { expectedVersion: serverVersion, orders: readLocal() },
    });
    serverVersion = Number(payload.version || serverVersion);
    dirty = false;
    cache(payload.orders || []);
    window.dispatchEvent(
      new CustomEvent("dart:orders-synced", { detail: { version: serverVersion } }),
    );
    await refreshRelatedServerState();
    return payload.orders || [];
  }

  function scheduleSync() {
    if (!serverVersion) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncChain = syncChain
        .then(sync)
        .catch(async (error) => {
          console.error("Dart order sync failed", error);
          if (error.status === 409) await hydrate(true);
        });
    }, 120);
  }

  function write(orders) {
    window.DartState?.write?.(STORAGE_KEY, Array.isArray(orders) ? orders : [], { source: "orders:edit" });
    dirty = true;
    scheduleSync();
  }

  async function stateAction(orderRef, action) {
    const payload = await api(
      `/api/v1/admin/orders/${encodeURIComponent(orderRef)}/state`,
      {
        method: "POST",
        body: { action },
      },
    );
    serverVersion = Number(payload.version || serverVersion || 1);
    dirty = false;
    cache(payload.orders || []);
    await refreshRelatedServerState();
    return payload.orders || [];
  }

  async function createManual(order) {
    const payload = await api("/api/v1/admin/orders", {
      method: "POST",
      body: order,
    });
    serverVersion = Number(payload.version || serverVersion || 1);
    dirty = false;
    cache(payload.orders || []);
    await refreshRelatedServerState();
    return payload.orders || [];
  }

  async function updateManual(orderRef, order) {
    const payload = await api(
      `/api/v1/admin/orders/${encodeURIComponent(orderRef)}`,
      {
        method: "PATCH",
        body: order,
      },
    );
    serverVersion = Number(payload.version || serverVersion || 1);
    dirty = false;
    cache(payload.orders || []);
    await refreshRelatedServerState();
    return payload.orders || [];
  }

  async function hydrate(_force = false) {
    const payload = await api("/api/v1/admin/orders-state");
    serverVersion = Number(payload.version || 1);
    dirty = false;
    cache(payload.orders || []);
    return payload.orders || [];
  }

  async function check() {
    if (!adminPollingEnabled || document.hidden) return;
    try {
      if (!serverVersion) {
        await hydrate();
        return;
      }
      if (dirty) await sync();
      const payload = await api("/api/v1/admin/orders-version");
      const remoteVersion = Number(payload.version || 0);
      if (remoteVersion && remoteVersion !== serverVersion) {
        await hydrate(true);
      }
    } catch (error) {
      if (error.status !== 401) console.warn("Dart order live refresh failed", error);
    }
  }

  window.addEventListener("dart:admin-authenticated", () => {
    adminPollingEnabled = true;
  });
  window.addEventListener("online", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
  // Lightweight version check only; no full-page reload.
  window.setInterval(check, 3000);

  window.DartOrdersApi = {
    hydrate,
    createManual,
    updateManual,
    stateAction,
    sync,
    write,
    read: readLocal,
    check,
    serverVersion: () => serverVersion,
  };
})();

// END MODULE
