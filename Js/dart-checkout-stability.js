// DART CODE GUIDE | Js/dart-checkout-stability.js
// Keep checkout unavailable during address verification. A failed or timed-out
// lookup never queues an order or falls back to an earlier delivery location.
(function () {
  "use strict";

  const checkoutPhone = value => (window.DartPlatform?.normalizePhone?.(value) || String(value || "")).replace(/^\+20/, "0");

  function refreshCheckoutContact() {
    const form = document.getElementById("checkoutForm"),
      user = window.DartPlatform?.currentUser?.();
    if (!form) return;
    const owner = user ? String(user.id) : "guest";
    const previousOwner = form.dataset.checkoutContactOwner;
    const changedOwner = previousOwner !== undefined ? previousOwner !== owner : Boolean(user);
    const values = {
      customer_name: user?.name || "",
      phone1: checkoutPhone(user?.phone1) || "",
      phone2: checkoutPhone(user?.phone2) || "",
      email: user?.email || "",
      birthday: user?.birthday || "",
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      // Never carry a guest's draft contact into an account, or one account's
      // private contact into the next session. Preserve edits to missing fields.
      if (changedOwner || (user && value)) {
        field.value = value || "";
        if (name === "birthday") field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const group = field.closest(".form-group");
      if (!group) return;
      const missingRequiredContact = ["customer_name", "phone1"].includes(name) && !String(value).trim();
      group.hidden = Boolean(user) && !missingRequiredContact;
      group.querySelectorAll("input,select").forEach((control) => {
        if (control.dataset.checkoutRequired === undefined) control.dataset.checkoutRequired = String(control.required);
        control.disabled = group.hidden;
        control.required = !group.hidden && control.dataset.checkoutRequired === "true";
      });
    });
    form.dataset.checkoutContactOwner = owner;
    document.querySelectorAll("[data-checkout-guest]").forEach((element) => { element.hidden = Boolean(user); });
  }

  function init() {
    const form = document.getElementById("checkoutForm");
    if (!form || form.dataset.dartCheckoutStability === "1") return;
    form.dataset.dartCheckoutStability = "1";
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submit) return;
    const originalLabel = (submit.tagName === "INPUT" ? submit.value : submit.textContent) || "Order";
    const extraDetails = document.getElementById("checkout-extra-details");
    // Native validation happens before submit. Reveal invalid collapsed fields
    // synchronously so the browser can focus them and explain what is missing.
    form.addEventListener("invalid", (event) => {
      if (extraDetails?.contains(event.target)) extraDetails.open = true;
    }, true);

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
      if (form.dataset.dartAddressState !== "loading" && form.getAttribute("aria-busy") !== "true") {
        // Coverage checks can also require a city/area without a native invalid field.
        const address = window.dartCheckoutAddress?.validate?.();
        if (extraDetails && address && !address.ok) extraDetails.open = true;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      sync();
    }, true);
    sync();
    refreshCheckoutContact();
    window.addEventListener("dart:customer-session-changed", refreshCheckoutContact);
    form.addEventListener("reset", () => window.setTimeout(refreshCheckoutContact, 0));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
