// Owner review of verified email requests for historic phone-only customers.
// Never trusts the browser as authority to link identities.
(function () {
  "use strict";
  const card = document.getElementById("settings-customer-email-links-card");
  if (!card) return;
  const list = document.getElementById("settings-customer-email-links-list");
  const status = document.getElementById("settings-customer-email-links-status");
  const refreshButton = document.getElementById("settings-customer-email-links-refresh");
  let generation = 0;
  let refreshing = false;
  const canView = () => window.DartAdminAccess?.can?.("staff.manage") === true &&
    Boolean(window.DartAdminApi?.request);
  const message = (value, error = false) => {
    status.textContent = value || "";
    status.classList.toggle("is-error", error);
  };
  const el = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const makeRow = (record) => {
    const article = el("article", "", "dart-settings-list-row dart-email-link-review-row");
    const info = el("div");
    info.append(el("strong", record.customerName || record.clientCode),
      el("small", (record.clientCode || "") + " · " + (record.phone || "")),
      el("small", "Verified email: " + record.email),
      el("small", "Verified: " + (record.verifiedAt ? new Date(record.verifiedAt).toLocaleString("ar-EG") : "-")));
    const textarea = el("textarea");
    textarea.setAttribute("aria-label", "Review reason and phone ownership check details");
    textarea.placeholder = "سبب القرار وكيف تأكدت من ملكية رقم الهاتف (10 أحرف على الأقل)";
    textarea.minLength = 10;
    textarea.maxLength = 600;
    textarea.rows = 2;
    const label = el("label", "", "dart-settings-check");
    const checked = document.createElement("input");
    checked.type = "checkbox";
    label.append(checked, document.createTextNode(" اتصلت بصاحب الرقم المسجل وتأكدت من هويته قبل الربط"));
    const actions = el("div", "", "dart-email-link-review-actions");
    const approve = el("button", "Approve & link email", "dart-settings-save");
    const reject = el("button", "Reject", "dart-settings-secondary");
    approve.type = reject.type = "button";
    actions.append(approve, reject);
    async function decide(allow) {
      const reason = textarea.value.trim();
      if (reason.length < 10) return message("اكتب سبب القرار ووسيلة التحقق من الهوية (10 أحرف على الأقل).", true);
      if (allow && !checked.checked) return message("لازم تتأكد من ملكية رقم الهاتف بنفسك قبل الموافقة.", true);
      const confirmation = allow
        ? "هل تم التواصل مع صاحب رقم الهاتف المسجل والتحقق من ملكيته بالفعل؟"
        : "هل تريد رفض طلب ربط الإيميل؟";
      if (!(await window.DartDialog.confirm(confirmation))) return;
      approve.disabled = reject.disabled = true;
      message("جارٍ حفظ القرار...");
      try {
        await window.DartAdminApi.request(
          "/api/v1/admin/customer-email-links/" + encodeURIComponent(record.id) + "/review",
          { method: "POST", body: {
            approve: allow, reason, confirmedPhoneOwner: allow && checked.checked,
          } },
        );
        await refresh(true);
        message(allow ? "تم ربط الإيميل بعد الموافقة. العميل يقدر يدخل بكود الإيميل الآن."
          : "تم رفض الطلب وتسجيل سبب الرفض.");
      } catch (error) {
        message(error?.message || "تعذر تحديث الطلب.", true);
        approve.disabled = reject.disabled = false;
      }
    }
    approve.addEventListener("click", () => void decide(true));
    reject.addEventListener("click", () => void decide(false));
    article.append(info, textarea, label, actions);
    return article;
  };
  async function refresh(silent = false) {
    if (!canView()) {
      generation++;
      card.hidden = true;
      list.replaceChildren();
      return;
    }
    card.hidden = false;
    if (refreshing) return;
    refreshing = true;
    const revision = ++generation;
    if (!silent) message("Loading verified requests...");
    refreshButton.disabled = true;
    try {
      const payload = await window.DartAdminApi.request("/api/v1/admin/customer-email-links");
      if (revision !== generation || !canView()) return;
      const rows = Array.isArray(payload.requests) ? payload.requests : [];
      list.replaceChildren(...(rows.length ? rows.map(makeRow) : [el("p", "No email link requests waiting for review.")]));
      if (!silent) message(rows.length ? rows.length + " pending review request(s)." : "");
    } catch (error) {
      if (revision === generation) message(error?.message || "Unable to load requests.", true);
    } finally {
      if (revision === generation) {
        refreshing = false;
        refreshButton.disabled = false;
      }
    }
  }
  refreshButton.addEventListener("click", () => void refresh());
  window.addEventListener("dart:admin-authenticated", () => void refresh());
  window.addEventListener("dart:admin-logged-out", () => {
    generation++;
    card.hidden = true;
    list.replaceChildren();
    message("");
    refreshing = false;
  });
  if (canView()) void refresh();
})();
