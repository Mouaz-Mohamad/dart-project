(function () {
  "use strict";

  const API_BASE = String(
    window.DART_API_BASE_URL || location.origin,
  ).replace(/\/$/, "");
  const authView = document.getElementById("dart-admin-auth");
  const authCard = authView?.querySelector(".dart-admin-auth-card");
  const googleView = document.getElementById("dart-admin-google-view");
  const googleButton = document.getElementById("dart-admin-google-button");
  const googleLoading = document.getElementById("dart-admin-google-loading");
  const legacyToggle = document.getElementById("dart-admin-legacy-toggle");
  const loginForm = document.getElementById("dart-admin-login-form");
  const onboardingEmailForm = document.getElementById("dart-admin-onboarding-email-form");
  const onboardingCodeForm = document.getElementById("dart-admin-onboarding-code-form");
  const onboardingPasswordForm = document.getElementById("dart-admin-onboarding-password-form");
  const firstTimeButton = document.getElementById("dart-admin-first-time");
  const onboardingResendButton = document.getElementById("dart-admin-onboarding-resend");
  const mfaForm = document.getElementById("dart-admin-mfa-form");
  const logoutButton = document.getElementById("dart-admin-logout");

  const HYDRATION_TIMEOUT_MS = 12_000;
  const SUPABASE_JS_CDN =
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const GOOGLE_GSI_CDN = "https://accounts.google.com/gsi/client";
  const UNAUTHORIZED_MESSAGE =
    "This Google account is not authorized to access the Dart dashboard.";

  let onboardingChallengeId = "";
  let onboardingSetupToken = "";
  let onboardingEmail = "";
  let csrfMemory = "";
  let compatibilityPromise = null;
  let googleConfigPromise = null;
  let supabaseClient = null;
  let currentGoogleNonce = "";
  let permissionSet = new Set();

  if (!API_BASE || !authView || !authCard || !googleView || !googleButton || !logoutButton) {
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
      const error = new Error("Unable to reach the Dart API. Check your connection and try again.");
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
          !capabilities.has("staff-google-auth-v1") ||
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

  function showAuthView(view) {
    [
      googleView,
      loginForm,
      onboardingEmailForm,
      onboardingCodeForm,
      onboardingPasswordForm,
      mfaForm,
    ]
      .filter(Boolean)
      .forEach((node) => {
        node.hidden = node !== view;
      });
  }

  function showGoogleView() {
    showAuthView(googleView);
  }

  function resetOnboarding() {
    onboardingChallengeId = "";
    onboardingSetupToken = "";
    onboardingEmail = "";
    onboardingEmailForm?.reset();
    onboardingCodeForm?.reset();
    onboardingPasswordForm?.reset();
  }

  function setGoogleLoading(loading, message = "Verifying your Google account…") {
    googleButton.hidden = Boolean(loading);
    if (googleLoading) {
      googleLoading.hidden = !loading;
      const text = googleLoading.querySelector("span");
      if (text) text.textContent = message;
    }
    googleView.setAttribute("aria-busy", loading ? "true" : "false");
  }

  function clearAdminPrivateCache() {
    window.DartState?.clearBusiness?.();
    csrfMemory = "";
    permissionSet = new Set();
  }

  function lock() {
    document.body.classList.add("dart-admin-locked");
    authView.hidden = false;
    logoutButton.hidden = true;
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
      if (
        can("dashboard_state.read") &&
        window.DartDomainState?.hydrateAll
      ) {
        await hydrateStage(
          "dashboard-state",
          () => window.DartDomainState.hydrateAll(),
        );
      }
    } catch (error) {
      const stage = error?.dartHydrationStage || "database";
      window.DartAdminHydration = Object.freeze({
        ready: false,
        stage,
        code: error?.code || "DASHBOARD_HYDRATION_FAILED",
      });
      lock();
      status(
        googleView,
        `Database connection failed while loading ${stage}. Dashboard remains locked.`,
        true,
      );
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

  function loadExternalScript(src, ready) {
    if (ready()) return Promise.resolve();
    const existing = document.querySelector(`script[data-dart-auth-src="${src}"]`);
    if (existing) {
      return new Promise((resolve, reject) => {
        if (ready()) {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.dartAuthSrc = src;
      script.referrerPolicy = "no-referrer";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("Authentication provider script failed to load.")),
        { once: true },
      );
      document.head.appendChild(script);
    });
  }

  function randomNonce() {
    if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
      throw new Error("Secure browser cryptography is unavailable.");
    }
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
  }

  async function hashNonce(nonce) {
    const encoded = new TextEncoder().encode(nonce);
    const hash = await window.crypto.subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function googleAuthConfig() {
    if (!googleConfigPromise) {
      googleConfigPromise = request("/api/v1/admin/auth/google/config")
        .catch((error) => {
          googleConfigPromise = null;
          throw error;
        });
    }
    return googleConfigPromise;
  }

  async function clearEphemeralSupabaseSession() {
    if (!supabaseClient?.auth?.signOut) return;
    try {
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch {
      // The Dart session is authoritative after exchange. Local cleanup is best-effort.
    }
  }

  function friendlyGoogleError(error) {
    if (
      error?.code === "DASHBOARD_ACCESS_DENIED" ||
      error?.status === 403
    ) {
      return UNAUTHORIZED_MESSAGE;
    }
    if (
      error?.code === "SUPABASE_AUTH_UNAVAILABLE" ||
      error?.code === "GOOGLE_AUTH_NOT_CONFIGURED"
    ) {
      return "Google sign-in is temporarily unavailable. Please try again shortly.";
    }
    if (error?.code === "NETWORK_ERROR") {
      return "Network error. Check your connection and try again.";
    }
    return "Google sign-in could not be completed. Please try again.";
  }

  async function exchangeGoogleCredential(credential) {
    if (!supabaseClient || !currentGoogleNonce || !credential) {
      throw new Error("Google sign-in was cancelled or did not complete.");
    }

    const result = await supabaseClient.auth.signInWithIdToken({
      provider: "google",
      token: credential,
      nonce: currentGoogleNonce,
    });
    if (result.error) throw result.error;

    const accessToken = result.data?.session?.access_token;
    if (!accessToken) {
      throw new Error("Google sign-in did not produce a valid session.");
    }

    return request("/api/v1/admin/auth/google/exchange", {
      method: "POST",
      body: { accessToken },
    });
  }

  async function renderGoogleButton(config) {
    currentGoogleNonce = randomNonce();
    const hashedNonce = await hashNonce(currentGoogleNonce);
    googleButton.replaceChildren();

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async (credentialResponse) => {
        setGoogleLoading(true);
        status(googleView, "");
        try {
          const payload = await exchangeGoogleCredential(
            credentialResponse?.credential || "",
          );
          if (payload.user?.accountType !== "staff") {
            throw new Error("Staff account required");
          }
          setAdminAccess(payload);
          await clearEphemeralSupabaseSession();
          await unlock();
        } catch (error) {
          await clearEphemeralSupabaseSession();
          lock();
          showGoogleView();
          status(googleView, friendlyGoogleError(error), true);
          setGoogleLoading(false);
          await renderGoogleButton(config).catch(() => undefined);
        }
      },
      nonce: hashedNonce,
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      itp_support: true,
    });

    window.google.accounts.id.renderButton(googleButton, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "left",
      width: 320,
    });
    setGoogleLoading(false);
  }

  async function initializeGoogleSignIn() {
    showGoogleView();
    setGoogleLoading(true, "Loading secure Google sign-in…");
    status(googleView, "");
    try {
      await ensureApiCompatibility();
      const config = await googleAuthConfig();
      legacyToggle.hidden = !(
        config.legacyUiEnabled === true
      );
      if (
        !config.enabled ||
        !config.supabaseUrl ||
        !config.supabasePublishableKey ||
        !config.googleClientId
      ) {
        throw Object.assign(
          new Error("Google sign-in is not configured."),
          { code: "GOOGLE_AUTH_NOT_CONFIGURED" },
        );
      }

      await Promise.all([
        loadExternalScript(
          SUPABASE_JS_CDN,
          () => Boolean(window.supabase?.createClient),
        ),
        loadExternalScript(
          GOOGLE_GSI_CDN,
          () => Boolean(window.google?.accounts?.id),
        ),
      ]);

      supabaseClient = window.supabase.createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );
      await renderGoogleButton(config);
    } catch (error) {
      setGoogleLoading(false);
      status(googleView, friendlyGoogleError(error), true);
      legacyToggle.hidden = true;
    }
  }

  async function beginLegacyMfaSetup() {
    const setup = await request("/api/v1/admin/auth/mfa/setup", {
      method: "POST",
    });
    showAuthView(mfaForm);
    document.getElementById("dart-admin-mfa-secret").textContent = setup.secret;
    document.getElementById("dart-admin-mfa-uri").value = setup.otpauthUri;
    mfaForm.elements.token.focus();
  }

  legacyToggle?.addEventListener("click", () => {
    showAuthView(loginForm);
    loginForm.elements.identifier.focus();
  });

  document.querySelectorAll("[data-admin-back-google]").forEach((button) => {
    button.addEventListener("click", () => {
      loginForm?.reset();
      resetOnboarding();
      showGoogleView();
    });
  });

  firstTimeButton?.addEventListener("click", () => {
    resetOnboarding();
    showAuthView(onboardingEmailForm);
    onboardingEmailForm.elements.email.focus();
  });

  document.querySelectorAll("[data-admin-back-login]").forEach((button) => {
    button.addEventListener("click", () => {
      resetOnboarding();
      showAuthView(loginForm);
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
      await ensureApiCompatibility();
      const payload = await request("/api/v1/admin/auth/onboarding/start", {
        method: "POST",
        body: { email: onboardingEmailForm.elements.email.value.trim() },
      });
      onboardingChallengeId = payload.challengeId || "";
      onboardingEmail = onboardingEmailForm.elements.email.value.trim();
      showAuthView(onboardingCodeForm);
      status(
        onboardingCodeForm,
        "If this email is invited for the temporary rollback path, a verification code was sent.",
      );
      onboardingCodeForm.elements.code.focus();
    } catch (error) {
      status(onboardingEmailForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  onboardingResendButton?.addEventListener("click", async () => {
    if (!onboardingEmail) return;
    onboardingResendButton.disabled = true;
    try {
      const payload = await request("/api/v1/admin/auth/onboarding/resend", {
        method: "POST",
        body: { email: onboardingEmail },
      });
      onboardingChallengeId = payload.challengeId || "";
      status(onboardingCodeForm, "A fresh legacy verification code was requested.");
      onboardingCodeForm.elements.code.value = "";
      onboardingCodeForm.elements.code.focus();
    } catch (error) {
      status(onboardingCodeForm, error.message, true);
    } finally {
      onboardingResendButton.disabled = false;
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
      showAuthView(onboardingPasswordForm);
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
        await beginLegacyMfaSetup();
      } else {
        await unlock();
      }
    } catch (error) {
      status(onboardingPasswordForm, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.checkValidity()) {
      loginForm.reportValidity();
      return;
    }
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await ensureApiCompatibility();
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
      if (payload.user?.accountType !== "staff") {
        throw new Error("Staff account required");
      }
      setAdminAccess(payload);
      if (payload.mfaSetupRequired) {
        await beginLegacyMfaSetup();
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

  mfaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!mfaForm.checkValidity()) {
      mfaForm.reportValidity();
      return;
    }
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
      await clearEphemeralSupabaseSession();
      clearAdminPrivateCache();
      lock();
      loginForm?.reset();
      resetOnboarding();
      showGoogleView();
      location.reload();
    }
  });

  lock();
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
      if (error?.code === "API_VERSION_MISMATCH") {
        showGoogleView();
        status(googleView, error.message, true);
        return;
      }
      await initializeGoogleSignIn();
    }
  })();
})();
