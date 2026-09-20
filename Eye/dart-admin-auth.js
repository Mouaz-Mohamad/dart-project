(function () {
  "use strict";

  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const CSRF_STORAGE_KEY = "dart_csrf_token";
  const authView = document.getElementById("dart-admin-auth");
  const loginForm = document.getElementById("dart-admin-login-form");
  const onboardingEmailForm = document.getElementById("dart-admin-onboarding-email-form");
  const onboardingCodeForm = document.getElementById("dart-admin-onboarding-code-form");
  const onboardingPasswordForm = document.getElementById("dart-admin-onboarding-password-form");
  const firstTimeButton = document.getElementById("dart-admin-first-time");
  const mfaForm = document.getElementById("dart-admin-mfa-form");
  const logoutButton = document.getElementById("dart-admin-logout");
  let onboardingChallengeId = "";
  let onboardingSetupToken = "";
  let csrfMemory = "";

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
    if (csrfMemory) return csrfMemory;
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
    if (payload?.csrfToken) csrfMemory = payload.csrfToken;
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Request failed");
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  let permissionSet = new Set();

  function setAdminAccess(payload) {
    permissionSet = new Set(Array.isArray(payload?.permissions) ? payload.permissions : []);
    window.DartAdminAccess = Object.freeze({
      can(permission) {
        return permissionSet.has(permission);
      },
      list() {
        return [...permissionSet];
      },
    });
  }

  window.DartAdminApi = Object.freeze({
    request,
    baseUrl: API_BASE,
  });

  function showAuthForm(form) {
    [loginForm, onboardingEmailForm, onboardingCodeForm, onboardingPasswordForm, mfaForm]
      .filter(Boolean)
      .forEach((node) => {
        node.hidden = node !== form;
      });
  }

  function resetOnboarding() {
    onboardingChallengeId = "";
    onboardingSetupToken = "";
    onboardingEmailForm?.reset();
    onboardingCodeForm?.reset();
    onboardingPasswordForm?.reset();
  }

  function status(form, message, isError = false) {
    const element = form.querySelector(".dart-admin-auth-status");
    element.textContent = message;
    element.classList.toggle("is-error", isError);
  }

  function clearAdminPrivateCache() {
    window.DartState?.clearBusiness?.();
    csrfMemory = "";
  }

  function lock() {
    document.body.classList.add("dart-admin-locked");
    authView.hidden = false;
    logoutButton.hidden = true;
  }

  async function unlock() {
    const can = (permission) => window.DartAdminAccess?.can?.(permission) === true;
    try {
      if (window.DartSiteSettings?.hydrate) {
        await window.DartSiteSettings.hydrate(!can("settings.manage"));
      }
      if (can("catalog.manage") && window.DartCatalog?.hydrate) {
        await window.DartCatalog.hydrate();
      } else {
        window.DartState?.remove?.("dart_models");
        window.DartState?.remove?.("dart_items");
      }
      if (can("orders.read") && window.DartOrdersApi?.hydrate) {
        await window.DartOrdersApi.hydrate();
      } else {
        window.DartState?.remove?.("dart_orders");
      }
      if (can("dashboard_state.read") && window.DartDomainState?.hydrateAll) {
        await window.DartDomainState.hydrateAll();
      }
    } catch (error) {
      console.error("Unable to hydrate dashboard state after sign-in", error);
      lock();
      status(loginForm, "Database connection failed. Dashboard remains locked.", true);
      throw error;
    }
    document.body.classList.remove("dart-admin-locked");
    authView.hidden = true;
    logoutButton.hidden = false;
    window.dispatchEvent(new CustomEvent("dart:admin-authenticated"));
  }

  async function beginMfaSetup() {
    const setup = await request("/api/v1/admin/auth/mfa/setup", { method: "POST" });
    showAuthForm(mfaForm);
    document.getElementById("dart-admin-mfa-secret").textContent = setup.secret;
    document.getElementById("dart-admin-mfa-uri").value = setup.otpauthUri;
    mfaForm.elements.token.focus();
  }

  firstTimeButton?.addEventListener("click", () => {
    resetOnboarding();
    showAuthForm(onboardingEmailForm);
    onboardingEmailForm.elements.email.focus();
  });

  document.querySelectorAll("[data-admin-back-login]").forEach((button) => {
    button.addEventListener("click", () => {
      resetOnboarding();
      showAuthForm(loginForm);
      loginForm.elements.identifier.focus();
    });
  });

  onboardingEmailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!onboardingEmailForm.checkValidity()) {
      onboardingEmailForm.reportValidity();
      return;
    }
    const submit = onboardingEmailForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/onboarding/start", {
        method: "POST",
        body: { email: onboardingEmailForm.elements.email.value.trim() },
      });
      onboardingChallengeId = payload.challengeId || "";
      showAuthForm(onboardingCodeForm);
      status(
        onboardingCodeForm,
        "If this email is invited, a verification code has been sent.",
      );
      onboardingCodeForm.elements.code.focus();
    } catch (error) {
      status(onboardingEmailForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  onboardingCodeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!onboardingCodeForm.checkValidity()) {
      onboardingCodeForm.reportValidity();
      return;
    }
    const submit = onboardingCodeForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/onboarding/verify", {
        method: "POST",
        body: {
          challengeId: onboardingChallengeId,
          code: onboardingCodeForm.elements.code.value.trim(),
        },
      });
      onboardingSetupToken = payload.setupToken || "";
      showAuthForm(onboardingPasswordForm);
      onboardingPasswordForm.elements.credential.focus();
    } catch (error) {
      status(onboardingCodeForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  onboardingPasswordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!onboardingPasswordForm.checkValidity()) {
      onboardingPasswordForm.reportValidity();
      return;
    }
    if (
      onboardingPasswordForm.elements.credential.value !==
      onboardingPasswordForm.elements.confirmation.value
    ) {
      status(onboardingPasswordForm, "Passwords do not match.", true);
      return;
    }
    const submit = onboardingPasswordForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/onboarding/complete", {
        method: "POST",
        body: {
          challengeId: onboardingChallengeId,
          setupToken: onboardingSetupToken,
          credential: onboardingPasswordForm.elements.credential.value,
          confirmation: onboardingPasswordForm.elements.confirmation.value,
        },
      });
      if (payload.user?.accountType !== "staff") {
        throw new Error("Staff account required");
      }
      setAdminAccess(payload);
      resetOnboarding();
      if (payload.mfaSetupRequired) {
        await beginMfaSetup();
      } else {
        await unlock();
      }
    } catch (error) {
      status(onboardingPasswordForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

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
      setAdminAccess(payload);
      if (payload.mfaSetupRequired) {
        await beginMfaSetup();
        return;
      }
      await unlock();
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
      await unlock();
    } catch (error) {
      status(mfaForm, error.message, true);
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await request("/api/v1/auth/logout", { method: "POST" });
    } finally {
      clearAdminPrivateCache();
      lock();
      loginForm.reset();
      resetOnboarding();
      showAuthForm(loginForm);
      location.reload();
    }
  });

  lock();
  request("/api/v1/me")
    .then(async (payload) => {
      if (payload.user?.accountType !== "staff") throw new Error("Staff account required");
      setAdminAccess(payload);
      if (payload.session?.mfaRequired && !payload.session?.mfaSatisfied) {
        await beginMfaSetup();
        return;
      }
      await unlock();
    })
    .catch(() => lock());
})();
