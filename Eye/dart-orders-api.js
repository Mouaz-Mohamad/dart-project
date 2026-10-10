// BEGIN Deferred catalog and Settings bridges.
(function installDeferredCatalogBridge() {
  "use strict";
  if (window.DartCatalog) return;
  let bridge;
  bridge = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "__dartDeferredBridge") return true;
      const catalog = window.DartCatalog;
      if (!catalog || catalog === bridge) return undefined;
      const value = catalog[property];
      return typeof value === "function" ? value.bind(catalog) : value;
    },
  });
  window.DartCatalog = bridge;
})();
(function installDeferredSiteSettingsBridge() {
  "use strict";
  if (window.DartSiteSettings) return;
  let bridge;
  bridge = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "__dartDeferredBridge") return true;
      const settings = window.DartSiteSettings;
      if (!settings || settings === bridge) return undefined;
      const value = settings[property];
      return typeof value === "function" ? value.bind(settings) : value;
    },
  });
  window.DartSiteSettings = bridge;
})();
// END Deferred bridges.
// BEGIN Read-only snapshots and server order commands.
(function () {
  "use strict";
  const API_BASE = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const STORAGE_KEY = "dart_orders";
  let serverVersion = 0;
  let confirmedOrders = [];
  let adminPollingEnabled = false;
  let mutationEpoch = 0;
  let sessionEpoch = 0;
  let activeMutations = 0;
  let hydrateSerial = 0;
  let lastAppliedHydrateSerial = 0;
  let polling = false;
  let reconciliationRequired = false;
  let refreshTimer = 0;
  let relatedRefreshRunning = false;
  let refreshAgain = false;
  let relatedRefreshRequired = false;
  let relatedRefreshNotified = false;
  const pendingOrders = new Set();
  function readLocal() {
    return window.DartState?.read?.(STORAGE_KEY, []) || [];
  }
  function orderKey(ref) {
    const row = readLocal().find((order) =>
      String(order.id) === String(ref) || String(order.orderId) === String(ref));
    return String(row?.orderId || ref);
  }
  function publishBusy() {
    window.dispatchEvent(new CustomEvent("dart:orders-busy", {
      detail: { orderRefs: [...pendingOrders] },
    }));
  }
  function applySnapshot(payload, source) {
    if (payload.refreshRequired || !Array.isArray(payload.orders)) return false;
    const version = Number(payload.version || 0);
    if (!Number.isSafeInteger(version) || version <= 0 || version < serverVersion) return false;
    let orders = payload.orders;
    if (payload.responseMode === "delta") {
      const baseVersion = Number(payload.baseVersion);
      if (!serverVersion || reconciliationRequired || baseVersion !== serverVersion ||
          (version !== baseVersion && version !== baseVersion + 1) || !orders.length) return false;
      const ids = new Set();
      for (const row of orders) {
        if (!row?.id || !row.orderId || ids.has(String(row.id))) return false;
        ids.add(String(row.id));
      }
      const merged = new Map(confirmedOrders.map((row) => [String(row.id), row]));
      orders.forEach((row) => merged.set(String(row.id), row));
      orders = [...merged.values()].sort((a, b) => {
        const difference = Date.parse(b.orderCreatedAt || b.createdAt) - Date.parse(a.orderCreatedAt || a.createdAt);
        return Number.isFinite(difference) ? difference || String(b.id).localeCompare(String(a.id)) : 0;
      });
    }
    const selections = new Map(readLocal().map((order) => [String(order.orderId), Boolean(order.isChecked)]));
    serverVersion = version;
    reconciliationRequired = false;
    confirmedOrders = JSON.parse(JSON.stringify(orders));
    const rows = orders.map((order) => ({
      ...order, isChecked: selections.get(String(order.orderId)) || false,
    }));
    window.DartState?.write?.(STORAGE_KEY, rows, { source });
    window.dispatchEvent(new CustomEvent("dart:orders-hydrated", {
      detail: { version: serverVersion, orders: rows },
    }));
    publishBusy();
    return true;
  }
  function csrfToken() {
    return document.cookie.split("; ")
      .find((row) => row.startsWith("dart_csrf="))?.split("=").slice(1).join("=");
  }
  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const csrf = csrfToken();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 20000) : 0;
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: "include", method,
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          "Content-Type": "application/json",
          ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
            ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload?.error?.message || "Orders request failed");
        error.status = response.status;
        error.code = method !== "GET" && response.status >= 500
          ? "ORDER_RESULT_UNKNOWN" : payload?.error?.code;
        throw error;
      }
      return payload;
    } catch (cause) {
      if (cause.status) throw cause;
      const error = new Error(method === "GET"
        ? "Orders refresh failed; retry when the connection is available."
        : "Order result is not confirmed; refresh before repeating this action.");
      error.code = method === "GET" ? "ORDERS_REFRESH_FAILED" : "ORDER_RESULT_UNKNOWN";
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function refreshRelatedServerState() {
    if (relatedRefreshRunning) { refreshAgain = true; return; }
    const session = sessionEpoch;
    relatedRefreshRunning = true;
    relatedRefreshRequired = false;
    try {
      const jobs = [];
      if (window.DartCatalog?.refreshChanged) jobs.push(window.DartCatalog.refreshChanged());
      else if (window.DartCatalog?.hydrate) jobs.push(window.DartCatalog.hydrate(true));
      if (window.DartDomainState?.refreshChanged) jobs.push(window.DartDomainState.refreshChanged());
      else if (window.DartDomainState?.hydrateDomain) {
        ["cards", "birthday_rewards", "returns", "damage", "notifications"].forEach(
          (domain) => jobs.push(window.DartDomainState.hydrateDomain(domain, true)));
      }
      if (window.DartDomainState?.hydrateAudit) jobs.push(window.DartDomainState.hydrateAudit());
      const results = await Promise.allSettled(jobs);
      if (results.some((result) => result.status === "rejected" && ![401, 403].includes(result.reason?.status)))
        throw new Error("Related state refresh failed");
      if (session === sessionEpoch) relatedRefreshNotified = false;
    } catch {
      if (session === sessionEpoch) {
        relatedRefreshRequired = true;
        if (!relatedRefreshNotified) window.dispatchEvent(new CustomEvent("dart:orders-refresh-failed"));
        relatedRefreshNotified = true;
      }
    } finally {
      if (session === sessionEpoch) {
        relatedRefreshRunning = false;
        if (refreshAgain) {
          refreshAgain = false;
          scheduleRelatedRefresh();
        }
      }
    }
  }
  function scheduleRelatedRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refreshRelatedServerState(); }, 150);
  }
  // Legacy saves retain selection only.
  function write(orders) {
    const selections = new Map((Array.isArray(orders) ? orders : [])
      .map((order) => [String(order.orderId), Boolean(order.isChecked)]));
    const rows = JSON.parse(JSON.stringify(confirmedOrders)).map((order) => ({
      ...order, isChecked: selections.get(String(order.orderId)) || false,
    }));
    window.DartState?.write?.(STORAGE_KEY, rows, { source: "orders:selection" });
  }
  async function hydrate(_force = false) {
    if (activeMutations > 0) return readLocal();
    const serial = ++hydrateSerial;
    const epoch = mutationEpoch;
    const recovering = reconciliationRequired;
    const payload = await api("/api/v1/admin/orders-state");
    if (activeMutations > 0 || epoch !== mutationEpoch || serial < lastAppliedHydrateSerial)
      return readLocal();
    lastAppliedHydrateSerial = serial;
    if (applySnapshot(payload, "orders:hydrate") && recovering) scheduleRelatedRefresh();
    return readLocal();
  }
  async function runAuthoritativeMutation(path, body, refs = [], returnPayload = false, method = "POST") {
    const session = sessionEpoch;
    const keys = [...new Set(refs.map(orderKey))];
    if (keys.some((key) => pendingOrders.has(key))) {
      const error = new Error("This order already has an action in progress.");
      error.code = "ORDER_ACTION_PENDING";
      throw error;
    }
    keys.forEach((key) => pendingOrders.add(key));
    activeMutations += 1;
    mutationEpoch += 1;
    publishBusy();
    let reconcile = false;
    try {
      const requestPath = returnPayload ? path : `${path}?responseMode=delta&baseVersion=${serverVersion}`;
      const payload = await api(requestPath, { method, body });
      if (session !== sessionEpoch) {
        const error = new Error("Staff session changed; refresh before continuing.");
        error.code = "ORDER_SESSION_CHANGED";
        throw error;
      }
      reconcile = Boolean(payload.refreshRequired);
      const applied = applySnapshot(payload, "orders:authoritative");
      reconcile ||= !applied && Number(payload.version || 0) >= serverVersion;
      scheduleRelatedRefresh();
      return returnPayload ? payload : readLocal();
    } catch (error) {
      reconcile = error.code === "ORDER_RESULT_UNKNOWN" || error.status === 409;
      throw error;
    } finally {
      if (session === sessionEpoch) {
        keys.forEach((key) => pendingOrders.delete(key));
        activeMutations -= 1;
        publishBusy();
        reconciliationRequired ||= reconcile;
        if (reconciliationRequired && activeMutations === 0)
          setTimeout(() => { void hydrate(true).catch(() => {}); }, 0);
      }
    }
  }
  function workflow(orderRef, input) {
    return runAuthoritativeMutation(`/api/v1/admin/orders/${encodeURIComponent(orderRef)}/workflow`, input, [orderRef]);
  }
  function bulkWorkflow(input) {
    return runAuthoritativeMutation("/api/v1/admin/orders/bulk-workflow", input, input.orderRefs, true);
  }
  function codVerification(orderRef, input) {
    return runAuthoritativeMutation(`/api/v1/admin/orders/${encodeURIComponent(orderRef)}/cod-verification`, input, [orderRef]);
  }
  function stateAction(orderRef, action) {
    return runAuthoritativeMutation(`/api/v1/admin/orders/${encodeURIComponent(orderRef)}/state`, { action }, [orderRef]);
  }
  function createManual(order) {
    return runAuthoritativeMutation("/api/v1/admin/orders", order, ["__manual_create__"]);
  }
  function updateManual(orderRef, order) {
    return runAuthoritativeMutation(`/api/v1/admin/orders/${encodeURIComponent(orderRef)}`, order, [orderRef], false, "PATCH");
  }
  async function check() {
    if (!adminPollingEnabled || document.hidden) return;
    if (activeMutations > 0 || polling) return;
    polling = true;
    try {
      if (relatedRefreshRequired) scheduleRelatedRefresh();
      if (!serverVersion || reconciliationRequired) { await hydrate(); return; }
      const epoch = mutationEpoch;
      const payload = await api("/api/v1/admin/orders-version");
      if (epoch !== mutationEpoch || activeMutations > 0) return;
      if (Number(payload.version || 0) > serverVersion) await hydrate(true);
    } catch (error) {
      if (error.status !== 401) console.warn("Dart order live refresh failed", error);
    } finally {
      polling = false;
    }
  }
  window.addEventListener("dart:admin-authenticated", () => { adminPollingEnabled = true; });
  window.addEventListener("dart:data-changed", (event) => {
    if (event.detail?.key !== STORAGE_KEY || event.detail?.source !== "logout") return;
    sessionEpoch += 1;
    mutationEpoch += 1;
    activeMutations = serverVersion = 0;
    confirmedOrders = [];
    adminPollingEnabled = reconciliationRequired = refreshAgain = relatedRefreshRequired = relatedRefreshRunning = false;
    relatedRefreshNotified = false;
    clearTimeout(refreshTimer);
    pendingOrders.clear();
    publishBusy();
  });
  window.addEventListener("online", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(); });
  window.setInterval(check, 3000);
  window.DartOrdersApi = {
    hydrate, createManual, updateManual, workflow, bulkWorkflow, codVerification, stateAction,
    sync: hydrate, flush: async () => readLocal(), write, read: readLocal, check,
    isBusy: (ref) => ref === undefined ? activeMutations > 0 : pendingOrders.has(orderKey(ref)),
    serverVersion: () => serverVersion,
  };
  document.head.append(Object.assign(document.createElement("script"), { src: "dart-order-group-ui.js" }));
})();
// END Orders client.
