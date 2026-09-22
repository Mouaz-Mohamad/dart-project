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
  const deniedDomains = new Set();
  let adminPollingEnabled = false;

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
    const payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`);
    versions.set(domain, Number(payload.version || 1));
    dirty.delete(domain);
    cache(storageKey, payload.data || [], domain);
    return payload.data || [];
  }

  async function syncDomain(domain) {
    const storageKey = STORAGE_BY_DOMAIN[domain];
    const version = versions.get(domain);
    if (!storageKey || !version) return readLocal(storageKey);
    const payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`, {
      method: "PUT",
      body: {
        expectedVersion: version,
        data: await sanitizeDomainData(domain, readLocal(storageKey)),
      },
    });
    versions.set(domain, Number(payload.version || version));
    dirty.delete(domain);
    cache(storageKey, payload.data || [], domain);
    window.dispatchEvent(
      new CustomEvent("dart:domain-synced", {
        detail: { domain, storageKey, version: versions.get(domain) },
      }),
    );
    return payload.data || [];
  }

  function schedule(domain) {
    if (!versions.get(domain)) return;
    clearTimeout(timers.get(domain));
    timers.set(
      domain,
      setTimeout(() => {
        const chain = queues.get(domain) || Promise.resolve();
        const next = chain
          .then(() => syncDomain(domain))
          .catch(async (error) => {
            console.error(`Dart ${domain} sync failed`, error);
            if (error.status === 409) {
              await hydrateDomain(domain, true).catch(() => {});
            }
          });
        queues.set(domain, next);
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
    window.DartState?.write?.(storageKey, Array.isArray(data) ? data : [], { source: `domain:${domain}:edit` });
    dirty.add(domain);
    schedule(domain);
    return true;
  }

  async function hydrateAudit(limit = 500) {
    const payload = await api(`/api/v1/admin/audit?limit=${encodeURIComponent(limit)}`);
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
    const allDomains = Object.keys(STORAGE_BY_DOMAIN);
    const payload = await api("/api/v1/admin/domain-state");
    const rows = Array.isArray(payload?.domains) ? payload.domains : [];
    const received = new Set();

    for (const row of rows) {
      const domain = String(row?.domain || "");
      const storageKey = STORAGE_BY_DOMAIN[domain];
      if (!storageKey) continue;
      received.add(domain);
      deniedDomains.delete(domain);
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
      if (error.status === 403) {
        window.DartState?.remove?.("dart_audit", { source: "permission" });
        window.dispatchEvent(
          new CustomEvent("dart:audit-hydrated", { detail: { audit: [] } }),
        );
      } else {
        console.warn("Dart audit hydration failed", error);
      }
    }
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
        await syncDomain(domain);
        return;
      }
      if (remoteVersion && remoteVersion !== versions.get(domain)) {
        await hydrateDomain(domain, true);
      }
    } catch (error) {
      if (error.status !== 401) console.warn(`Dart ${domain} live refresh failed`, error);
    }
  }

  async function checkAll() {
    if (!adminPollingEnabled || document.hidden) return;
    try {
      const payload = await api("/api/v1/admin/domain-state-versions");
      const remoteVersions = payload?.versions || {};
      await Promise.all(
        Object.keys(STORAGE_BY_DOMAIN).map((domain) =>
          checkDomain(domain, Number(remoteVersions[domain] || 0)),
        ),
      );
    } catch (error) {
      if (error.status !== 401) console.warn("Dart dashboard live refresh failed", error);
    }
  }

  window.addEventListener("dart:admin-authenticated", () => {
    adminPollingEnabled = true;
  });
  window.addEventListener("online", checkAll);
  window.addEventListener("focus", checkAll);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAll();
  });
  window.setInterval(checkAll, 12000);

  window.DartDomainState = {
    hydrateAll,
    hydrateDomain,
    syncDomain,
    checkAll,
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
