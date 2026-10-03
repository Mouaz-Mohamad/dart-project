// DART CODE GUIDE | Eye/dart-settings.js
// الغرض: منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.
// DART EYE | MODULE: dart-settings.js
// Dashboard Settings forms, templates, general settings, and internal Settings navigation.
// BEGIN MODULE

/* ========================================================================== */
/* DART SETTINGS — owner-only server-authoritative business-data reset         */
/* PostgreSQL is reset first; browser caches are cleared only after commit.     */
/* Protected Staff/Owner access and append-only audit history are preserved.    */
/* ========================================================================== */
(function (root) {
  "use strict";

  const CONFIRMATION_PHRASE = "DELETE DART";
  const DART_KEY_PREFIX = "dart_";
  const LEGACY_DART_KEYS = new Set(["order_45_state", "user_last_address"]);
  const CATALOG_MEDIA_DATABASE = "dart-catalog-media-v7";

  function isDartStorageKey(key) {
    return typeof key === "string" && (key.startsWith(DART_KEY_PREFIX) || LEGACY_DART_KEYS.has(key));
  }

  function clearDartStorage(storage) {
    const removed = [];
    if (!storage) return removed;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
    keys.filter(isDartStorageKey).forEach((key) => {
      storage.removeItem(key);
      removed.push(key);
    });
    return removed;
  }

  function clearCatalogMedia() {
    return Promise.resolve(true);
  }

  const api = {
    CONFIRMATION_PHRASE,
    CATALOG_MEDIA_DATABASE,
    isDartStorageKey,
    clearDartStorage,
    clearCatalogMedia,
  };
  root.DartSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document) return;

  const modal = document.getElementById("reset-data-modal");
  const openButton = document.getElementById("open-reset-data-modal");
  const closeButton = document.getElementById("close-reset-data-modal");
  const cancelButton = document.getElementById("cancel-reset-data");
  const confirmButton = document.getElementById("confirm-reset-data");
  const confirmationInput = document.getElementById("reset-confirmation-input");
  const understandCheckbox = document.getElementById("reset-understand-checkbox");
  const errorBox = document.getElementById("reset-data-error");
  const statusBox = document.getElementById("settings-reset-status");

  function confirmationIsValid() {
    return confirmationInput.value.trim().toUpperCase() === CONFIRMATION_PHRASE && understandCheckbox.checked;
  }

  function syncConfirmationState() {
    confirmButton.disabled = !confirmationIsValid();
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function resetConfirmationForm() {
    confirmationInput.value = "";
    understandCheckbox.checked = false;
    confirmButton.disabled = true;
    confirmButton.removeAttribute("aria-busy");
    document.getElementById("reset-delete-button-label").textContent = "Permanently Delete Everything";
    confirmationInput.disabled = false;
    understandCheckbox.disabled = false;
    cancelButton.disabled = false;
    closeButton.disabled = false;
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function openResetModal() {
    resetConfirmationForm();
    modal.classList.add("active");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    root.setTimeout(() => confirmationInput.focus(), 0);
  }

  function closeResetModal() {
    if (confirmButton.getAttribute("aria-busy") === "true") return;
    modal.classList.remove("active");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    resetConfirmationForm();
    openButton.focus();
  }

  function showResetError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  async function resetAllDartData() {
    if (!confirmationIsValid()) {
      showResetError(`اكتب ${CONFIRMATION_PHRASE} وفعّل مربع الإقرار أولًا.`);
      return;
    }

    const finalApproval = await root.DartDialog.confirm("تحذير نهائي جدًا: سيتم الآن حذف كل بيانات Dart نهائيًا، ولا يمكن التراجع. هل أنت متأكد 100%؟");
    if (!finalApproval) return;

    confirmButton.disabled = true;
    confirmationInput.disabled = true;
    understandCheckbox.disabled = true;
    cancelButton.disabled = true;
    closeButton.disabled = true;
    confirmButton.setAttribute("aria-busy", "true");
    document.getElementById("reset-delete-button-label").textContent = "Deleting all data…";
    errorBox.hidden = true;

    try {
      if (!root.DartAdminApi?.request) {
        throw new Error("Secure admin API is unavailable.");
      }
      const result = await root.DartAdminApi.request(
        "/api/v1/admin/platform/reset-business-data",
        {
          method: "POST",
          body: {
            confirmation: CONFIRMATION_PHRASE,
            understandPermanentDeletion: true,
          },
        },
      );

      // PostgreSQL committed successfully; browser state can now be discarded safely.
      await clearCatalogMedia();
      root.DartState?.clearBusiness?.();
      clearDartStorage(root.localStorage);
      clearDartStorage(root.sessionStorage);

      modal.classList.remove("active");
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      statusBox.textContent =
        `تم مسح بيانات نشاط Dart من قاعدة البيانات بنجاح (${result.resetAt || "now"}). تم الاحتفاظ بحساب Owner/Staff وسجل Audit.`;
      statusBox.hidden = false;
      root.setTimeout(() => root.location.reload(), 900);
    } catch (error) {
      confirmButton.removeAttribute("aria-busy");
      confirmationInput.disabled = false;
      understandCheckbox.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
      syncConfirmationState();
      showResetError(
        error.message ||
          "تعذر إكمال المسح على قاعدة البيانات. لم يتم تنظيف Cache المتصفح.",
      );
    }
  }

  openButton.addEventListener("click", openResetModal);
  closeButton.addEventListener("click", closeResetModal);
  cancelButton.addEventListener("click", closeResetModal);
  confirmationInput.addEventListener("input", syncConfirmationState);
  understandCheckbox.addEventListener("change", syncConfirmationState);
  confirmButton.addEventListener("click", resetAllDartData);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeResetModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("active")) closeResetModal();
  });
})(typeof window !== "undefined" ? window : globalThis);

