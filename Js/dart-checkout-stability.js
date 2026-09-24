// DART CODE GUIDE | Js/dart-checkout-stability.js
// الغرض: تثبيت تجربة Checkout على الموبايل بدون تغيير قواعد العنوان الخادمية.
// يحافظ على الـpin الموثق عند كتابة Building/Floor، ينتظر reverse-geocoding الجاري،
// ويعرض Adding… فور بدء إرسال الطلب مع منع النقرات المتكررة.

(function (root) {
  "use strict";

  function init() {
    const form = document.getElementById("checkoutForm");
    if (!form || form.dataset.dartCheckoutStability === "1") return;
    form.dataset.dartCheckoutStability = "1";

    const lat = document.getElementById("lat-input");
    const lng = document.getElementById("lng-input");
    const status = document.getElementById("checkout-address-status");
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    const building = document.getElementById("checkout-building");
    const floor = document.getElementById("checkout-floor");
    const routeFields = [
      document.getElementById("checkout-country"),
      document.getElementById("governorate-select"),
      document.getElementById("area-input"),
      document.getElementById("street-input"),
    ].filter(Boolean);

    const originalLabel = submit
      ? (submit.tagName === "INPUT" ? submit.value : submit.textContent) || "Order"
      : "Order";
    let lastVerified = null;
    let routeRevision = 0;
    let waitingForAddress = false;

    function coordinatesValid() {
      const latitude = Number(String(lat?.value || "").trim());
      const longitude = Number(String(lng?.value || "").trim());
      return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0;
    }

    function snapshotVerifiedLocation() {
      if (!coordinatesValid() || form.dataset.dartDeliveryZone !== "cairo-giza") return;
      lastVerified = {
        lat: lat.value,
        lng: lng.value,
        source: form.dataset.dartAddressSource || "map",
        routeRevision,
      };
    }

    function restoreVerifiedLocationAfterUnitEdit() {
      queueMicrotask(() => {
        if (!lastVerified || lastVerified.routeRevision !== routeRevision) return;
        if (form.dataset.dartAddressApplying === "true") return;
        if (coordinatesValid() && form.dataset.dartDeliveryZone === "cairo-giza") return;
        if (lat) lat.value = lastVerified.lat;
        if (lng) lng.value = lastVerified.lng;
        form.dataset.dartAddressSource = lastVerified.source;
        form.dataset.dartAddressReady = "true";
        form.dataset.dartDeliveryZone = "cairo-giza";
      });
    }

    form.addEventListener("dart:address-selected", snapshotVerifiedLocation);
    snapshotVerifiedLocation();

    for (const field of [building, floor].filter(Boolean)) {
      field.addEventListener("input", restoreVerifiedLocationAfterUnitEdit);
      field.addEventListener("change", restoreVerifiedLocationAfterUnitEdit);
    }

    for (const field of routeFields) {
      const invalidate = () => {
        if (form.dataset.dartAddressApplying === "true") return;
        routeRevision += 1;
        lastVerified = null;
      };
      field.addEventListener("input", invalidate);
      field.addEventListener("change", invalidate);
    }

    function setAdding(active) {
      if (!submit) return;
      if (submit.tagName === "INPUT") submit.value = active ? "Adding…" : originalLabel;
      else submit.textContent = active ? "Adding…" : originalLabel;
    }

    const busyObserver = new MutationObserver(() => {
      const busy = form.getAttribute("aria-busy") === "true";
      setAdding(busy);
    });
    busyObserver.observe(form, { attributes: true, attributeFilter: ["aria-busy"] });

    // If the user taps Order while mobile reverse-geocoding is still running,
    // keep this single tap alive and continue automatically after the pin is verified.
    form.addEventListener("submit", (event) => {
      if (waitingForAddress) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (status?.dataset.state !== "loading") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      waitingForAddress = true;
      form.setAttribute("aria-busy", "true");
      if (submit) submit.disabled = true;

      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        waitingForAddress = false;
        form.removeAttribute("aria-busy");
        if (submit) submit.disabled = false;
        if (ok) {
          snapshotVerifiedLocation();
          queueMicrotask(() => form.requestSubmit(submit || undefined));
        }
      };

      const selected = () => finish(true);
      const rejected = () => finish(false);
      form.addEventListener("dart:address-selected", selected, { once: true });
      form.addEventListener("dart:address-rejected", rejected, { once: true });
      window.setTimeout(() => {
        const ok = coordinatesValid() && form.dataset.dartDeliveryZone === "cairo-giza";
        finish(ok);
      }, 8000);
    }, true);

    // Keep the visible button state synced even when checkout fails validation/API
    // and dart-platform.js releases its own submission lock.
    if (submit) {
      const submitObserver = new MutationObserver(() => {
        if (form.getAttribute("aria-busy") !== "true" && !submit.disabled) setAdding(false);
      });
      submitObserver.observe(submit, { attributes: true, attributeFilter: ["disabled"] });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
