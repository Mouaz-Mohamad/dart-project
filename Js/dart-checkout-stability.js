// DART CODE GUIDE | Js/dart-checkout-stability.js
// Keep checkout unavailable during address verification. A failed or timed-out
// lookup never queues an order or falls back to an earlier delivery location.
(function () {
  "use strict";

  function init() {
    const form = document.getElementById("checkoutForm");
    if (!form || form.dataset.dartCheckoutStability === "1") return;
    form.dataset.dartCheckoutStability = "1";
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submit) return;
    const originalLabel = (submit.tagName === "INPUT" ? submit.value : submit.textContent) || "Order";

    function sync() {
      const verifying = form.dataset.dartAddressState === "loading";
      const busy = form.getAttribute("aria-busy") === "true";
      const disabled = verifying || busy;
      const label = busy ? "Adding…" : verifying ? "Checking location…" : originalLabel;
      if (submit.disabled !== disabled) submit.disabled = disabled;
      if (submit.tagName === "INPUT") {
        if (submit.value !== label) submit.value = label;
      } else if (submit.textContent !== label) submit.textContent = label;
    }

    form.addEventListener("dart:address-state", sync);
    new MutationObserver(sync).observe(form, { attributes: true, attributeFilter: ["aria-busy"] });
    new MutationObserver(sync).observe(submit, { attributes: true, attributeFilter: ["disabled"] });
    // Covers Enter and programmatic requestSubmit, as well as ordinary clicks.
    form.addEventListener("submit", (event) => {
      if (form.dataset.dartAddressState !== "loading" && form.getAttribute("aria-busy") !== "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      sync();
    }, true);
    sync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
