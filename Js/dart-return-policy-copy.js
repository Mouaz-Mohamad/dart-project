/* DART | Current after-sales period copy. Existing orders use their own checkout snapshot. */
(function () {
  "use strict";
  function init() {
    const exchange = document.getElementById("dart-exchange-policy-days");
    const refund = document.getElementById("dart-refund-policy-days");
    if (!exchange || !refund) return;
    function render(settings = window.DartSiteSettings?.get?.() || {}) {
      const days = value => Number.isSafeInteger(value) && value >= 0 ? value : 14;
      const label = value => value === 0 ? "0 يوم (غير متاح)" : `${value} يوم`;
      exchange.textContent = label(days(settings.exchangePeriodDays));
      refund.textContent = label(days(settings.refundPeriodDays));
    }
    window.addEventListener("dart:site-settings-changed", event => render(event.detail));
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
