/* DART RETURN WIZARD — only controls two-step presentation; platform owns submission. */
(() => {
  "use strict";

  const initialize = () => {
    const form = document.getElementById("returnRequestForm");
    const first = document.getElementById("return-step-details");
    const second = document.getElementById("return-step-address");
    const pickup = document.getElementById("return-pickup-address");
    const next = document.getElementById("return-next-step");
    const back = document.getElementById("return-back-step");
    const markers = document.querySelectorAll(".dart-return-progress-step");
    if (!form || !first || !second || !pickup || !next || !back || form.dataset.returnWizardBound) return;
    form.dataset.returnWizardBound = "1";

    const setStage = (stage, focus = true) => {
      const showingAddress = stage === "address";
      pickup.disabled = !showingAddress;
      first.hidden = showingAddress;
      second.hidden = !showingAddress;
      form.dataset.dartReturnStep = stage;
      markers.forEach((marker, index) => {
        if (index === (showingAddress ? 1 : 0)) {
          marker.setAttribute("aria-current", "step");
        } else {
          marker.removeAttribute("aria-current");
        }
      });
      if (showingAddress) {
        // The existing Leaflet map is initialized while the second step is hidden.
        const resizeMap = () => {
          const map = window.dartReturnAddress || window.DartAddress?.initReturnRequest?.();
          map?.invalidate?.();
        };
        requestAnimationFrame(resizeMap);
        setTimeout(resizeMap, 180);
      }
      if (focus) {
        const heading = document.getElementById(showingAddress ? "return-address-heading" : "return-details-heading");
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    };

    const advance = () => {
      const invalid = Array.from(first.querySelectorAll("input, select, textarea"))
        .find((field) => !field.disabled && field.willValidate && !field.checkValidity());
      if (invalid) {
        invalid.focus();
        invalid.reportValidity();
        return false;
      }
      setStage("address");
      return true;
    };

    next.addEventListener("click", advance);
    back.addEventListener("click", () => setStage("details"));

    // Enter on the first step must never submit the request without an address.
    form.addEventListener("submit", (event) => {
      if (form.dataset.dartReturnStep === "address") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      advance();
    }, true);

    // Browser validity can change after asynchronous catalogue/prefill updates.
    form.addEventListener("invalid", (event) => {
      if (first.hidden && first.contains(event.target)) setStage("details", false);
      if (second.hidden && second.contains(event.target)) setStage("address", false);
    }, true);

    form.addEventListener("reset", () => {
      setTimeout(() => setStage("details", false), 0);
    });

    setStage("details", false);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
