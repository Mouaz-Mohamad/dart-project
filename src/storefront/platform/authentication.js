  async function register(payload) {
    if (!API_BASE) throw new Error("تعذر إنشاء الحساب لأن خدمة الحسابات غير مهيأة.");
    return apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        name: String(payload.name || "").trim(),
        phone1: String(payload.phone1 || "").trim(),
        email: String(payload.email || "").trim(),
        birthday: String(payload.birthday || "").trim(),
      },
    });
  }

  async function login(identifier) {
    if (!API_BASE) throw new Error("تعذر تسجيل الدخول لأن خدمة الحسابات غير مهيأة.");
    return apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: { identifier: String(identifier || "").trim() },
    });
  }

  async function acceptVerifiedSession(path,challengeId,code) {
    const result=await apiRequest(path,{
      method:"POST",body:{challengeId,code},
    });
    if(result.user) {
      cacheApiUser(result.user);
      await claimGuestCartAfterAuth();
      refreshCustomerCommerceInBackground();
    }
    return result;
  }

  async function verifyLoginOtp(challengeId,code) {
    return acceptVerifiedSession("/api/v1/auth/login/verify",challengeId,code);
  }
  async function verifyRegistrationOtp(challengeId,code) {
    return acceptVerifiedSession("/api/v1/auth/register/verify",challengeId,code);
  }

  function supportsCustomerPasskeys(){
    return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
  }
  function base64ToBytes(value){
    const normalized=String(value).replace(/-/g,"+").replace(/_/g,"/");
    const decoded=atob(normalized+"=".repeat((4-normalized.length%4)%4));
    return Uint8Array.from(decoded,char=>char.charCodeAt(0));
  }
  function bytesToBase64(value){
    const bytes=new Uint8Array(value);
    let binary="";
    for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  async function registerCustomerPasskey(){
    if(!supportsCustomerPasskeys())throw new Error("هذا الجهاز أو المتصفح لا يدعم تسجيل الدخول بالبصمة.");
    const {challengeId,options}=await apiRequest("/api/v1/auth/passkeys/register/options",{method:"POST",body:{}});
    const publicKey={
      ...options,
      challenge:base64ToBytes(options.challenge),
      user:{...options.user,id:base64ToBytes(options.user.id)},
      excludeCredentials:(options.excludeCredentials||[]).map(row=>({...row,id:base64ToBytes(row.id)})),
    };
    const passkey=await navigator.credentials.create({publicKey});
    if(!passkey)throw new Error("تم إلغاء تفعيل البصمة.");
    return apiRequest("/api/v1/auth/passkeys/register/verify",{
      method:"POST",body:{challengeId,credential:{
        id:passkey.id,type:passkey.type,
        response:{
          clientDataJSON:bytesToBase64(passkey.response.clientDataJSON),
          attestationObject:bytesToBase64(passkey.response.attestationObject),
          transports:passkey.response.getTransports?.()||[],
        },
      }},
    });
  }
  async function loginCustomerPasskey(){
    if(!supportsCustomerPasskeys())throw new Error("هذا الجهاز أو المتصفح لا يدعم تسجيل الدخول بالبصمة.");
    const {challengeId,options}=await apiRequest("/api/v1/auth/passkeys/authenticate/options",{method:"POST",body:{}});
    const passkey=await navigator.credentials.get({publicKey:{
      ...options,
      challenge:base64ToBytes(options.challenge),
      allowCredentials:(options.allowCredentials||[]).map(row=>({...row,id:base64ToBytes(row.id)})),
    }});
    if(!passkey)throw new Error("تم إلغاء تسجيل الدخول بالبصمة.");
    const result=await apiRequest("/api/v1/auth/passkeys/authenticate/verify",{
      method:"POST",body:{challengeId,credential:{
        id:passkey.id,type:passkey.type,
        response:{
          clientDataJSON:bytesToBase64(passkey.response.clientDataJSON),
          authenticatorData:bytesToBase64(passkey.response.authenticatorData),
          signature:bytesToBase64(passkey.response.signature),
          userHandle:passkey.response.userHandle?bytesToBase64(passkey.response.userHandle):null,
        },
      }},
    });
    if(result.user){
      cacheApiUser(result.user);
      await claimGuestCartAfterAuth();
      refreshCustomerCommerceInBackground();
    }
    return result;
  }

  async function requestPasswordReset(identifier, accountType = "representative") {
    if (accountType !== "representative") throw new Error("Customer accounts no longer use passwords.");
    if (!API_BASE) throw new Error("Password recovery requires the secure account API.");
    return apiRequest("/api/v1/auth/forgot-password", {
      method: "POST",
      body: { identifier: String(identifier || "").trim(), accountType },
    });
  }

  function ensurePasswordResetDialog() {
    let dialog = document.getElementById("dartPasswordResetDialog");
    if (dialog) return dialog;

    const style = document.createElement("style");
    style.textContent = `
      .dart-reset-dialog{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:20px}
      .dart-reset-dialog[hidden],.dart-reset-card [hidden]{display:none}
      .dart-reset-card{position:relative;width:min(460px,100%);max-height:90vh;overflow:auto;background:#fffaf3;color:#191919;border-radius:22px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
      .dart-reset-card h2{margin:0 0 8px}.dart-reset-card p{line-height:1.55}
      .dart-reset-card form{display:grid;gap:12px;margin-top:18px}
      .dart-reset-card label{display:grid;gap:6px;font-weight:600}
      .dart-reset-card input{width:100%;min-height:46px;border:1px solid rgba(0,0,0,.16);border-radius:12px;padding:10px 12px;background:#fff}
      .dart-reset-actions{display:flex;gap:10px;flex-wrap:wrap}
      .dart-reset-actions button,.dart-reset-submit{min-height:44px;border:0;border-radius:12px;padding:10px 16px;cursor:pointer}
      .dart-reset-submit{background:#ab012b;color:#fff;font-weight:700}
      .dart-reset-secondary{background:#eee;color:#222}
      .dart-reset-close{position:absolute;top:12px;right:14px;border:0;background:transparent;font-size:24px;cursor:pointer}
      .dart-reset-card :focus-visible{outline:3px solid #ab012b;outline-offset:3px}
      .dart-reset-card button:disabled{opacity:.6;cursor:wait}
      .dart-reset-dialog .form-status.is-error{color:#a00024}.dart-reset-dialog .form-status.is-success{color:#176b3a}
    `;
    document.head.appendChild(style);

    dialog = document.createElement("section");
    dialog.id = "dartPasswordResetDialog";
    dialog.className = "dart-reset-dialog";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "dartPasswordResetTitle");
    dialog.innerHTML = `
      <div class="dart-reset-card">
        <button type="button" class="dart-reset-close" data-reset-close aria-label="Close">×</button>
        <h2 id="dartPasswordResetTitle">Reset password</h2>
        <p data-reset-intro>Enter the email, phone, or account ID registered with Dart. The OTP will be sent only to the registered email.</p>
        <form id="dartPasswordResetRequestForm" novalidate>
          <label>Account identifier
            <input name="identifier" type="text" autocomplete="username" minlength="3" maxlength="254" required placeholder="Email, phone or account ID">
          </label>
          <button type="submit" class="dart-reset-submit">Send OTP to registered email</button>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
        <form id="dartPasswordResetCompleteForm" hidden novalidate>
          <label>6-digit OTP
            <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required placeholder="000000">
          </label>
          <label>New password
            <input name="password" type="password" autocomplete="new-password" minlength="6" maxlength="200" required>
          </label>
          <label>Confirm new password
            <input name="confirmation" type="password" autocomplete="new-password" minlength="6" maxlength="200" required>
          </label>
          <button type="submit" class="dart-reset-submit">Change password</button>
          <div class="dart-reset-actions">
            <button type="button" class="dart-reset-secondary" data-reset-resend>Send a new OTP</button>
          </div>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
        <div data-reset-success hidden>
          <p role="status">Password changed successfully. Sign in with your new password.</p>
          <button type="button" class="dart-reset-submit" data-reset-login>Back to Login</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const requestForm = dialog.querySelector("#dartPasswordResetRequestForm");
    const completeForm = dialog.querySelector("#dartPasswordResetCompleteForm");
    const success = dialog.querySelector("[data-reset-success]");
    const busy = (form, value) => {
      form.setAttribute("aria-busy", String(value));
      form.querySelectorAll("input,button").forEach((control) => { control.disabled = value; });
    };
    const pending = () => [requestForm, completeForm].some((form) => form.getAttribute("aria-busy") === "true");
    const active = (generation) => !dialog.hidden && dialog.dataset.generation === generation;
    const errorMessage = (error) => ({
      OTP_INVALID: "The code is incorrect or has already been used. Check it or request a new code.",
      OTP_EXPIRED: "This code has expired. Request a new code.",
      PASSWORD_REUSED: "Choose a password you have not used recently.",
      WEAK_PASSWORD: "The password does not meet the account's password requirements.",
    }[error.code] || (error.status === 429
      ? "Too many attempts. Please wait before trying again."
      : "Unable to complete the request. Please check your connection and try again."));

    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pending() || requestForm.hidden) return;
      if (!requestForm.checkValidity()) return requestForm.reportValidity();
      if (!API_BASE) return setStatus(requestForm, "Password recovery requires the secure account API.", true);
      const generation = dialog.dataset.generation;
      const identifier = requestForm.elements.identifier.value.trim();
      const accountType = dialog.dataset.accountType;
      busy(requestForm, true);
      setStatus(requestForm, "Sending a code to your registered email…");
      try {
        const payload = await requestPasswordReset(identifier, accountType);
        if (!active(generation)) return;
        if (!payload.challengeId) throw new Error("Missing reset challenge");
        dialog.dataset.challengeId = payload.challengeId || "";
        dialog.dataset.identifier = identifier;
        requestForm.hidden = true;
        completeForm.hidden = false;
        completeForm.elements.code.focus();
        setStatus(
          completeForm,
          "If the account exists, use a code from its registered email. Requests are limited to one email per minute and three per 15 minutes. Existing codes remain valid until expiry. Check your inbox and Spam folder.",
        );
      } catch (error) {
        if (active(generation)) setStatus(requestForm, errorMessage(error), true);
      } finally {
        if (active(generation)) busy(requestForm, false);
      }
    });

    completeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pending() || completeForm.hidden) return;
      if (!completeForm.checkValidity()) return completeForm.reportValidity();
      const password = completeForm.elements.password.value;
      const confirmation = completeForm.elements.confirmation.value;
      if (password !== confirmation) return setStatus(completeForm, "Passwords do not match.", true);
      const generation = dialog.dataset.generation;
      const code = completeForm.elements.code.value;
      busy(completeForm, true);
      setStatus(completeForm, "Changing your password…");
      try {
        await apiRequest("/api/v1/auth/reset-password", {
          method: "POST",
          body: {
            challengeId: dialog.dataset.challengeId,
            code,
            password,
            confirmation,
          },
        });
        if (!active(generation)) return;
        completeForm.reset();
        dialog.dataset.challengeId = "";
        completeForm.hidden = true;
        success.hidden = false;
        success.querySelector("button").focus();
      } catch (error) {
        if (active(generation)) setStatus(completeForm, errorMessage(error), true);
      } finally {
        if (active(generation)) busy(completeForm, false);
      }
    });

    dialog.querySelector("[data-reset-resend]").addEventListener("click", () => {
      if (pending()) return;
      dialog.dataset.challengeId = "";
      completeForm.reset();
      completeForm.hidden = true;
      requestForm.hidden = false;
      requestForm.elements.identifier.value = dialog.dataset.identifier || "";
      requestForm.elements.identifier.focus();
      setStatus(requestForm, "Request another OTP after one minute. Existing codes remain valid until expiry; at most three emails are sent per 15 minutes.");
    });
    dialog.querySelector("[data-reset-close]").addEventListener("click", () => {
      closePasswordResetDialog(dialog);
    });
    dialog.querySelector("[data-reset-login]").addEventListener("click", () => {
      const identifier = dialog.dataset.identifier;
      closePasswordResetDialog(dialog);
      const loginForm = document.getElementById("repLoginForm");
      if (loginForm) {
        loginForm.elements.identifier.value = identifier;
        loginForm.elements.password.value = "";
        loginForm.elements.password.focus();
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closePasswordResetDialog(dialog);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePasswordResetDialog(dialog);
      }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button,input")].filter((control) =>
        !control.disabled && !control.closest("[hidden]"));
      const first = controls[0], last = controls.at(-1);
      if ((event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    return dialog;
  }

  function closePasswordResetDialog(dialog) {
    dialog.hidden = true;
    dialog.dataset.generation = String(Number(dialog.dataset.generation || 0) + 1);
    dialog.dataset.challengeId = "";
    dialog.dataset.identifier = "";
    dialog.querySelectorAll("form").forEach((form) => form.reset());
    dialog.returnFocus?.focus();
  }

  function openPasswordReset(accountType = "representative", identifierHint = "") {
    if (accountType !== "representative") return;
    const dialog = ensurePasswordResetDialog();
    const requestForm = dialog.querySelector("#dartPasswordResetRequestForm");
    const completeForm = dialog.querySelector("#dartPasswordResetCompleteForm");
    if (!dialog.hidden) return;
    dialog.returnFocus = document.activeElement;
    dialog.dataset.generation = String(Number(dialog.dataset.generation || 0) + 1);
    dialog.dataset.accountType = "representative";
    dialog.dataset.challengeId = "";
    dialog.dataset.identifier = identifierHint || "";
    const minimumPasswordLength = 12;
    completeForm.elements.password.minLength = minimumPasswordLength;
    completeForm.elements.confirmation.minLength = minimumPasswordLength;
    completeForm.elements.password.placeholder = `At least ${minimumPasswordLength} characters`;
    completeForm.elements.confirmation.placeholder = `Repeat the new password`;
    requestForm.reset();
    completeForm.reset();
    [requestForm, completeForm].forEach((form) => {
      form.setAttribute("aria-busy", "false");
      form.querySelectorAll("input,button").forEach((control) => { control.disabled = false; });
      setStatus(form, "");
    });
    dialog.querySelector("[data-reset-success]").hidden = true;
    requestForm.hidden = false;
    completeForm.hidden = true;
    requestForm.elements.identifier.value = identifierHint || "";
    dialog.hidden = false;
    requestAnimationFrame(() => requestForm.elements.identifier.focus());
  }

  function clearCustomerPrivateCache({ preserveCartIdentifier = false, preserveGuestCart = false } = {}) {
    [
      KEYS.customers,
      KEYS.orders,
      KEYS.returns,
      KEYS.cards,
      KEYS.birthdayRewards,
      KEYS.birthdayMessages,
      "dart_cart",
      "user_last_address",
    ].filter((key) => !preserveGuestCart || key !== "dart_cart")
      .forEach((key) => window.DartState?.remove?.(key, { source: "logout" }));
    [
      API_USER_CACHE_KEY,
      "dart_cart_reservation_id",
      "dart_pending_email_verification",
      CART_UI_CACHE_KEY,
    ].filter((key) => !preserveCartIdentifier || key !== "dart_cart_reservation_id")
      .forEach((key) => sessionStorage.removeItem(key));
    if (!preserveGuestCart) {
      if (typeof hydratedCartOwnerId !== "undefined") hydratedCartOwnerId = null;
      if (typeof cartData !== "undefined") cartData = [];
      window.DartSets?.clearDrafts?.();
    }
  }

  async function logout() {
    if (API_BASE) {
      try {
        await apiRequest("/api/v1/auth/logout", { method: "POST" });
      } catch (error) {
        if (error.status !== 401) throw error;
      }
      csrfMemory = "";
      cacheApiUser(null);
      clearCustomerPrivateCache();
      return;
    }
    const user = currentUser();
    if (user) audit("LOGOUT", "customers", user.customerId);
    window.DartState?.remove?.(KEYS.session, { source: "platform" });
    clearCustomerPrivateCache();
  }

