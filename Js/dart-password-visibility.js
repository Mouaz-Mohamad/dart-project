// DART CODE GUIDE | Js/dart-password-visibility.js
// Adds accessible show/hide controls to every password input without changing form behavior.
(() => {
  "use strict";

  const BUTTON_CLASS = "dart-password-visibility-toggle";
  const CUSTOMER_PASSWORD_SELECTORS = [
    '#registerForm input[name="password"]',
    '#customerChangePasswordForm input[name="password"]',
    '#customerChangePasswordForm input[name="confirmPassword"]',
    '#customerAccountPasswordForm input[name="password"]',
    '#customerAccountPasswordForm input[name="confirmPassword"]',
    '#dartPasswordResetCompleteForm input[name="password"]',
    '#dartPasswordResetCompleteForm input[name="confirmation"]',
    '.dart-social-completion input[name="password"]',
    '.dart-social-completion input[name="confirmation"]',
  ].join(",");

  function buttonIcon(visible) {
    return visible
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.9 10.9 0 0 1 12 4c5.5 0 9 5.3 9 8a8.5 8.5 0 0 1-2.1 3.7M6.6 6.6C4.3 8 3 10.5 3 12c0 2.7 3.5 8 9 8 1.4 0 2.7-.3 3.8-.8"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c0-2.7 3.5-8 9-8s9 5.3 9 8-3.5 8-9 8-9-5.3-9-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function normalizeCustomerPasswordFields(root = document) {
    root.querySelectorAll?.(CUSTOMER_PASSWORD_SELECTORS).forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.minLength = 6;
      input.removeAttribute("pattern");
      input.title = "Use at least 6 characters. Letters, numbers and symbols are allowed.";
      if (input.closest("#registerForm") && input.name === "password") {
        input.placeholder = "Password (6+ characters)";
      }
    });
    const rule = document.querySelector("#registerForm .password-rule");
    if (rule) {
      rule.textContent = "6+ characters — letters, numbers and symbols are all allowed.";
    }
  }

  function loadCustomerSocialAuth() {
    if (
      !document.querySelector("[data-social-login]") ||
      document.querySelector('script[data-dart-social-auth="1"]')
    ) return;
    const script = document.createElement("script");
    script.src = "Js/dart-auth-social.js";
    script.defer = true;
    script.dataset.dartSocialAuth = "1";
    document.body.appendChild(script);
  }

  function position(button, input, host) {
    const right = Math.max(8, host.clientWidth - input.offsetLeft - input.offsetWidth + 8);
    button.style.top = `${input.offsetTop + input.offsetHeight / 2}px`;
    button.style.right = `${right}px`;
  }

  function enhance(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.dartPasswordVisibility === "1") return;
    input.dataset.dartPasswordVisibility = "1";
    const host = input.parentElement;
    if (!host) return;
    host.classList.add("dart-password-visibility-host");
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute("aria-label", "Show password");
    button.setAttribute("aria-pressed", "false");
    button.title = "Show password";
    button.innerHTML = buttonIcon(false);
    button.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.setAttribute("aria-pressed", String(!visible));
      button.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      button.title = visible ? "Show password" : "Hide password";
      button.innerHTML = buttonIcon(!visible);
      input.focus({ preventScroll: true });
    });
    host.appendChild(button);
    requestAnimationFrame(() => position(button, input, host));
  }

  function scan(root = document) {
    normalizeCustomerPasswordFields(root);
    root.querySelectorAll?.('input[type="password"]').forEach(enhance);
  }

  const style = document.createElement("style");
  style.textContent = `
    .dart-password-visibility-host{position:relative}
    .dart-password-visibility-toggle{position:absolute;z-index:5;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:transparent;display:grid;place-items:center;cursor:pointer;color:currentColor;padding:7px}
    .dart-password-visibility-toggle:hover,.dart-password-visibility-toggle:focus-visible{background:rgba(127,127,127,.12);outline:2px solid rgba(171,1,43,.25);outline-offset:1px}
    .dart-password-visibility-toggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
    .dart-password-visibility-host input[type="password"],.dart-password-visibility-host input[type="text"][data-dart-password-visibility="1"]{padding-right:52px!important}
  `;
  document.head.appendChild(style);

  const boot = () => {
    scan();
    loadCustomerSocialAuth();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('input[type="password"]')) enhance(node);
        scan(node);
      }));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", () => {
      document.querySelectorAll('input[data-dart-password-visibility="1"]').forEach((input) => {
        const host = input.parentElement;
        const button = host?.querySelector(`:scope > .${BUTTON_CLASS}`);
        if (host && button) position(button, input, host);
      });
    }, { passive: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
