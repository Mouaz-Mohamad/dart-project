(function () {
  "use strict";

  const API_BASE = String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const CSRF_STORAGE_KEY = "dart_csrf_token";
  const DOMAIN_BY_STORAGE = Object.freeze({
    dart_customers: "customers",
    dart_returns: "returns",
    dart_reviews: "reviews",
    dart_cards: "cards",
    dart_representatives: "representatives",
    dart_damage: "damage",
    dart_notifications: "notifications",
    dart_contact_messages: "contacts",
    dart_finance_expenses: "finance_expenses",
    dart_finance_budgets: "finance_budgets",
    dart_finance_invoices: "finance_invoices",
    dart_finance_goals: "finance_goals",
    dart_finance_marketing: "finance_marketing",
    dart_finance_cod_settlements: "finance_settlements",
  });
  const STORAGE_BY_DOMAIN = Object.freeze(
    Object.fromEntries(Object.entries(DOMAIN_BY_STORAGE).map(([key, domain]) => [domain, key])),
  );
  const versions = new Map();
  const dirty = new Set();
  const timers = new Map();
  const queues = new Map();

  function readLocal(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function cache(storageKey, data, domain) {
    const value = Array.isArray(data) ? data : [];
    localStorage.setItem(storageKey, JSON.stringify(value));
    window.dispatchEvent(
      new CustomEvent("dart:domain-hydrated", {
        detail: { domain, storageKey, version: versions.get(domain) || 0, data: value },
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
      const error = new Error(payload?.error?.message || "Dashboard state request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  async function hydrateDomain(domain, force = false) {
    const storageKey = STORAGE_BY_DOMAIN[domain];
    if (!storageKey) return [];
    const local = readLocal(storageKey);
    let payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`);
    versions.set(domain, Number(payload.version || 1));

    if (!force && (payload.data || []).length === 0 && local.length > 0) {
      payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`, {
        method: "PUT",
        body: {
          expectedVersion: versions.get(domain),
          data: local,
        },
      });
      versions.set(domain, Number(payload.version || versions.get(domain)));
    }

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
        data: readLocal(storageKey),
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
      localStorage.setItem(storageKey, JSON.stringify(data));
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(Array.isArray(data) ? data : []));
    dirty.add(domain);
    schedule(domain);
  }

  async function hydrateAll() {
    const domains = Object.keys(STORAGE_BY_DOMAIN);
    const results = await Promise.all(domains.map((domain) => hydrateDomain(domain)));
    return Object.fromEntries(domains.map((domain, index) => [domain, results[index]]));
  }

  async function checkDomain(domain) {
    if (document.hidden) return;
    try {
      if (!versions.get(domain)) {
        await hydrateDomain(domain);
        return;
      }
      if (dirty.has(domain)) {
        await syncDomain(domain);
        return;
      }
      const payload = await api(`/api/v1/admin/domain-state/${encodeURIComponent(domain)}`);
      const remoteVersion = Number(payload.version || 0);
      if (remoteVersion && remoteVersion !== versions.get(domain)) {
        versions.set(domain, remoteVersion);
        cache(STORAGE_BY_DOMAIN[domain], payload.data || [], domain);
      }
    } catch (error) {
      if (error.status !== 401) console.warn(`Dart ${domain} live refresh failed`, error);
    }
  }

  async function checkAll() {
    await Promise.all(Object.keys(STORAGE_BY_DOMAIN).map((domain) => checkDomain(domain)));
  }

  window.addEventListener("online", checkAll);
  window.addEventListener("focus", checkAll);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAll();
  });
  window.setInterval(checkAll, 5000);

  window.DartDomainState = {
    hydrateAll,
    hydrateDomain,
    syncDomain,
    checkAll,
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