/* Site controls use only the static forms/templates declared in Dart Eye.html. */
(function (root) {
  "use strict";
  if (!root.document || !root.DartSiteSettings) return;

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const number = (id, fallback = 0) => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function announce(message, error = false) {
    const status = $("settings-reset-status");
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    status.dataset.state = error ? "error" : "success";
  }

  async function saveSettings(next, note) {
    const before = clone(root.DartSiteSettings.get());
    try {
      const saved = root.DartSiteSettings.sync
        ? await root.DartSiteSettings.sync(next)
        : root.DartSiteSettings.save(next);
      void before;
      void note;
      await root.DartDomainState?.hydrateAudit?.().catch(() => {});
      announce("تم حفظ الإعدادات في قاعدة البيانات وتطبيقها على الواجهة العامة.");
      return saved;
    } catch (error) {
      await root.DartSiteSettings.hydrate?.(true).catch(() => {});
      announce(error.message || "تعذر حفظ الإعدادات في قاعدة البيانات.", true);
      return null;
    }
  }

  function fillGeneral(settings) {
    $("settings-default-markup").value = settings.defaultMarkupPercent;
    $("settings-delivery-cost").value = settings.courierFeePerOrder ?? settings.deliveryCostPerPiece ?? 100;
    $("settings-birthday-discount").value = settings.birthdayDiscountPercent;
    $("settings-card-discount").value = settings.dartCardDiscountPercent;
    $("settings-refund-fee").value = settings.refundCustomerFee;
    $("settings-repeat-exchange-fee").value = settings.repeatExchangeCustomerFee;
    const codRisk = settings.codRisk || {};
    $("settings-cod-risk-version").value = Math.max(1, Number(codRisk.version) || 1);
    $("settings-cod-refusal-window").value = Math.max(1, Number(codRisk.refusalWindowDays) || 90);
    $("settings-cod-manual-refusals").value = Math.max(2, Number(codRisk.manualReviewRefusalCount) || 2);
    $("settings-cod-rapid-window").value = Math.max(1, Number(codRisk.rapidRepeatWindowMinutes) || 120);
    $("settings-cod-rapid-count").value = Math.max(2, Number(codRisk.rapidRepeatOrderCount) || 3);
    $("settings-cod-high-value").value = Math.max(0, Number(codRisk.highOrderValueMinor) || 300000) / 100;
    $("settings-cod-restricted-value").value = Math.max(0, Number(codRisk.restrictedOrderValueMinor) || 750000) / 100;
    $("settings-cod-medium-score").value = Math.max(1, Number(codRisk.mediumScoreMin) || 20);
    $("settings-cod-high-score").value = Math.max(2, Number(codRisk.highScoreMin) || 50);
    $("settings-cod-restricted-score").value = Math.max(3, Number(codRisk.restrictedScoreMin) || 80);
    $("settings-cod-first-order").checked = codRisk.requireFirstOrderVerification !== false;
    $("settings-cod-unverified-phone").checked = codRisk.requireUnverifiedPhoneVerification !== false;
    const waiting = settings.waiting || {};
    $("settings-waiting-enabled").checked = waiting.enabled !== false;
    $("settings-waiting-hours").value = Math.min(72, Math.max(1, Number(waiting.reservationHours) || 4));
    $("settings-waiting-alternatives").checked = waiting.alternativeColorsEnabled !== false;
    $("settings-waiting-email").checked = waiting.emailNotificationEnabled !== false;
    $("settings-waiting-site").checked = waiting.inSiteNotificationEnabled !== false;
  }

  async function previewAsset(asset, image, fallback) {
    if (!image) return;
    if (!asset) { image.src = fallback; return; }
    try {
      await root.DartCatalog?.loadImage?.(asset);
      image.src = root.DartCatalog?.imageSrc?.(asset) || fallback;
    } catch { image.src = fallback; }
  }

  function renderMedia(settings) {
    previewAsset(settings.heroDayImage, $("settings-hero-day-preview"), "../Photos/hero 2.webp");
    previewAsset(settings.heroNightImage || settings.heroDayImage, $("settings-hero-night-preview"), "../Photos/hero 2.webp");
    previewAsset(settings.founderImage, $("settings-founder-preview"), "../Photos/me.png");
  }

  function renderAnnouncements(settings) {
    const list = $("settings-announcements-list"), template = $("settings-announcement-row-template");
    if (!list || !template) return;
    list.replaceChildren();
    settings.announcements.forEach((row) => {
      const fragment = template.content.cloneNode(true);
      const element = fragment.querySelector("[data-announcement-row]");
      element.dataset.id = row.id;
      element.querySelector('[data-announcement-field="text"]').textContent = row.text;
      element.querySelector('[data-announcement-field="dates"]').textContent = `${row.startsAt || "Always"} → ${row.endsAt || "Always"}`;
      element.querySelector('[data-announcement-field="status"]').textContent = row.enabled === false ? "Paused" : "Active";
      list.appendChild(fragment);
    });
    if (!settings.announcements.length) {
      const empty = document.createElement("p");
      empty.className = "dart-settings-empty";
      empty.textContent = "No scheduled announcements yet.";
      list.appendChild(empty);
    }
  }

  function addTypingRow(scene, hold, word) {
    const template = $("settings-typing-row-template"), container = $("settings-typing-rows");
    if (!template || !container) return;
    const fragment = template.content.cloneNode(true), row = fragment.querySelector("[data-typing-row]");
    row.querySelector('[data-typing-field="scene"]').value = scene;
    row.querySelector('[data-typing-field="hold"]').value = hold;
    row.querySelector('[data-typing-field="text"]').value = word?.text || "";
    row.querySelector('[data-typing-field="color"]').value = word?.color || "#ffffff";
    row.querySelector('[data-typing-field="size"]').value = Number(word?.size) || 36;
    row.querySelector('[data-typing-field="weight"]').value = Number(word?.weight) || 400;
    container.appendChild(fragment);
  }

  function renderTyping(settings) {
    const typing = settings.typing;
    $("settings-typing-speed").value = typing.typingSpeed;
    $("settings-deleting-speed").value = typing.deletingSpeed;
    $("settings-word-delay").value = typing.wordDelay;
    $("settings-scene-delay").value = typing.nextSceneDelay;
    $("settings-typing-rows").replaceChildren();
    typing.scenes.forEach((scene, index) =>
      (scene.words || []).forEach((word) => addTypingRow(index + 1, scene.hold || 0, word)),
    );
  }

  function renderModelCards(settings) {
    const list = $("settings-model-cards-list"), template = $("settings-model-card-row-template");
    if (!list || !template) return;
    let models = [];
    models = root.DartState?.read?.("dart_models", []) || [];
    models = models.filter((model) => !model.isDeleted && !model.isArchived && model.active !== false);
    list.replaceChildren();
    models.forEach((model) => {
      const fragment = template.content.cloneNode(true), row = fragment.querySelector("[data-model-card-row]");
      const rule = settings.modelCards[model.modelId] || { mode: "all", count: 1, colors: [] };
      row.dataset.modelId = model.modelId;
      row.querySelector('[data-model-field="name"]').textContent = model.name || model.modelId;
      row.querySelector('[data-model-field="code"]').textContent = model.modelId;
      row.querySelector('[data-model-field="mode"]').value = rule.mode || "all";
      row.querySelector('[data-model-field="count"]').value = Math.max(1, Number(rule.count) || 1);
      const colors = row.querySelector("[data-model-colors]");
      (model.colorOptions || []).filter((color) => color.active !== false && !color.isArchived && !color.isDeleted).forEach((color) => {
        const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
        input.type = "checkbox";
        input.value = color.name;
        input.checked = (rule.colors || []).includes(color.name);
        text.textContent = color.name;
        label.append(input, text);
        colors.appendChild(label);
      });
      syncModelRow(row);
      list.appendChild(fragment);
    });
    if (!models.length) {
      const empty = document.createElement("p");
      empty.className = "dart-settings-empty";
      empty.textContent = "Add a model first, then its card controls will appear here.";
      list.appendChild(empty);
    }
  }

  function syncModelRow(row) {
    const mode = row.querySelector('[data-model-field="mode"]')?.value;
    row.querySelector("[data-model-count-wrap]").hidden = mode !== "count";
    row.querySelector("[data-model-colors]").hidden = mode !== "custom";
  }

  function resetAnnouncementForm() {
    $("settings-announcement-form")?.reset();
    $("settings-announcement-id").value = "";
    $("settings-announcement-enabled").checked = true;
    $("save-announcement").textContent = "Add announcement";
    $("cancel-announcement-edit").hidden = true;
  }

  let promotionRows = [];

  function promotionMessage(message, error = false) {
    const node = $("settings-promotion-status-message");
    if (!node) return;
    node.textContent = message || "";
    node.dataset.state = error ? "error" : "success";
  }

  function resetPromotionForm() {
    $("settings-promotion-form")?.reset();
    $("settings-promotion-id").value = "";
    $("settings-promotion-version").value = "";
    $("settings-promotion-priority").value = "100";
    $("settings-promotion-total-limit").value = "0";
    $("settings-promotion-customer-limit").value = "1";
    $("settings-promotion-rule-value").value = "1";
    $("settings-promotion-min-order").value = "0";
    $("settings-promotion-min-quantity").value = "1";
    $("save-promotion").textContent = "Create campaign";
    $("cancel-promotion-edit").hidden = true;
  }

  function campaignPayloadFromForm() {
    const audience = $("settings-promotion-audience").value;
    const scopeMode = $("settings-promotion-scope").value;
    const scopeValues = $("settings-promotion-scope-values").value
      .split(",").map((value) => value.trim()).filter(Boolean);
    return {
      name: $("settings-promotion-name").value.trim(),
      code: $("settings-promotion-code").value.trim().toUpperCase(),
      status: $("settings-promotion-status").value,
      discountPercent: number("settings-promotion-percent", 0),
      ...($("settings-promotion-start").value ? { startsAt: $("settings-promotion-start").value } : {}),
      ...($("settings-promotion-end").value ? { endsAt: $("settings-promotion-end").value } : {}),
      automatic: $("settings-promotion-automatic").checked,
      priority: Math.round(number("settings-promotion-priority", 100)),
      minOrderMinor: Math.round(Math.max(0, number("settings-promotion-min-order", 0)) * 100),
      minQuantity: Math.max(1, Math.round(number("settings-promotion-min-quantity", 1))),
      totalUsageLimit: Math.max(0, Math.round(number("settings-promotion-total-limit", 0))),
      perCustomerUsageLimit: Math.max(0, Math.round(number("settings-promotion-customer-limit", 1))),
      limitBasis: $("settings-promotion-limit-basis").value,
      audience,
      ...(audience === "advanced" ? { customerRules: {
        field: $("settings-promotion-rule-field").value,
        operator: $("settings-promotion-rule-operator").value,
        value: Math.max(0, number("settings-promotion-rule-value", 1)),
      } } : {}),
      productScope: { mode: scopeMode, values: scopeMode === "all" ? [] : scopeValues },
      stacking: "none",
    };
  }

  function renderPromotions(rows = promotionRows) {
    const list = $("settings-promotions-list");
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "dart-settings-empty";
      empty.textContent = "No promotion campaigns yet.";
      list.appendChild(empty);
      return;
    }
    rows.forEach((campaign) => {
      const row = document.createElement("div");
      row.className = "dart-settings-list-row dart-promotion-row";
      row.dataset.promotionId = campaign.id;
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${campaign.name} · ${campaign.discountPercent}%`;
      const details = document.createElement("small");
      const basis = campaign.limitBasis === "customers" ? "customers" : "orders";
      const limit = Number(campaign.totalUsageLimit || 0);
      const analytics = campaign.analytics || {};
      details.textContent = `${campaign.code} · ${campaign.status} · ${campaign.audience} · ${limit ? `first ${limit} ${basis}` : `unlimited ${basis}`} · reserved ${Number(analytics.reservations || 0)} · used ${Number(analytics.usages || 0)} · remaining ${analytics.remaining ?? "∞"}`;
      copy.append(title, details);
      const status = document.createElement("span");
      status.textContent = campaign.automatic ? "Automatic" : "Code";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.dataset.promotionAction = "edit";
      edit.textContent = "Edit";
      row.append(copy, status, edit);
      list.appendChild(row);
    });
  }

  async function loadPromotions() {
    if (!root.DartAdminApi?.request || root.DartAdminAccess?.can?.("promotions.read") !== true) return;
    try {
      const payload = await root.DartAdminApi.request("/api/v1/admin/promotions");
      const rows = Array.isArray(payload.promotions) ? payload.promotions : [];
      promotionRows = await Promise.all(rows.map(async (campaign) => {
        try {
          const analytics = await root.DartAdminApi.request(`/api/v1/admin/promotions/${encodeURIComponent(campaign.id)}/analytics`);
          return { ...campaign, analytics };
        } catch { return campaign; }
      }));
      renderPromotions();
    } catch (error) {
      promotionMessage(error.message || "Unable to load promotion campaigns.", true);
    }
  }

  $("settings-commerce-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = root.DartSiteSettings.get();
    next.defaultMarkupPercent = Math.max(0, number("settings-default-markup", 50));
    next.courierFeePerOrder = Math.max(0, number("settings-delivery-cost", 100));
    delete next.deliveryCostPerPiece;
    next.birthdayDiscountPercent = Math.min(100, Math.max(0, number("settings-birthday-discount", 30)));
    next.dartCardDiscountPercent = Math.min(100, Math.max(0, number("settings-card-discount", 40)));
    next.refundCustomerFee = Math.max(0, number("settings-refund-fee", 100));
    next.repeatExchangeCustomerFee = Math.max(0, number("settings-repeat-exchange-fee", 50));
    saveSettings(next, "Pricing and future-record fee defaults updated");
  });

  $("settings-cod-risk-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const medium = Math.max(1, Math.min(98, number("settings-cod-medium-score", 20)));
    const high = Math.max(2, Math.min(99, number("settings-cod-high-score", 50)));
    const restricted = Math.max(3, Math.min(100, number("settings-cod-restricted-score", 80)));
    const highValueMinor = Math.max(0, Math.round(number("settings-cod-high-value", 3000) * 100));
    const restrictedValueMinor = Math.max(0, Math.round(number("settings-cod-restricted-value", 7500) * 100));
    if (!(medium < high && high < restricted)) {
      announce("Risk score thresholds must be ordered Medium < High < Restricted.", true);
      return;
    }
    if (restrictedValueMinor < highValueMinor) {
      announce("Restricted order value must be greater than or equal to High order value.", true);
      return;
    }
    const next = root.DartSiteSettings.get();
    next.codRisk = {
      ...(next.codRisk || {}),
      version: Math.max(1, Number(next.codRisk?.version) || 1),
      refusalWindowDays: Math.max(1, Math.round(number("settings-cod-refusal-window", 90))),
      manualReviewRefusalCount: Math.max(2, Math.round(number("settings-cod-manual-refusals", 2))),
      rapidRepeatWindowMinutes: Math.max(1, Math.round(number("settings-cod-rapid-window", 120))),
      rapidRepeatOrderCount: Math.max(2, Math.round(number("settings-cod-rapid-count", 3))),
      highOrderValueMinor: highValueMinor,
      restrictedOrderValueMinor: restrictedValueMinor,
      mediumScoreMin: medium,
      highScoreMin: high,
      restrictedScoreMin: restricted,
      requireFirstOrderVerification: $("settings-cod-first-order").checked,
      requireUnverifiedPhoneVerification: $("settings-cod-unverified-phone").checked,
    };
    saveSettings(next, "COD risk thresholds updated");
  });

  $("settings-waiting-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = root.DartSiteSettings.get();
    next.waiting = {
      enabled: $("settings-waiting-enabled").checked,
      reservationHours: Math.min(72, Math.max(1, number("settings-waiting-hours", 4))),
      alternativeColorsEnabled: $("settings-waiting-alternatives").checked,
      emailNotificationEnabled: $("settings-waiting-email").checked,
      inSiteNotificationEnabled: $("settings-waiting-site").checked,
    };
    saveSettings(next, "Waiting reservation settings updated");
  });

  $("settings-promotion-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("save-promotion");
    const start = $("settings-promotion-start").value;
    const end = $("settings-promotion-end").value;
    if (start && end && end < start) return promotionMessage("End date must be on or after start date.", true);
    if ($("settings-promotion-scope").value !== "all" && !$("settings-promotion-scope-values").value.trim()) {
      return promotionMessage("Enter at least one category, model, or item code for this scope.", true);
    }
    const id = $("settings-promotion-id").value;
    button.disabled = true;
    promotionMessage("Saving campaign…");
    try {
      const promotion = campaignPayloadFromForm();
      if (id) {
        await root.DartAdminApi.request(`/api/v1/admin/promotions/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: { expectedVersion: Number($("settings-promotion-version").value), promotion },
        });
      } else {
        await root.DartAdminApi.request("/api/v1/admin/promotions", { method: "POST", body: promotion });
      }
      resetPromotionForm();
      promotionMessage(id ? "Campaign updated." : "Campaign created.");
      await loadPromotions();
    } catch (error) {
      promotionMessage(error.message || "Unable to save campaign.", true);
    } finally { button.disabled = false; }
  });

  $("cancel-promotion-edit")?.addEventListener("click", resetPromotionForm);
  $("settings-promotions-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-promotion-action='edit']");
    const id = button?.closest("[data-promotion-id]")?.dataset.promotionId;
    const campaign = promotionRows.find((row) => row.id === id);
    if (!campaign) return;
    $("settings-promotion-id").value = campaign.id;
    $("settings-promotion-version").value = campaign.version;
    $("settings-promotion-name").value = campaign.name;
    $("settings-promotion-code").value = campaign.code;
    $("settings-promotion-percent").value = campaign.discountPercent;
    $("settings-promotion-status").value = campaign.status;
    $("settings-promotion-start").value = campaign.startsAt || "";
    $("settings-promotion-end").value = campaign.endsAt || "";
    $("settings-promotion-automatic").checked = Boolean(campaign.automatic);
    $("settings-promotion-priority").value = campaign.priority;
    $("settings-promotion-limit-basis").value = campaign.limitBasis || "orders";
    $("settings-promotion-total-limit").value = campaign.totalUsageLimit || 0;
    $("settings-promotion-customer-limit").value = campaign.perCustomerUsageLimit || 0;
    $("settings-promotion-audience").value = campaign.audience || "all";
    if (campaign.customerRules && !campaign.customerRules.rules) {
      $("settings-promotion-rule-field").value = campaign.customerRules.field || "ordersCount";
      $("settings-promotion-rule-operator").value = campaign.customerRules.operator || "gte";
      $("settings-promotion-rule-value").value = campaign.customerRules.value ?? 1;
    }
    $("settings-promotion-min-order").value = Number(campaign.minOrderMinor || 0) / 100;
    $("settings-promotion-min-quantity").value = campaign.minQuantity || 1;
    $("settings-promotion-scope").value = campaign.productScope?.mode || "all";
    $("settings-promotion-scope-values").value = (campaign.productScope?.values || []).join(", ");
    $("save-promotion").textContent = "Save campaign";
    $("cancel-promotion-edit").hidden = false;
    $("settings-promotion-name").focus();
  });

  $("settings-media-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = root.DartSiteSettings.get();
    const uploads = [
      ["settings-hero-day", "heroDayImage"], ["settings-hero-night", "heroNightImage"], ["settings-founder-image", "founderImage"],
    ];
    try {
      for (const [id, key] of uploads) {
        const file = $(id).files?.[0];
        if (file) next[key] = await root.DartCatalog.saveImage(file);
      }
      const saved = await saveSettings(next, "Site media replaced");
      if (!saved) return;
      event.target.reset();
      renderMedia(saved);
    } catch (error) { announce(error.message || "تعذر حفظ الصورة.", true); }
  });

  $("clear-media-settings")?.addEventListener("click", async () => {
    const next = root.DartSiteSettings.get();
    next.heroDayImage = null; next.heroNightImage = null; next.founderImage = null;
    const saved = await saveSettings(next, "Site media restored to original files");
    if (saved) renderMedia(saved);
  });

  $("settings-announcement-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = $("settings-announcement-start").value, end = $("settings-announcement-end").value;
    if (start && end && end < start) return announce("تاريخ نهاية الخبر يجب أن يكون بعد تاريخ البداية.", true);
    const next = root.DartSiteSettings.get(), editId = $("settings-announcement-id").value;
    const payload = { id: editId || uid("NEWS"), text: $("settings-announcement-text").value.trim(), startsAt: start, endsAt: end, order: number("settings-announcement-order", 0), enabled: $("settings-announcement-enabled").checked, updatedAt: new Date().toISOString() };
    const existing = next.announcements.find((row) => row.id === editId);
    if (existing) Object.assign(existing, payload); else next.announcements.push({ ...payload, createdAt: payload.updatedAt });
    saveSettings(next, editId ? "Announcement updated" : "Announcement added");
    resetAnnouncementForm(); renderAnnouncements(next);
  });

  $("settings-announcements-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-announcement-action]"), row = button?.closest("[data-announcement-row]");
    if (!button || !row) return;
    const settings = root.DartSiteSettings.get(), item = settings.announcements.find((entry) => entry.id === row.dataset.id);
    if (!item) return;
    if (button.dataset.announcementAction === "delete") {
      if (!await root.DartDialog.confirm("Delete this scheduled announcement?")) return;
      settings.announcements = settings.announcements.filter((entry) => entry.id !== item.id);
      saveSettings(settings, "Announcement deleted"); renderAnnouncements(settings); return;
    }
    $("settings-announcement-id").value = item.id;
    $("settings-announcement-text").value = item.text;
    $("settings-announcement-start").value = item.startsAt || "";
    $("settings-announcement-end").value = item.endsAt || "";
    $("settings-announcement-order").value = item.order || 0;
    $("settings-announcement-enabled").checked = item.enabled !== false;
    $("save-announcement").textContent = "Save announcement";
    $("cancel-announcement-edit").hidden = false;
  });
  $("cancel-announcement-edit")?.addEventListener("click", resetAnnouncementForm);

  $("add-typing-word")?.addEventListener("click", () => {
    const rows = [...document.querySelectorAll("[data-typing-row]")];
    addTypingRow(Math.max(1, Number(rows.at(-1)?.querySelector('[data-typing-field="scene"]')?.value) || 1), 2000, null);
  });
  $("settings-typing-rows")?.addEventListener("click", (event) => event.target.closest("[data-typing-remove]")?.closest("[data-typing-row]")?.remove());
  $("settings-typing-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const grouped = new Map();
    document.querySelectorAll("[data-typing-row]").forEach((row) => {
      const scene = Math.max(1, Number(row.querySelector('[data-typing-field="scene"]').value) || 1);
      if (!grouped.has(scene)) grouped.set(scene, { hold: Math.max(0, Number(row.querySelector('[data-typing-field="hold"]').value) || 0), words: [] });
      grouped.get(scene).words.push({ text: row.querySelector('[data-typing-field="text"]').value.trim(), color: row.querySelector('[data-typing-field="color"]').value, size: Math.max(10, Number(row.querySelector('[data-typing-field="size"]').value) || 36), weight: Math.min(900, Math.max(100, Number(row.querySelector('[data-typing-field="weight"]').value) || 400)) });
    });
    if (!grouped.size) return announce("أضف كلمة واحدة على الأقل للهيرو.", true);
    const next = root.DartSiteSettings.get();
    next.typing = { typingSpeed: Math.max(10, number("settings-typing-speed", 70)), deletingSpeed: Math.max(5, number("settings-deleting-speed", 10)), wordDelay: Math.max(0, number("settings-word-delay", 100)), nextSceneDelay: Math.max(0, number("settings-scene-delay", 400)), scenes: [...grouped.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]) };
    saveSettings(next, "Hero typing animation updated");
  });

  $("settings-model-cards-list")?.addEventListener("change", (event) => {
    const row = event.target.closest("[data-model-card-row]"); if (row) syncModelRow(row);
  });
  $("settings-model-cards-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = root.DartSiteSettings.get(); next.modelCards = {};
    document.querySelectorAll("[data-model-card-row]").forEach((row) => {
      const mode = row.querySelector('[data-model-field="mode"]').value;
      next.modelCards[row.dataset.modelId] = { mode, count: Math.max(1, Number(row.querySelector('[data-model-field="count"]').value) || 1), colors: [...row.querySelectorAll('[data-model-colors] input:checked')].map((input) => input.value) };
    });
    saveSettings(next, "Product card color visibility updated");
  });

  function renderSettings(settings = root.DartSiteSettings.get()) {
    fillGeneral(settings);
    renderMedia(settings);
    renderAnnouncements(settings);
    renderTyping(settings);
    renderModelCards(settings);
  }

  async function init() {
    let settings = root.DartSiteSettings.get();
    try {
      settings = await root.DartSiteSettings.hydrate?.(true) || settings;
    } catch (error) {
      announce(error.message || "تعذر تحميل أحدث إعدادات الموقع.", true);
    }
    renderSettings(settings);
  }
  document.addEventListener("DOMContentLoaded", () => { void init(); });
  root.addEventListener("dart:admin-authenticated", () => { void loadPromotions(); });
  root.addEventListener("dart:site-settings-changed", (event) => {
    renderSettings(event.detail || root.DartSiteSettings.get());
  });
  root.addEventListener("dart:data-changed", (event) => { if (event.detail?.key === "dart_models") renderModelCards(root.DartSiteSettings.get()); });
})(typeof window !== "undefined" ? window : globalThis);


/* BEGIN Settings internal navigation */
(function (root) {
  "use strict";
  if (!root.document) return;

  const content = document.getElementById("settings-content");
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  if (!content || !tabs.length) return;

  const allowed = new Set(["general", "hero", "staff"]);

  function activateSettingsTab(requested) {
    const target =
      allowed.has(requested) &&
      tabs.some((tab) => tab.dataset.settingsTab === requested && !tab.hidden)
        ? requested
        : "general";

    content.dataset.activeSettingsTab = target;
    tabs.forEach((tab) => {
      const active = tab.dataset.settingsTab === target;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    try {
      root.sessionStorage.setItem("dart_settings_tab", target);
    } catch {}
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateSettingsTab(tab.dataset.settingsTab));
  });

  let initial = "general";
  try {
    initial = root.sessionStorage.getItem("dart_settings_tab") || "general";
  } catch {}
  activateSettingsTab(initial);

  root.DartSettingsTabs = Object.freeze({
    activate: activateSettingsTab,
    refresh() {
      const active = content.dataset.activeSettingsTab || "general";
      activateSettingsTab(active);
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
/* END Settings internal navigation */

// END MODULE
