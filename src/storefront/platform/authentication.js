  async function register(payload) {
    const cleanPayload = {
      ...payload,
      phone2: String(payload.phone2 || "").trim() || undefined,
      birthday: String(payload.birthday || "").trim() || undefined,
    };
    if (API_BASE) {
      const result = await apiRequest("/api/v1/auth/register", {
        method: "POST",
        body: cleanPayload,
      });
      if (result.user) {
        cacheApiUser(result.user);
        await claimGuestCartAfterAuth();
        refreshCustomerCommerceInBackground();
      }
      return result;
    }
    payload = cleanPayload;
    if (API_REQUIRED)
      throw new Error("تعذر إنشاء الحساب لأن خدمة الحسابات غير مهيأة.");
    const users = read(KEYS.users, []);
    const email = normalizeEmail(payload.email),
      phone1 = normalizePhone(payload.phone1),
      phone2 = normalizePhone(payload.phone2);
    if (!payload.name || payload.name.trim().length < 3)
      throw new Error("اكتب الاسم الكامل بصورة صحيحة.");
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new Error("البريد الإلكتروني غير صحيح.");
    if (!/^\+201[0125]\d{8}$/.test(phone1))
      throw new Error("رقم الهاتف المصري غير صحيح.");
    if (phone2 && !/^\+201[0125]\d{8}$/.test(phone2))
      throw new Error("رقم الهاتف الثاني غير صحيح.");
    if (String(payload.password || "").length < 8)
      throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    const conflict = identityConflict({ email, phone1, phone2 });
    if (conflict) throw new Error(conflict);
    const customerId = nextCode("DA", read(KEYS.customers, []), "clientId");
    const user = {
      id: uid("USR"),
      customerId,
      name: payload.name.trim(),
      email,
      phone1,
      phone2,
      birthday: payload.birthday || "",
      passwordHash: await sha256(payload.password),
      createdAt: now(),
      emailVerified: false,
      phoneVerified: false,
      dartCard: "no",
      role: "Customer",
      isArchived: false,
    };
    users.push(user);
    write(KEYS.users, users);
    syncCustomer(user);
    saveCustomerSession(user);
    audit("REGISTER", "customers", user.customerId);
    return user;
  }

  async function login(identifier, password) {
    if (API_BASE) {
      const payload = await apiRequest("/api/v1/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      const user = cacheApiUser(payload.user);
      await claimGuestCartAfterAuth();
      refreshCustomerCommerceInBackground();
      return user;
    }
    if (API_REQUIRED)
      throw new Error("تعذر تسجيل الدخول لأن خدمة الحسابات غير مهيأة.");
    const keyEmail = normalizeEmail(identifier),
      keyPhone = normalizePhone(identifier),
      keyName = String(identifier || "")
        .trim()
        .toLowerCase();
    const hash = await sha256(password);
    const user = read(KEYS.users, []).find(
      (row) =>
        !row.isArchived &&
        (normalizeEmail(row.email) === keyEmail ||
          normalizePhone(row.phone1) === keyPhone ||
          normalizePhone(row.phone2) === keyPhone ||
          String(row.name).trim().toLowerCase() === keyName),
    );
    if (!user || user.passwordHash !== hash)
      throw new Error("بيانات الدخول غير صحيحة.");
    saveCustomerSession(user);
    audit("LOGIN", "customers", user.customerId);
    return user;
  }

  function requestPasswordReset(identifier) {
    const input = String(identifier || "").trim(),
      email = normalizeEmail(input),
      phone = normalizePhone(input);
    const user = read(KEYS.users, []).find(
      (row) =>
        !row.isArchived &&
        (normalizeEmail(row.email) === email ||
          normalizePhone(row.phone1) === phone ||
          normalizePhone(row.phone2) === phone ||
          String(row.customerId).toLowerCase() === input.toLowerCase()),
    );
    if (user) {
      const requests = read(KEYS.passwordResets, []);
      if (
        !requests.some(
          (row) =>
            row.status === "Pending" &&
            row.accountType === "Customer" &&
            row.accountId === user.id,
        )
      ) {
        requests.unshift({
          id: uid("PWR"),
          accountType: "Customer",
          accountId: user.id,
          identifier: input,
          displayName: user.name,
          status: "Pending",
          createdAt: now(),
          source: "Customer Login",
        });
        write(KEYS.passwordResets, requests);
        notify(
          "password_reset",
          "Customer password reset request",
          `${user.customerId} requested a temporary password.`,
          "customers",
          user.customerId,
        );
      }
    }
    return true;
  }

  function ensurePasswordResetDialog() {
    let dialog = document.getElementById("dartPasswordResetDialog");
    if (dialog) return dialog;

    const style = document.createElement("style");
    style.textContent = `
      .dart-reset-dialog{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:20px}
      .dart-reset-dialog[hidden]{display:none}
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
            <input name="identifier" type="text" autocomplete="username" required placeholder="Email, phone or account ID">
          </label>
          <button type="submit" class="dart-reset-submit">Send OTP to registered email</button>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
        <form id="dartPasswordResetCompleteForm" hidden novalidate>
          <label>6-digit OTP
            <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required placeholder="000000">
          </label>
          <label>New password
            <input name="password" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <label>Confirm new password
            <input name="confirmation" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <button type="submit" class="dart-reset-submit">Change password</button>
          <div class="dart-reset-actions">
            <button type="button" class="dart-reset-secondary" data-reset-resend>Send a new OTP</button>
          </div>
          <p class="form-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);

    const requestForm = dialog.querySelector("#dartPasswordResetRequestForm");
    const completeForm = dialog.querySelector("#dartPasswordResetCompleteForm");

    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requestForm.checkValidity()) return requestForm.reportValidity();
      if (!API_BASE) return setStatus(requestForm, "Password recovery requires the secure account API.", true);
      try {
        const payload = await apiRequest("/api/v1/auth/forgot-password", {
          method: "POST",
          body: {
            identifier: requestForm.elements.identifier.value,
            accountType: dialog.dataset.accountType || "customer",
          },
        });
        dialog.dataset.challengeId = payload.challengeId || "";
        dialog.dataset.identifier = requestForm.elements.identifier.value;
        requestForm.hidden = true;
        completeForm.hidden = false;
        completeForm.elements.code.focus();
        setStatus(
          completeForm,
          "If the account exists, a 6-digit OTP was sent to its registered email. Enter it and choose a new password.",
        );
      } catch (error) {
        setStatus(requestForm, error.message, true);
      }
    });

    completeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!completeForm.checkValidity()) return completeForm.reportValidity();
      const password = completeForm.elements.password.value;
      const confirmation = completeForm.elements.confirmation.value;
      if (password !== confirmation) return setStatus(completeForm, "Passwords do not match.", true);
      try {
        await apiRequest("/api/v1/auth/reset-password", {
          method: "POST",
          body: {
            challengeId: dialog.dataset.challengeId,
            code: completeForm.elements.code.value,
            password,
            confirmation,
          },
        });
        completeForm.reset();
        setStatus(completeForm, "Password changed successfully. You can now sign in with the new password.");
      } catch (error) {
        setStatus(completeForm, error.message, true);
      }
    });

    dialog.querySelector("[data-reset-resend]").addEventListener("click", () => {
      completeForm.hidden = true;
      requestForm.hidden = false;
      requestForm.elements.identifier.value = dialog.dataset.identifier || "";
      requestForm.elements.identifier.focus();
      setStatus(requestForm, "Request a fresh OTP. Any previous OTP will stop working.");
    });
    dialog.querySelector("[data-reset-close]").addEventListener("click", () => {
      dialog.hidden = true;
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.hidden = true;
    });
    return dialog;
  }

  function openPasswordReset(accountType = "customer", identifierHint = "") {
    const dialog = ensurePasswordResetDialog();
    const requestForm = dialog.querySelector("#dartPasswordResetRequestForm");
    const completeForm = dialog.querySelector("#dartPasswordResetCompleteForm");
    dialog.dataset.accountType = accountType === "representative" ? "representative" : "customer";
    dialog.dataset.challengeId = "";
    dialog.dataset.identifier = identifierHint || "";
    const minimumPasswordLength = dialog.dataset.accountType === "representative" ? 12 : 8;
    completeForm.elements.password.minLength = minimumPasswordLength;
    completeForm.elements.confirmation.minLength = minimumPasswordLength;
    completeForm.elements.password.placeholder = `At least ${minimumPasswordLength} characters`;
    completeForm.elements.confirmation.placeholder = `Repeat the new password`;
    requestForm.reset();
    completeForm.reset();
    requestForm.hidden = false;
    completeForm.hidden = true;
    requestForm.elements.identifier.value = identifierHint || "";
    dialog.hidden = false;
    requestAnimationFrame(() => requestForm.elements.identifier.focus());
  }

  async function changeOwnPassword(currentPassword, password, confirmation) {
    if (password !== confirmation) throw new Error("Passwords do not match.");
    if (API_BASE) {
      const payload = await apiRequest("/api/v1/auth/change-password", {
        method: "POST",
        body: { currentPassword, password, confirmation },
      });
      return cacheApiUser(payload.user);
    }
    if (API_REQUIRED) throw new Error("Changing the password requires the secure account API.");
    const current = currentUser();
    if (!current) throw new Error("Your login session has expired.");
    const users = read(KEYS.users, []);
    const stored = users.find((row) => row.id === current.id);
    if (!stored || stored.passwordHash !== await sha256(currentPassword))
      throw new Error("Current password is incorrect.");
    if (String(password || "").length < 8) throw new Error("Password must be at least 8 characters.");
    stored.passwordHash = await sha256(password);
    stored.passwordUpdatedAt = now();
    write(KEYS.users, users);
    audit("PASSWORD_CHANGED", "customers", stored.customerId);
    return stored;
  }

  async function replaceTemporaryPassword(password, confirmation) {
    if (API_BASE) {
      const payload = await apiRequest("/api/v1/auth/change-temporary-password", {
        method: "POST",
        body: { password, confirmation },
      });
      return cacheApiUser(payload.user);
    }
    const user = currentUser();
    if (!user) throw new Error("Your login session has expired.");
    if (String(password || "").length < 8)
      throw new Error("Password must be at least 8 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    const users = read(KEYS.users, []),
      stored = users.find((row) => row.id === user.id);
    stored.passwordHash = await sha256(password);
    stored.mustChangePassword = false;
    stored.passwordUpdatedAt = now();
    write(KEYS.users, users);
    audit("PASSWORD_CHANGED", "customers", stored.customerId);
    return stored;
  }

  function clearCustomerPrivateCache() {
    [
      KEYS.customers,
      KEYS.orders,
      KEYS.returns,
      KEYS.cards,
      KEYS.birthdayRewards,
      KEYS.birthdayMessages,
      "dart_cart",
      "user_last_address",
    ].forEach((key) => window.DartState?.remove?.(key, { source: "logout" }));
    [
      API_USER_CACHE_KEY,
      "dart_cart_reservation_id",
      "dart_pending_email_verification",
      CART_UI_CACHE_KEY,
    ].forEach((key) => sessionStorage.removeItem(key));
    if (typeof cartData !== "undefined") cartData = [];
    window.DartSets?.clearDrafts?.();
  }

  async function logout() {
    if (API_BASE) {
      try {
        await apiRequest("/api/v1/auth/logout", { method: "POST" });
      } finally {
        csrfMemory = "";
        cacheApiUser(null);
        clearCustomerPrivateCache();
      }
      return;
    }
    const user = currentUser();
    if (user) audit("LOGOUT", "customers", user.customerId);
    window.DartState?.remove?.(KEYS.session, { source: "platform" });
    clearCustomerPrivateCache();
  }

  async function verifyEmail(challengeId, code) {
    if (!API_BASE) throw new Error("Email verification requires the backend API.");
    const payload = await apiRequest("/api/v1/auth/verify-email", {
      method: "POST",
      body: { challengeId, code },
    });
    return cacheApiUser(payload.user);
  }


