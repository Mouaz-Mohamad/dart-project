// DART CODE GUIDE | Eye/dart-orders-api.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-orders-api.js
// Server-backed order hydration, writes, workflow mutations, and synchronization.
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
  let localRevision = 0;
  let syncInFlight = false;
  let authoritativeMutations = 0;
  let authoritativeEpoch = 0;
  let hydrateSerial = 0;
  let lastAppliedHydrateSerial = 0;

  function readLocal() {
    return window.DartState?.read?.(STORAGE_KEY, []) || [];
  }

  function cache(orders, source = "orders") {
    const rows = Array.isArray(orders) ? orders : [];
    window.DartState?.write?.(STORAGE_KEY, rows, { source });
    window.dispatchEvent(
      new CustomEvent("dart:orders-hydrated", {
        detail: { version: serverVersion, orders: rows },
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

  function hasMutationBarrier() {
    return dirty || syncInFlight || authoritativeMutations > 0;
  }

  async function sync() {
    if (!serverVersion || !dirty || authoritativeMutations > 0) return readLocal();

    const revision = localRevision;
    const expectedVersion = serverVersion;
    const snapshot = readLocal().map((row) => ({ ...row }));
    syncInFlight = true;
    try {
      const payload = await api("/api/v1/admin/orders-state", {
        method: "PUT",
        body: { expectedVersion, orders: snapshot },
      });
      serverVersion = Number(payload.version || serverVersion);
      if (revision === localRevision) {
        dirty = false;
        cache(payload.orders || [], "orders:sync-confirmed");
        window.dispatchEvent(
          new CustomEvent("dart:orders-synced", {
            detail: { version: serverVersion },
          }),
        );
      } else {
        dirty = true;
        scheduleSync();
      }
      await refreshRelatedServerState();
      return revision === localRevision ? payload.orders || [] : readLocal();
    } finally {
      syncInFlight = false;
    }
  }

  async function rebaseVersionPreservingLocal() {
    const payload = await api("/api/v1/admin/orders-state");
    serverVersion = Number(payload.version || serverVersion || 1);
    return readLocal();
  }

  function scheduleSync() {
    if (!serverVersion || authoritativeMutations > 0) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncChain = syncChain
        .then(sync)
        .catch(async (error) => {
          console.error("Dart order sync failed", error);
          if (error.status === 409) {
            await rebaseVersionPreservingLocal();
            dirty = true;
            scheduleSync();
          }
        });
    }, 120);
  }

  function write(orders) {
    window.DartState?.write?.(
      STORAGE_KEY,
      Array.isArray(orders) ? orders : [],
      { source: "orders:edit" },
    );
    localRevision += 1;
    dirty = true;
    scheduleSync();
  }

  async function flush() {
    clearTimeout(syncTimer);
    if (!dirty) {
      await syncChain;
      return readLocal();
    }
    syncChain = syncChain.then(sync);
    return await syncChain;
  }

  async function runAuthoritativeMutation(path, body) {
    if (dirty) await flush();

    authoritativeMutations += 1;
    authoritativeEpoch += 1;
    const epoch = authoritativeEpoch;
    clearTimeout(syncTimer);
    try {
      const payload = await api(path, { method: "POST", body });
      if (epoch === authoritativeEpoch) {
        serverVersion = Number(payload.version || serverVersion || 1);
        dirty = false;
        cache(payload.orders || [], "orders:authoritative");
      }
      await refreshRelatedServerState();
      return payload.orders || [];
    } finally {
      authoritativeMutations = Math.max(0, authoritativeMutations - 1);
    }
  }

  async function workflow(orderRef, input) {
    return await runAuthoritativeMutation(
      `/api/v1/admin/orders/${encodeURIComponent(orderRef)}/workflow`,
      input,
    );
  }

  async function stateAction(orderRef, action) {
    return await runAuthoritativeMutation(
      `/api/v1/admin/orders/${encodeURIComponent(orderRef)}/state`,
      { action },
    );
  }

  async function createManual(order) {
    if (dirty) await flush();
    authoritativeMutations += 1;
    authoritativeEpoch += 1;
    const epoch = authoritativeEpoch;
    try {
      const payload = await api("/api/v1/admin/orders", {
        method: "POST",
        body: order,
      });
      if (epoch === authoritativeEpoch) {
        serverVersion = Number(payload.version || serverVersion || 1);
        dirty = false;
        cache(payload.orders || [], "orders:create-confirmed");
      }
      await refreshRelatedServerState();
      return payload.orders || [];
    } finally {
      authoritativeMutations = Math.max(0, authoritativeMutations - 1);
    }
  }

  async function updateManual(orderRef, order) {
    if (dirty) await flush();
    authoritativeMutations += 1;
    authoritativeEpoch += 1;
    const epoch = authoritativeEpoch;
    try {
      const payload = await api(
        `/api/v1/admin/orders/${encodeURIComponent(orderRef)}`,
        {
          method: "PATCH",
          body: order,
        },
      );
      if (epoch === authoritativeEpoch) {
        serverVersion = Number(payload.version || serverVersion || 1);
        dirty = false;
        cache(payload.orders || [], "orders:update-confirmed");
      }
      await refreshRelatedServerState();
      return payload.orders || [];
    } finally {
      authoritativeMutations = Math.max(0, authoritativeMutations - 1);
    }
  }

  async function hydrate(_force = false) {
    if (hasMutationBarrier()) return readLocal();

    const serial = ++hydrateSerial;
    const epoch = authoritativeEpoch;
    const revision = localRevision;
    const payload = await api("/api/v1/admin/orders-state");

    if (
      hasMutationBarrier() ||
      epoch !== authoritativeEpoch ||
      revision !== localRevision ||
      serial < lastAppliedHydrateSerial
    ) {
      return readLocal();
    }

    lastAppliedHydrateSerial = serial;
    serverVersion = Number(payload.version || 1);
    dirty = false;
    cache(payload.orders || [], "orders:hydrate");
    return payload.orders || [];
  }

  async function check() {
    if (!adminPollingEnabled || document.hidden) return;
    if (authoritativeMutations > 0) return;
    try {
      if (!serverVersion) {
        await hydrate();
        return;
      }
      if (dirty || syncInFlight) {
        await flush();
        if (dirty || syncInFlight) return;
      }
      const epoch = authoritativeEpoch;
      const revision = localRevision;
      const payload = await api("/api/v1/admin/orders-version");
      if (
        epoch !== authoritativeEpoch ||
        revision !== localRevision ||
        hasMutationBarrier()
      ) return;

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
  // Lightweight version check only; stale reads can never overwrite an active mutation.
  window.setInterval(check, 3000);

  window.DartOrdersApi = {
    hydrate,
    createManual,
    updateManual,
    workflow,
    stateAction,
    sync,
    flush,
    write,
    read: readLocal,
    check,
    isBusy: () => hasMutationBarrier(),
    serverVersion: () => serverVersion,
  };
})();

// END MODULE
