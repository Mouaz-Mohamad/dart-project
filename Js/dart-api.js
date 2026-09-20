(function (root) {
  "use strict";

  const BASE = String(root.DART_API_BASE_URL || root.location?.origin || "").replace(/\/$/, "");
  const CSRF_KEY = "dart_csrf_token";

  function csrfToken() {
    const stored = root.localStorage?.getItem(CSRF_KEY);
    if (stored) return stored;
    const cookie = root.document?.cookie
      ?.split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    return cookie ? decodeURIComponent(cookie) : "";
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      ...(options.headers || {}),
    };
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
    const csrf = csrfToken();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrf) {
      headers["X-CSRF-Token"] = csrf;
    }

    const response = await fetch(`${BASE}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...options,
      method,
      headers,
      body:
        options.body && !(options.body instanceof FormData) && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const payload = response.status === 204
      ? {}
      : await response.json().catch(() => ({}));
    if (payload?.csrfToken) root.localStorage?.setItem(CSRF_KEY, payload.csrfToken);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || "Request failed");
      error.status = response.status;
      error.code = payload?.error?.code || "";
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  root.DartApi = Object.freeze({
    isConfigured: Boolean(BASE),
    baseUrl: BASE,
    request,
  });
})(typeof window !== "undefined" ? window : globalThis);
