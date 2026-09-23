// DART CODE GUIDE | Eye/dart-admin-auth.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-admin-auth.js
// Dart Eye Staff email verification, secure session bootstrap, and auth gate UI.
// BEGIN MODULE

// Production activation marker: simplified Staff email access + post-launch UI/customer fixes (frontend publish).
(function () {
  "use strict";

  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const authView = document.getElementById("dart-admin-auth");
  const authCard = authView?.querySelector(".dart-admin-auth-card");
  const emailForm = document.getElementById("dart-admin-email-form");
  const codeForm = document.getElementById("dart-admin-code-form");
  const resendButton = document.getElementById("dart-admin-resend");
  const changeEmailButton = document.getElementById("dart-admin-change-email");
  const logoutButton = document.getElementById("dart-admin-logout");

  const HYDRATION_TIMEOUT_MS = 12_000;
  const STAFF_EMAIL_CACHE_KEY = "dart_staff_email";

  let challengeId = "";
  let emailAddress = "";
  try {
    emailAddress = String(localStorage.getItem(STAFF_EMAIL_CACHE_KEY) || "").trim();
    if (emailAddress) emailForm.elements.email.value = emailAddress;
  } catch {}
  let csrfMemory = "";
  let compatibilityPromise = null;
  let permissionSet = new Set();

  if (!API_BASE || !authView || !authCard || !emailForm || !codeForm || !logoutButton) {
    document.body.classList.add("dart-admin-locked");
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
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        cache: options.cache || "no-store",
        method,
        headers: {
          Accept: "application/json",
          ...(!["GET", "HEAD", "OPTIONS"].includes(method)
            ? { "Content-Type": "application/json" }
            : {}),
          ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrf
            ? { "X-CSRF-Token": decodeURIComponent(csrf) }
            : {}),
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (cause) {
      const error = new Error(
        "Unable to reach the Dart API. Check your connection and try again.",
      );
      error.code = "NETWORK_ERROR";
      error.cause = cause;
      throw error;
    }

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

  function ensureApiCompatibility() {
    if (compatibilityPromise) return compatibilityPromise;
    compatibilityPromise = fetch(`${API_BASE}/api/v1/health/live`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        const capabilities = new Set(
          Array.isArray(payload?.capabilities) ? payload.capabilities : [],
        );
        if (
          !response.ok ||
          payload?.apiCompatibility !== "dart-database-v1" ||
          !capabilities.has("staff-email-access-v1") ||
          !capabilities.has("dashboard-domain-state-v1") ||
          !capabilities.has("bulk-domain-state-v1")
        ) {
          const error = new Error(
            "The dashboard and API deployments are not compatible yet. Publish the matching Dart API before signing in.",
          );
          error.code = "API_VERSION_MISMATCH";
          throw error;
        }
        return payload;
      })
      .catch((error) => {
        compatibilityPromise = null;
        throw error;
      });
    return compatibilityPromise;
  }

  function setAdminAccess(payload) {
    permissionSet = new Set(
      Array.isArray(payload?.permissions) ? payload.permissions : [],
    );
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

  function status(container, message, isError = false) {
    const element = container?.querySelector?.(".dart-admin-auth-status");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function show(view) {
    [emailForm, codeForm].forEach((node) => {
      node.hidden = node !== view;
    });
    if (view) {
      status(view, "");
    }
  }

  function clearAdminPrivateCache() {
    window.DartState?.clearBusiness?.();
    csrfMemory = "";
    permissionSet = new Set();
  }

  function resetVerification() {
    challengeId = "";
    codeForm.reset();
    emailForm.reset();
    try { emailAddress = String(localStorage.getItem(STAFF_EMAIL_CACHE_KEY) || "").trim(); }
    catch { emailAddress = ""; }
    if (emailAddress) emailForm.elements.email.value = emailAddress;
  }

  function lock() {
    document.body.classList.add("dart-admin-locked");
    authView.hidden = false;
    logoutButton.hidden = true;
  }

  function isAuthFailure(error) {
    return (
      error?.status === 401 ||
      error?.code === "AUTH_REQUIRED" ||
      error?.code === "SESSION_EXPIRED" ||
      error?.code === "SESSION_INVALID"
    );
  }

  function hydrationFailureMessage(error, stage) {
    if (isAuthFailure(error)) {
      return "Your Dart Eye session expired or is no longer valid. Sign in again.";
    }
    if (error?.code === "NETWORK_ERROR") {
      return `Network error while loading ${stage}. Check your connection and try again.`;
    }
    if (error?.code === "DASHBOARD_HYDRATION_TIMEOUT") {
      return `${stage} took too long to load. Try again; your dashboard data was not changed.`;
    }
    if (error?.status === 403 || error?.code === "DASHBOARD_ACCESS_DENIED") {
      return `Your Staff account does not have permission to load ${stage}.`;
    }
    return `Unable to load ${stage} from the server. Dashboard remains locked to protect your data.`;
  }

  async function hydrateStage(label, task) {
    let timer = 0;
    const work = Promise.resolve()
      .then(task)
      .catch((error) => {
        const failure =
          error instanceof Error
            ? error
            : new Error(String(error || "Dashboard hydration failed"));
        failure.dartHydrationStage = label;
        throw failure;
      });
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        const error = new Error(`${label} hydration timed out`);
        error.code = "DASHBOARD_HYDRATION_TIMEOUT";
        error.dartHydrationStage = label;
        reject(error);
      }, HYDRATION_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function unlock() {
    const can = (permission) =>
      window.DartAdminAccess?.can?.(permission) === true;
    try {
      if (window.DartSiteSettings?.hydrate) {
        await hydrateStage(
          "site-settings",
          () => window.DartSiteSettings.hydrate(!can("settings.manage")),
        );
      }
      if (can("catalog.manage") && window.DartCatalog?.hydrate) {
        await hydrateStage("catalog", () => window.DartCatalog.hydrate());
      } else {
        window.DartState?.remove?.("dart_models");
        window.DartState?.remove?.("dart_items");
      }
      if (can("orders.read") && window.DartOrdersApi?.hydrate) {
        await hydrateStage("orders", () => window.DartOrdersApi.hydrate());
      } else {
        window.DartState?.remove?.("dart_orders");
      }
      if (can("dashboard_state.read") && window.DartDomainState?.hydrateAll) {
        await hydrateStage(
          "dashboard-state",
          () => window.DartDomainState.hydrateAll(),
        );
      }
    } catch (error) {
      const stage = error?.dartHydrationStage || "dashboard data";
      window.DartAdminHydration = Object.freeze({
        ready: false,
        stage,
        code: error?.code || "DASHBOARD_HYDRATION_FAILED",
      });
      if (isAuthFailure(error)) clearAdminPrivateCache();
      lock();
      show(emailForm);
      status(emailForm, hydrationFailureMessage(error, stage), true);
      error.dartAuthHandled = true;
      throw error;
    }

    window.DartAdminHydration = Object.freeze({
      ready: true,
      stage: "complete",
      code: null,
    });
    document.body.classList.remove("dart-admin-locked");
    authView.hidden = true;
    logoutButton.hidden = false;
    window.dispatchEvent(new CustomEvent("dart:admin-authenticated"));
  }

  function friendlyAuthError(error) {
    if (error?.code === "EMAIL_DELIVERY_UNAVAILABLE") {
      return "Dart could not send the email right now. Check SMTP settings and try again.";
    }
    if (
      error?.code === "STAFF_EMAIL_CODE_INVALID" ||
      error?.code === "DASHBOARD_ACCESS_DENIED"
    ) {
      return "The verification code is invalid, expired, or this email is not allowed.";
    }
    if (isAuthFailure(error)) {
      return "Your Dart Eye session is no longer valid. Sign in again.";
    }
    if (error?.code === "NETWORK_ERROR") {
      return "Network error. Check your connection and try again.";
    }
    return error?.message || "Unable to verify dashboard access.";
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!emailForm.checkValidity()) {
      emailForm.reportValidity();
      return;
    }
    const submit = emailForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await ensureApiCompatibility();
      emailAddress = emailForm.elements.email.value.trim();
      try { localStorage.setItem(STAFF_EMAIL_CACHE_KEY, emailAddress); } catch {}
      const payload = await request("/api/v1/admin/auth/email/start", {
        method: "POST",
        body: { email: emailAddress },
      });
      challengeId = payload.challengeId || "";
      show(codeForm);
      status(
        codeForm,
        "If this email is allowed, a 6-digit verification code has been sent.",
      );
      codeForm.elements.code.focus();
    } catch (error) {
      status(emailForm, friendlyAuthError(error), true);
    } finally {
      submit.disabled = false;
    }
  });

  resendButton?.addEventListener("click", async () => {
    if (!emailAddress) {
      show(emailForm);
      if (emailAddress) emailForm.elements.email.value = emailAddress;
      emailForm.elements.email.focus();
      return;
    }
    resendButton.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/email/resend", {
        method: "POST",
        body: { email: emailAddress },
      });
      challengeId = payload.challengeId || "";
      codeForm.elements.code.value = "";
      status(codeForm, "A fresh verification code was requested.");
      codeForm.elements.code.focus();
    } catch (error) {
      status(codeForm, friendlyAuthError(error), true);
    } finally {
      resendButton.disabled = false;
    }
  });

  changeEmailButton?.addEventListener("click", () => {
    challengeId = "";
    codeForm.reset();
    show(emailForm);
    emailForm.elements.email.value = emailAddress;
    emailForm.elements.email.focus();
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!codeForm.checkValidity() || !challengeId) {
      codeForm.reportValidity();
      return;
    }
    const submit = codeForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/email/verify", {
        method: "POST",
        body: {
          challengeId,
          code: codeForm.elements.code.value.trim(),
        },
      });
      if (payload.user?.accountType !== "staff") {
        throw new Error("Staff account required");
      }
      setAdminAccess(payload);
      resetVerification();
      await unlock();
    } catch (error) {
      if (!error?.dartAuthHandled) {
        status(codeForm, friendlyAuthError(error), true);
      }
    } finally {
      submit.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await request("/api/v1/auth/logout", { method: "POST" });
    } finally {
      clearAdminPrivateCache();
      resetVerification();
      lock();
      show(emailForm);
      location.reload();
    }
  });

  lock();
  // Do not flash the email form on every reload. First verify the persistent
  // HttpOnly Staff session; only show the form if that secure session is absent.
  show(null);
  void (async () => {
    try {
      await ensureApiCompatibility();
      const payload = await request("/api/v1/me");
      if (payload.user?.accountType !== "staff") {
        throw new Error("Staff account required");
      }
      setAdminAccess(payload);
      await unlock();
    } catch (error) {
      lock();
      show(emailForm);
      if (error?.code === "API_VERSION_MISMATCH") {
        status(emailForm, error.message, true);
        return;
      }
      if (!error?.dartAuthHandled && isAuthFailure(error)) {
        clearAdminPrivateCache();
      }
      emailForm.elements.email.focus();
    }
  })();
})();

// END MODULE
