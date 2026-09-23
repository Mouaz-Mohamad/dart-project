// DART CODE GUIDE | Js/dart-auth-social.js
// الغرض: واجهة Google/Facebook للعملاء؛ لا تحمل أي OAuth secret وكل التحقق الحقيقي يتم في Backend.
(() => {
  "use strict";

  const API_BASE = String(
    window.DART_API_BASE_URL || window.DartApi?.baseUrl || location.origin,
  ).replace(/\/$/, "");
  let providerAvailability = { google: false, facebook: false };
  let socialToken = "";

  function requestedDestination(value = "") {
    const requested = value || new URLSearchParams(location.search).get("next") || "";
    return requested === "checkout" ? "checkout" : "profile";
  }

  function destinationUrl(next) {
    return requestedDestination(next) === "checkout"
      ? "cart-checkout.html"
      : "profile.html";
  }

  function setAuthStatus(message, isError = false) {
    const form = document.getElementById("loginForm") || document.getElementById("registerForm");
    if (!form) return;
    let status = form.querySelector(".form-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "form-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      form.appendChild(status);
    }
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError));
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      cache: "no-store",
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Social sign-in failed");
      error.code = payload?.error?.code || "SOCIAL_AUTH_FAILED";
      throw error;
    }
    return payload;
  }

  function providerLabel(provider) {
    return provider === "facebook" ? "Facebook" : "Google";
  }

  function bindSocialButtons() {
    document.querySelectorAll("[data-social-login]").forEach((link) => {
      if (link.dataset.dartSocialBound === "1") return;
      link.dataset.dartSocialBound = "1";
      const provider = String(link.dataset.socialLogin || "").toLowerCase();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (!providerAvailability[provider]) {
          setAuthStatus(`${providerLabel(provider)} sign-in is not configured yet.`, true);
          return;
        }
        const next = requestedDestination();
        location.assign(
          `${API_BASE}/api/v1/auth/social/${encodeURIComponent(provider)}/start?next=${encodeURIComponent(next)}`,
        );
      });
    });
  }

  function applyProviderState() {
    document.querySelectorAll("[data-social-login]").forEach((link) => {
      const provider = String(link.dataset.socialLogin || "").toLowerCase();
      const enabled = Boolean(providerAvailability[provider]);
      link.setAttribute("aria-disabled", String(!enabled));
      link.title = enabled
        ? `Continue with ${providerLabel(provider)}`
        : `${providerLabel(provider)} sign-in is not configured yet`;
    });
  }

  async function loadProviders() {
    try {
      const payload = await api("/api/v1/auth/social/providers");
      providerAvailability = {
        google: payload?.providers?.google === true,
        facebook: payload?.providers?.facebook === true,
      };
    } catch {
      providerAvailability = { google: false, facebook: false };
    }
    applyProviderState();
  }

  function ensureStyle() {
    if (document.getElementById("dart-social-auth-style")) return;
    const style = document.createElement("style");
    style.id = "dart-social-auth-style";
    style.textContent = `
      .dart-social-completion{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:16px;background:rgba(15,23,42,.58);overflow:auto}
      .dart-social-completion-card{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 22px 70px rgba(0,0,0,.28);color:#2b1520;text-align:left}
      .dart-social-completion-card h2{margin:0 0 6px;font-size:22px}.dart-social-completion-card>p{margin:0 0 14px;color:#666;line-height:1.5}
      .dart-social-completion-card label{display:grid;gap:5px;margin:10px 0;font-size:12px;font-weight:700}.dart-social-completion-card input{width:100%;min-height:42px;border:1px solid #d7d7d7;border-radius:8px;padding:9px 11px;font:inherit;background:#fff;color:#222}
      .dart-social-completion-card input[readonly]{background:#f6f6f6;color:#666}.dart-social-completion-actions{display:flex;gap:8px;margin-top:14px}.dart-social-completion-actions button{min-height:40px;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}.dart-social-completion-submit{flex:1;background:#ab012b;color:white}.dart-social-completion-cancel{background:#eee;color:#222}
      .dart-social-completion .form-status{min-height:18px;margin:10px 0 0;color:#555}.dart-social-completion .form-status.is-error{color:#a40000}.dart-social-password-rule{font-size:11px!important;color:#666;margin:-3px 0 8px!important}
    `;
    document.head.appendChild(style);
  }

  function field(label, name, type = "text", options = {}) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    if (options.value) input.value = options.value;
    if (options.required !== false) input.required = true;
    if (options.readonly) input.readOnly = true;
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    if (options.minLength) input.minLength = options.minLength;
    if (options.inputMode) input.inputMode = options.inputMode;
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  function closeCompletion() {
    document.querySelector(".dart-social-completion")?.remove();
    socialToken = "";
  }

  async function showCompletion(challenge) {
    ensureStyle();
    document.querySelector(".dart-social-completion")?.remove();
    const overlay = document.createElement("section");
    overlay.className = "dart-social-completion";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${providerLabel(challenge.provider)} Dart account setup`);
    const card = document.createElement("form");
    card.className = "dart-social-completion-card";
    card.noValidate = true;
    const heading = document.createElement("h2");
    heading.textContent = `Continue with ${providerLabel(challenge.provider)}`;
    const intro = document.createElement("p");
    intro.textContent = challenge.accountExists
      ? "Confirm your Dart password and birthday to finish this social sign-in. Your saved birthday will not be overwritten here."
      : "Finish your Dart account once. Google/Facebook verifies your email; Dart still needs your phone, birthday and a local password.";
    card.append(heading, intro);

    const email = field("Verified email", "socialEmail", "email", {
      value: challenge.email || "",
      readonly: true,
      required: false,
    });
    card.appendChild(email.wrapper);

    if (challenge.phoneRequired) {
      const name = field("Full name", "name", "text", {
        value: challenge.name || "",
        autocomplete: "name",
        minLength: 3,
      });
      const phone1 = field("Phone number", "phone1", "tel", {
        autocomplete: "tel",
        inputMode: "tel",
      });
      const phone2 = field("Phone number 2 (optional)", "phone2", "tel", {
        required: false,
        inputMode: "tel",
      });
      card.append(name.wrapper, phone1.wrapper, phone2.wrapper);
    }

    const password = field("Dart password", "password", "password", {
      autocomplete: challenge.accountExists ? "current-password" : "new-password",
      minLength: 6,
    });
    const confirmation = field("Confirm password", "confirmation", "password", {
      autocomplete: challenge.accountExists ? "current-password" : "new-password",
      minLength: 6,
    });
    const rule = document.createElement("p");
    rule.className = "dart-social-password-rule";
    rule.textContent = "Minimum 6 characters. Letters, numbers and symbols are all allowed.";
    const birthday = field("Birthday", "birthday", "date", {
      autocomplete: "bday",
    });
    card.append(password.wrapper, confirmation.wrapper, rule, birthday.wrapper);

    const actions = document.createElement("div");
    actions.className = "dart-social-completion-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "dart-social-completion-cancel";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "dart-social-completion-submit";
    submit.textContent = challenge.accountExists ? "Sign in" : "Create Dart account";
    actions.append(cancel, submit);
    const status = document.createElement("p");
    status.className = "form-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    card.append(actions, status);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    cancel.addEventListener("click", closeCompletion);
    card.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!card.checkValidity()) return card.reportValidity();
      if (password.input.value !== confirmation.input.value) {
        status.textContent = "Passwords do not match.";
        status.classList.add("is-error");
        confirmation.input.focus();
        return;
      }
      submit.disabled = true;
      cancel.disabled = true;
      status.textContent = "Finishing your Dart sign-in…";
      status.classList.remove("is-error");
      const values = Object.fromEntries(new FormData(card));
      try {
        await api("/api/v1/auth/social/complete", {
          method: "POST",
          body: {
            token: socialToken,
            password: values.password,
            confirmation: values.confirmation,
            birthday: values.birthday,
            ...(challenge.phoneRequired
              ? {
                  name: values.name,
                  phone1: values.phone1,
                  ...(String(values.phone2 || "").trim()
                    ? { phone2: values.phone2 }
                    : {}),
                }
              : {}),
          },
        });
        await window.DartPlatform?.hydrateApiSession?.();
        await window.DartPlatform?.claimGuestCartAfterAuth?.();
        location.replace(destinationUrl(challenge.next));
      } catch (error) {
        status.textContent = error?.message || "Social sign-in failed.";
        status.classList.add("is-error");
        submit.disabled = false;
        cancel.disabled = false;
      }
    });
    password.input.focus();
  }

  async function resumeFromFragment() {
    if (!location.hash || location.hash.length < 2) return;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const errorCode = fragment.get("social_error");
    const token = fragment.get("social_token") || "";
    if (!errorCode && !token) return;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (errorCode) {
      setAuthStatus(
        errorCode === "SOCIAL_AUTH_CANCELLED"
          ? "Social sign-in was cancelled."
          : "Social sign-in could not be completed. Please try again.",
        true,
      );
      return;
    }
    socialToken = token;
    try {
      const challenge = await api(
        `/api/v1/auth/social/challenge?token=${encodeURIComponent(token)}`,
      );
      await showCompletion(challenge);
    } catch (error) {
      socialToken = "";
      setAuthStatus(error?.message || "This social sign-in request expired. Please try again.", true);
    }
  }

  async function boot() {
    bindSocialButtons();
    await loadProviders();
    await resumeFromFragment();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    void boot();
  }
})();
