(function () {
  "use strict";

  const API_BASE = String(\n    window.DART_API_BASE_URL ||\n      (location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)\n        ? "https://dart-api-dusky.vercel.app"\n        : ""),\n  ).replace(/\/$/, "");
  const authView = document.getElementById("dart-admin-auth");
  const loginForm = document.getElementById("dart-admin-login-form");
  const mfaForm = document.getElementById("dart-admin-mfa-form");
  const logoutButton = document.getElementById("dart-admin-logout");

  if (!API_BASE) {
    if (
      location.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(location.hostname)
    ) {
      document.body.classList.add("dart-admin-locked");
      authView.hidden = false;
      loginForm.hidden = true;
      const message = document.createElement("p");
      message.className = "dart-admin-auth-status is-error";
      message.textContent =
        "Dashboard access is blocked because the secure account API is not configured.";
      authView.querySelector(".dart-admin-auth-card").appendChild(message);
    }
    return;
  }

  function csrfToken() {
    return document.cookie
      .split("; ")
      .find((row) => row.startsWith("dart_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
  }

  async function request(path, options = {}) {
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
      const error = new Error(payload?.error?.message || "Request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  function status(form, message, isError = false) {
    const element = form.querySelector(".dart-admin-auth-status");
    element.textContent = message;
    element.classList.toggle("is-error", isError);
  }

  function lock() {
    document.body.classList.add("dart-admin-locked");
    authView.hidden = false;
    logoutButton.hidden = true;
  }

  function unlock() {
    document.body.classList.remove("dart-admin-locked");
    authView.hidden = true;
    logoutButton.hidden = false;
  }

  async function beginMfaSetup() {
    const setup = await request("/api/v1/admin/auth/mfa/setup", { method: "POST" });
    loginForm.hidden = true;
    mfaForm.hidden = false;
    document.getElementById("dart-admin-mfa-secret").textContent = setup.secret;
    document.getElementById("dart-admin-mfa-uri").value = setup.otpauthUri;
    mfaForm.elements.token.focus();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.checkValidity()) return loginForm.reportValidity();
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/login", {
        method: "POST",
        body: {
          identifier: loginForm.elements.identifier.value,
          password: loginForm.elements.password.value,
          ...(loginForm.elements.totp.value
            ? { totp: loginForm.elements.totp.value }
            : {}),
        },
      });
      if (payload.user?.accountType !== "staff") throw new Error("Staff account required");
      if (payload.mfaSetupRequired) {
        await beginMfaSetup();
        return;
      }
      unlock();
    } catch (error) {
      if (error.code === "MFA_REQUIRED" || error.code === "MFA_INVALID") {
        const field = loginForm.querySelector("[data-admin-totp-field]");
        field.hidden = false;
        field.querySelector("input").required = true;
      }
      status(loginForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  mfaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!mfaForm.checkValidity()) return mfaForm.reportValidity();
    try {
      await request("/api/v1/admin/auth/mfa/confirm", {
        method: "POST",
        body: { token: mfaForm.elements.token.value },
      });
      mfaForm.reset();
      document.getElementById("dart-admin-mfa-secret").textContent = "";
      document.getElementById("dart-admin-mfa-uri").value = "";
      unlock();
    } catch (error) {
      status(mfaForm, error.message, true);
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await request("/api/v1/auth/logout", { method: "POST" });
    } finally {
      lock();
      loginForm.reset();
      loginForm.hidden = false;
      mfaForm.hidden = true;
    }
  });

  lock();
  request("/api/v1/me")
    .then(async (payload) => {
      if (payload.user?.accountType !== "staff") throw new Error("Staff account required");
      if (payload.session?.mfaRequired && !payload.session?.mfaSatisfied) {
        await beginMfaSetup();
        return;
      }
      unlock();
    })
    .catch(() => lock());
})();
