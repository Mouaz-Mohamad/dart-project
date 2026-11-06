/* DART Eye | Authenticated, independent after-sales period settings. */
(function () {
  "use strict";
  function init() {
    const form = document.getElementById("settings-return-period-form");
    const exchange = document.getElementById("settings-exchange-period");
    const refund = document.getElementById("settings-refund-period");
    const status = document.getElementById("settings-return-period-status");
    if (!form || !exchange || !refund || !status || !window.DartSiteSettings) return;
    let dirty = false, saving = false;
    function paint(settings = window.DartSiteSettings.get()) {
      if (dirty || saving) return;
      exchange.value = String(settings.exchangePeriodDays ?? 14);
      refund.value = String(settings.refundPeriodDays ?? 14);
    }
    form.addEventListener("input", () => { dirty = true; status.textContent = ""; });
    window.addEventListener("dart:site-settings-changed", event => paint(event.detail));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving) return;
      const a = Number(exchange.value), b = Number(refund.value);
      if (![a, b].every(n => Number.isSafeInteger(n) && n >= 0)) {
        status.textContent = "Enter valid nonnegative whole-number days."; return;
      }
      if (window.DartAdminAccess?.can?.("settings.manage") !== true) {
        status.textContent = "You cannot change these settings."; return;
      }
      saving = true;
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      status.textContent = "Saving…";
      try {
        const current = await window.DartSiteSettings.hydrate(true);
        const saved = await window.DartSiteSettings.sync({ ...current, exchangePeriodDays: a, refundPeriodDays: b });
        dirty = false; delete form.dataset.dirty;
        form.querySelector(".dart-settings-draft-note")?.remove();
        status.textContent = "Saved. New orders use these periods.";
        paint(saved);
      } catch (error) {
        status.textContent = error?.message || "Save failed. Retry.";
      } finally { saving = false; if (button) button.disabled = false; }
    });
    paint();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
