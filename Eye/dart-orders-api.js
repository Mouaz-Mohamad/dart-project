(function () {
  "use strict";

  const API_BASE = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const STORAGE_KEY = "dart_orders";
  const CSRF_STORAGE_KEY = "dart_csrf_token";
  const LEGACY_MIGRATION_KEY = "dart_orders_server_migration_v1";
  let serverVersion = 0;
  let dirty = false;
  let syncTimer = 0;
  let syncChain = Promise.resolve();

  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function cache(orders) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(orders) ? orders : []));
    window.dispatchEvent(
      new CustomEvent("dart:orders-hydrated", {
        detail: { version: serverVersion, orders: Array.isArray(orders) ? orders : [] },
      }),
    );
  }

  function csrfToken() {
    const stored = localStorage.getItem(CSRF_STORAGE_KEY);
    if (stored) return stored;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(orders) ? orders : []));
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

  async function hydrate(force = false) {
    const localOrders = readLocal();
    let payload = await api("/api/v1/admin/orders-state");
    serverVersion = Number(payload.version || 1);

    const migrationDone = localStorage.getItem(LEGACY_MIGRATION_KEY) === "1";
    if (
      !force &&
      !migrationDone &&
      (payload.orders || []).length === 0 &&
      localOrders.length > 0
    ) {
      payload = await api("/api/v1/admin/orders-state", {
        method: "PUT",
        body: { expectedVersion: serverVersion, orders: localOrders },
      });
      serverVersion = Number(payload.version || serverVersion);
    }
    if (!force && !migrationDone) {
      localStorage.setItem(LEGACY_MIGRATION_KEY, "1");
    }
    dirty = false;
    cache(payload.orders || []);
    return payload.orders || [];
  }

  async function check() {
    if (document.hidden) return;
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

  window.addEventListener("online", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
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
