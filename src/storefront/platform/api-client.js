  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }

  let csrfMemory = "";

  async function apiRequest(path, options = {}) {
    if (!API_BASE)
      throw Object.assign(new Error("API_NOT_CONFIGURED"), {
        code: "API_NOT_CONFIGURED",
      });
    const method = String(options.method || "GET").toUpperCase();
    const csrfToken =
      csrfMemory ||
      document.cookie
        .split("; ")
        .find((row) => row.startsWith("dart_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
          ? { "X-CSRF-Token": decodeURIComponent(csrfToken) }
          : {}),
        ...(options.headers || {}),
      },
      body:
        options.body && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.csrfToken) csrfMemory = payload.csrfToken;
    if (!response.ok)
      throw Object.assign(
        new Error(payload?.error?.message || payload.message || "Request failed"),
        {
        status: response.status,
        payload,
        code: payload?.error?.code,
        details: payload?.error?.details,
      },
      );
    return payload;
  }

