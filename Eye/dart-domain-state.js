// DART CODE GUIDE | Eye/dart-domain-state.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-domain-state.js
// Dashboard domain hydration/synchronization adapters backed by the admin API.
// BEGIN MODULE

(function () {
  "use strict";

  const API_BASE = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const DOMAIN_BY_STORAGE = Object.freeze({
    dart_customers: "customers",
    dart_returns: "returns",
    dart_reviews: "reviews",
    dart_cards: "cards",
    dart_representatives: "representatives",
    dart_damage: "damage",
    dart_notifications: "notifications",
    dart_contact_messages: "contacts",
    dart_birthday_rewards: "birthday_rewards",
    dart_birthday_messages: "birthday_messages",
    dart_message_queue: "message_queue",
    dart_promotions: "promotions",
    dart_finance_expenses: "finance_expenses",
    dart_finance_budgets: "finance_budgets",
    dart_finance_invoices: "finance_invoices",
    dart_finance_goals: "finance_goals",
    dart_finance_marketing: "finance_marketing",
    dart_finance_cod_settlements: "finance_settlements",
    dart_finance_audit: "finance_audit",
    dart_draw_eligibility_audit: "draw_audit",
  });
  const STORAGE_BY_DOMAIN = Object.freeze(
    Object.fromEntries(Object.entries(DOMAIN_BY_STORAGE).map(([key, domain]) => [domain, key])),
  );
  const versions = new Map();
  const dirty = new Set();
  const timers = new Map();
  const queues = new Map();
  const revisions = new Map();
  const deniedDomains = new Set();
  let adminPollingEnabled = false;
  let polling = false;
  let sessionEpoch = 0;
  let refreshPromise = null;
  let refreshAgain = false;

  function readLocal(storageKey) {
    return window.DartState?.read?.(storageKey, []) || [];
  }

  function cache(storageKey, data, domain) {
    const value = Array.isArray(data) ? data : [];
    window.DartState?.write?.(storageKey, value, { source: `domain:${domain}` });
    window.dispatchEvent(
      new CustomEvent("dart:domain-hydrated", {
        detail: { domain, storageKey, version: versions.get(domain) || 0, data: value },
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

  async function sha256Text(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sanitizeDomainData(domain, data) {
    const rows = Array.isArray(data) ? structuredClone(data) : [];
    if (domain !== "representatives") return rows;
    for (const row of rows) {
      const raw = String(row.nationalId || "").trim();
      if (raw) {
        row.nationalIdHash = await sha256Text(raw);
        row.nationalIdLast4 = raw.slice(-4);
        delete row.nationalId;
      }
    }
    return rows;
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
      const error = new Error(payload?.error?.message || "Dashboard state request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function hydrateDomain(domain, _force = false) {
    const storageKey = STORAGE_BY_DOMAIN[domain];
    if (!storageKey) return [];
    const revision = revisions.get(domain) || 0;
    const session = sessionEpoch;
    const payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`);
    // A read started before a local edit must never discard that edit.
    const version = Number(payload.version || 1);
    if (session !== sessionEpoch || dirty.has(domain) || revision !== (revisions.get(domain) || 0) ||
        version < (versions.get(domain) || 0)) return readLocal(storageKey);
    versions.set(domain, version);
    dirty.delete(domain);
    cache(storageKey, payload.data || [], domain);
    return payload.data || [];
  }

  async function syncDomain(domain) {
    const storageKey = STORAGE_BY_DOMAIN[domain];
    const version = versions.get(domain);
    if (!storageKey || !version) return readLocal(storageKey);
    const revision = revisions.get(domain) || 0;
    const session = sessionEpoch;
    const snapshot = structuredClone(readLocal(storageKey));
    const data = await sanitizeDomainData(domain, snapshot);
    if (session !== sessionEpoch) return readLocal(storageKey);
    const payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`, {
      method: "PUT",
      body: {
        expectedVersion: version,
        data,
      },
    });
    if (session !== sessionEpoch) return readLocal(storageKey);
    const responseVersion = Number(payload.version || version);
    if (responseVersion < (versions.get(domain) || 0)) return readLocal(storageKey);
    versions.set(domain, responseVersion);
    if (revision === (revisions.get(domain) || 0)) {
      dirty.delete(domain);
      cache(storageKey, payload.data || [], domain);
    }
    window.dispatchEvent(
      new CustomEvent("dart:domain-synced", {
        detail: { domain, storageKey, version: versions.get(domain) },
      }),
    );
    return payload.data || [];
  }

  function syncNow(domain) {
    clearTimeout(timers.get(domain));
    const chain = queues.get(domain) || Promise.resolve();
    const session = sessionEpoch;
    const next = chain.then(() => session === sessionEpoch ? syncDomain(domain) : []);
    queues.set(domain, next.catch(() => undefined));
    return next;
  }

  async function writeAndSync(storageKey, data) {
    const session = sessionEpoch;
    const domain = DOMAIN_BY_STORAGE[storageKey];
    if (!domain) {
      window.DartState?.write?.(storageKey, data, { source: "dashboard" });
      return Array.isArray(data) ? data : [];
    }
    if (deniedDomains.has(domain)) {
      const error = new Error("You do not have permission to update this dashboard domain");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    if (!versions.get(domain)) await hydrateDomain(domain);
    if (session !== sessionEpoch) throw new Error("Staff session changed; refresh before continuing.");
    const previous = readLocal(storageKey);
    const revision = (revisions.get(domain) || 0) + 1;
    revisions.set(domain, revision);
    window.DartState?.write?.(
      storageKey,
      Array.isArray(data) ? data : [],
      { source: `domain:${domain}:confirmed-edit` },
    );
    dirty.add(domain);
    try {
      return await syncNow(domain);
    } catch (error) {
      if (session === sessionEpoch && revision === revisions.get(domain)) {
        dirty.delete(domain);
        if (error.status === 409) {
          await hydrateDomain(domain, true).catch(() => cache(storageKey, previous, domain));
        } else {
          cache(storageKey, previous, domain);
        }
      }
      window.dispatchEvent(new CustomEvent("dart:domain-sync-failed", {
        detail: { domain, storageKey, code: error.code || "SYNC_FAILED" },
      }));
      throw error;
    }
  }

  async function createFinanceSettlement(data) {
    // The receipt endpoint accepts command fields only. Status, timestamps and
    // representative/accounting values are assigned by the server.
    const { id, orderId, settlementDate, amountReceived, fee, reference, notes } = data;
    const payload = await api("/api/v1/admin/finance/settlements", {
      method: "POST",
      body: { id, orderId, settlementDate, amountReceived, fee, reference, notes },
    });
    if (Number(payload?.version) > 0) {
      versions.set("finance_settlements", Number(payload.version));
    }
    try {
      await hydrateDomain("finance_settlements", true);
    } catch (error) {
      // A failed refresh must not turn an already confirmed cash receipt into a failed save.
      if (!payload?.settlement) throw error;
      const storageKey = STORAGE_BY_DOMAIN.finance_settlements;
      const rows = readLocal(storageKey).filter((row) => String(row.id) !== String(payload.settlement.id));
      cache(storageKey, [payload.settlement, ...rows], "finance_settlements");
      window.dispatchEvent(new CustomEvent("dart:domain-refresh-failed", {
        detail: { domain: "finance_settlements", code: "REFRESH_FAILED" },
      }));
    }
    return payload?.settlement || null;
  }

  function schedule(domain) {
    if (!versions.get(domain)) return;
    clearTimeout(timers.get(domain));
    timers.set(
      domain,
      setTimeout(() => {
        const next = syncNow(domain)
          .catch(async (error) => {
            console.error(`Dart ${domain} sync failed`, error);
            if (error.status === 409) {
              dirty.delete(domain);
              await hydrateDomain(domain, true).catch(() => {});
            }
          });
        void next;
      }, 120),
    );
  }

  function write(storageKey, data) {
    const domain = DOMAIN_BY_STORAGE[storageKey];
    if (!domain) {
      window.DartState?.write?.(storageKey, data, { source: "dashboard" });
      return true;
    }
    if (deniedDomains.has(domain)) {
      window.DartState?.remove?.(storageKey, { source: "permission" });
      window.dispatchEvent(
        new CustomEvent("dart:domain-write-denied", {
          detail: { domain, storageKey },
        }),
      );
      return false;
    }
    revisions.set(domain, (revisions.get(domain) || 0) + 1);
    window.DartState?.write?.(storageKey, Array.isArray(data) ? data : [], { source: `domain:${domain}:edit` });
    dirty.add(domain);
    schedule(domain);
    return true;
  }

  async function hydrateAudit(limit = 500) {
    const session = sessionEpoch;
    const payload = await api(`/api/v1/admin/audit?limit=${encodeURIComponent(limit)}`);
    if (session !== sessionEpoch) return [];
    const audit = Array.isArray(payload.audit) ? payload.audit : [];
    window.DartState?.write?.("dart_audit", audit, { source: "audit" });
    window.dispatchEvent(new CustomEvent("dart:audit-hydrated", { detail: { audit } }));
    return audit;
  }

  async function auditFor(entityType, entityId) {
    const params = new URLSearchParams({
      limit: "1500",
      entityType: String(entityType || ""),
      entityId: String(entityId || ""),
    });
    const payload = await api(`/api/v1/admin/audit?${params.toString()}`);
    return Array.isArray(payload.audit) ? payload.audit : [];
  }

  async function hydrateAll() {
    const session = sessionEpoch;
    const allDomains = Object.keys(STORAGE_BY_DOMAIN);
    const initialRevisions = new Map(revisions);
    const payload = await api("/api/v1/admin/domain-state");
    if (session !== sessionEpoch) return {};
    const rows = Array.isArray(payload?.domains) ? payload.domains : [];
    const received = new Set();

    for (const row of rows) {
      const domain = String(row?.domain || "");
      const storageKey = STORAGE_BY_DOMAIN[domain];
      if (!storageKey) continue;
      received.add(domain);
      deniedDomains.delete(domain);
      if (dirty.has(domain) || (revisions.get(domain) || 0) !== (initialRevisions.get(domain) || 0) ||
          Number(row.version || 1) < (versions.get(domain) || 0)) continue;
      versions.set(domain, Number(row.version || 1));
      dirty.delete(domain);
      cache(storageKey, row.data || [], domain);
    }

    for (const domain of allDomains) {
      if (received.has(domain)) continue;
      deniedDomains.add(domain);
      const storageKey = STORAGE_BY_DOMAIN[domain];
      versions.delete(domain);
      dirty.delete(domain);
      window.DartState?.remove?.(storageKey, { source: "permission" });
      window.dispatchEvent(
        new CustomEvent("dart:domain-hydrated", {
          detail: { domain, storageKey, version: 0, data: [] },
        }),
      );
    }

    try {
      await hydrateAudit();
    } catch (error) {
      if (session !== sessionEpoch) return {};
      if (error.status === 403) {
        window.DartState?.remove?.("dart_audit", { source: "permission" });
        window.dispatchEvent(
          new CustomEvent("dart:audit-hydrated", { detail: { audit: [] } }),
        );
      } else {
        console.warn("Dart audit hydration failed", error);
      }
    }
    if (session !== sessionEpoch) return {};
    return Object.fromEntries(
      rows.map((row) => [String(row.domain || ""), Array.isArray(row.data) ? row.data : []]),
    );
  }

  async function checkDomain(domain, remoteVersion = 0) {
    if (document.hidden || deniedDomains.has(domain)) return;
    try {
      if (!versions.get(domain)) {
        await hydrateDomain(domain);
        return;
      }
      if (dirty.has(domain)) {
        await syncNow(domain);
        return;
      }
      if (remoteVersion && remoteVersion !== versions.get(domain)) {
        await hydrateDomain(domain, true);
      }
    } catch (error) {
      if (error.status !== 401) console.warn(`Dart ${domain} live refresh failed`, error);
    }
  }

  function refreshChanged() {
    if (refreshPromise) { refreshAgain = true; return refreshPromise; }
    const session = sessionEpoch;
    const promise = (async () => {
      do {
        refreshAgain = false;
        const payload = await api("/api/v1/admin/domain-state-versions");
        if (session !== sessionEpoch) return;
        const remoteVersions = payload?.versions || {};
        await Promise.all(Object.keys(remoteVersions).filter((domain) =>
          STORAGE_BY_DOMAIN[domain] && !deniedDomains.has(domain) && !dirty.has(domain) &&
          Number(remoteVersions[domain] || 0) > (versions.get(domain) || 0),
        ).map((domain) => hydrateDomain(domain, true)));
      } while (refreshAgain && session === sessionEpoch);
    })();
    refreshPromise = promise;
    void promise.finally(() => { if (refreshPromise === promise) refreshPromise = null; }).catch(() => {});
    return promise;
  }

  async function checkAll() {
    if (!adminPollingEnabled || document.hidden || polling) return;
    polling = true;
    const session = sessionEpoch;
    try {
      await refreshChanged();
      if (session !== sessionEpoch) return;
      await Promise.all(
        [...dirty].map((domain) => checkDomain(domain)),
      );
    } catch (error) {
      if (session === sessionEpoch && error.status !== 401) console.warn("Dart dashboard live refresh failed", error);
    } finally {
      if (session === sessionEpoch) polling = false;
    }
  }

  window.addEventListener("dart:admin-authenticated", () => {
    adminPollingEnabled = true;
  });
  window.addEventListener("dart:data-changed", (event) => {
    if (event.detail?.key !== "dart_orders" || event.detail?.source !== "logout") return;
    sessionEpoch += 1;
    adminPollingEnabled = polling = refreshAgain = false;
    refreshPromise = null;
    versions.clear();
    dirty.clear();
    revisions.clear();
    deniedDomains.clear();
    queues.clear();
    timers.forEach(clearTimeout);
    timers.clear();
  });
  window.addEventListener("online", checkAll);
  window.addEventListener("focus", checkAll);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAll();
  });
  window.setInterval(checkAll, 3000);

  window.DartDomainState = {
    hydrateAll,
    hydrateDomain,
    syncDomain: syncNow,
    syncNow,
    writeAndSync,
    createFinanceSettlement,
    checkAll,
    refreshChanged,
    hydrateAudit,
    auditFor,
    write,
    read(storageKey) {
      return readLocal(storageKey);
    },
    domainForStorageKey(storageKey) {
      return DOMAIN_BY_STORAGE[storageKey] || null;
    },
    version(domain) {
      return versions.get(domain) || 0;
    },
  };
})();

// END MODULE
