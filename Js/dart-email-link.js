// Dart sign-in: verify a new email for a legacy phone-only account.
// The resulting request awaits Owner review; it never creates a customer session.
(function () {
  "use strict";
  let dialog;
  let form;
  let generation = 0;
  let busy = false;
  let phone = "";
  let email = "";
  let challengeId = "";
  let resendAt = 0;
  let returnFocus = null;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "dartEmailLinkDialog";
    dialog.className = "dart-email-link-dialog";
    dialog.setAttribute("aria-labelledby", "dartEmailLinkTitle");
    dialog.innerHTML = `
      <div class="dart-email-link-card" dir="rtl">
        <button type="button" class="dart-email-link-close" data-link-close aria-label="إغلاق">×</button>
        <span class="dart-email-link-kicker">DART / FOR YOU</span>
        <h2 id="dartEmailLinkTitle">تأكيد البريد الإلكتروني</h2>
        <p data-link-intro>أدخل بريدك الإلكتروني لإكمال طلب ربطه برقمك.</p>
        <form data-link-email-form novalidate>
          <label for="dartEmailLinkAddress">البريد الإلكتروني</label>
          <input id="dartEmailLinkAddress" type="email" name="email" inputmode="email"
            autocomplete="email" maxlength="254" placeholder="name@example.com" required dir="ltr">
          <button type="submit" class="dart-email-link-primary">إرسال رمز التحقق</button>
        </form>
        <form data-link-code-form novalidate hidden>
          <p>أرسلنا رمزًا مكوّنًا من 6 أرقام إلى:</p>
          <strong class="dart-email-link-address" data-link-recipient dir="ltr"></strong>
          <label for="dartEmailLinkCode">رمز التحقق OTP</label>
          <input id="dartEmailLinkCode" name="code" type="text" inputmode="numeric"
            autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6"
            placeholder="000000" required dir="ltr">
          <button type="submit" class="dart-email-link-primary">تأكيد البريد</button>
          <button type="button" class="dart-email-link-secondary" data-link-resend>إعادة إرسال الرمز</button>
          <button type="button" class="dart-email-link-secondary" data-link-change>تغيير البريد</button>
        </form>
        <div data-link-success hidden>
          <p class="dart-email-link-success-title">تم تأكيد بريدك الإلكتروني</p>
          <p>تم إرسال طلب الربط لمراجعة Dart. سيتم إتاحة الدخول بهذا الإيميل بعد
          تأكيد ملكية رقم الهاتف من إدارة المتجر. لم يتم فتح الحساب بعد.</p>
          <button type="button" class="dart-email-link-primary" data-link-done>تم</button>
        </div>
        <p class="dart-email-link-status" data-link-status role="status" aria-live="polite"></p>
        <p class="dart-email-link-note">لو معندكش حساب قبل كده، يمكنك إنشاء حساب جديد بدل طلب الربط.</p>
        <button type="button" class="dart-email-link-secondary" data-link-register>إنشاء حساب جديد</button>
      </div>`;
    document.body.appendChild(dialog);
    const emailForm = dialog.querySelector("[data-link-email-form]");
    const codeForm = dialog.querySelector("[data-link-code-form]");
    const status = dialog.querySelector("[data-link-status]");
    const show = (selector) => {
      emailForm.hidden = selector !== "email";
      codeForm.hidden = selector !== "code";
      dialog.querySelector("[data-link-success]").hidden = selector !== "success";
    };
    const message = (value, error = false) => {
      status.textContent = value;
      status.classList.toggle("is-error", error);
    };
    const request = (path, body) => window.DartPlatform.apiRequest(path, { method: "POST", body });
    emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !emailForm.checkValidity()) return emailForm.reportValidity();
      const seq = generation;
      const input = emailForm.elements.email.value.trim();
      busy = true;
      emailForm.querySelector("button").disabled = true;
      message("جارٍ إرسال رمز التحقق…");
      try {
        const result = await request("/api/v1/auth/email-link/start", { phone, email: input });
        if (seq !== generation) return;
        challengeId = result.challengeId;
        email = input;
        resendAt = Date.now() + 60_000;
        dialog.querySelector("[data-link-recipient]").textContent = email;
        codeForm.elements.code.value = "";
        show("code");
        message("لو الرقم مسجل بدون إيميل، ستصلك رسالة التحقق. راجع Inbox وSpam. الإيميل لن يفتح حسابك قبل موافقة Dart.");
        codeForm.elements.code.focus();
      } catch (error) {
        if (seq === generation) message(error?.message || "تعذر إرسال الكود.", true);
      } finally {
        busy = false;
        emailForm.querySelector("button").disabled = false;
      }
    });
    codeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !codeForm.checkValidity()) return codeForm.reportValidity();
      const seq = generation;
      busy = true;
      codeForm.querySelector('button[type="submit"]').disabled = true;
      message("جارٍ تأكيد البريد…");
      try {
        const result = await request("/api/v1/auth/email-link/verify", {
          challengeId, code: codeForm.elements.code.value.trim(),
        });
        if (seq !== generation) return;
        if (!result.reviewPending) throw new Error("تعذر تأكيد طلب الربط.");
        show("success");
        message("");
        dialog.querySelector("[data-link-done]").focus();
      } catch (error) {
        if (seq === generation) {
          message(error?.message || "الكود غير صحيح أو انتهت صلاحيته.", true);
          codeForm.elements.code.value = "";
          codeForm.elements.code.focus();
        }
      } finally {
        busy = false;
        codeForm.querySelector('button[type="submit"]').disabled = false;
      }
    });
    dialog.querySelector("[data-link-resend]").addEventListener("click", async (event) => {
      if (busy) return;
      const remaining = Math.ceil((resendAt - Date.now()) / 1000);
      if (remaining > 0) return message("يمكنك طلب رمز جديد بعد " + remaining + " ثانية.");
      const seq = generation;
      busy = true;
      const resendButton = event.currentTarget;
      resendButton.disabled = true;
      try {
        const result = await request("/api/v1/auth/email-link/start", { phone, email });
        if (seq !== generation) return;
        challengeId = result.challengeId;
        resendAt = Date.now() + 60_000;
        codeForm.elements.code.value = "";
        message("تم استقبال طلبك. راجع البريد الوارد وSpam.");
      } catch (error) {
        if (seq === generation) message(error?.message || "تعذرت إعادة الإرسال.", true);
      } finally { busy = false; resendButton.disabled = false; }
    });
    dialog.querySelector("[data-link-change]").addEventListener("click", () => {
      if (busy) return;
      challengeId = "";
      codeForm.elements.code.value = "";
      show("email");
      message("");
      emailForm.elements.email.focus();
    });
    function close() {
      generation++;
      busy = false;
      challengeId = "";
      email = "";
      phone = "";
      emailForm.reset();
      codeForm.reset();
      message("");
      if (dialog.open) dialog.close();
      returnFocus?.focus?.();
    }
    dialog.querySelector("[data-link-close]").addEventListener("click", close);
    dialog.querySelector("[data-link-done]").addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.querySelector("[data-link-register]").addEventListener("click", () => {
      close();
      document.querySelector(".register-btn")?.click();
    });
    dialog.dartOpen = (value, trigger) => {
      generation++;
      phone = value;
      email = "";
      challengeId = "";
      resendAt = 0;
      returnFocus = trigger;
      emailForm.reset();
      codeForm.reset();
      show("email");
      message("");
      dialog.showModal();
      emailForm.elements.email.focus();
    };
    return dialog;
  }
  window.showCustomerEmailLinkStep = function (loginForm) {
    const phoneValue = String(loginForm?.elements?.identifier?.value || "").trim();
    if (!phoneValue || phoneValue.includes("@")) return;
    ensureDialog().dartOpen(phoneValue, loginForm.elements.identifier);
  };
  // Preserve the original OTP flow for existing accounts and registration.
  // The shared storefront runtime must not be duplicated or patched by this page-only UI.
  const originalShowOtp = window.showCustomerOtpStep;
  window.showCustomerOtpStep = function (form, purpose, challenge) {
    if (purpose === "login" && challenge?.needsEmail === true) {
      window.showCustomerEmailLinkStep(form);
      return;
    }
    return originalShowOtp(form, purpose, challenge);
  };
})();
