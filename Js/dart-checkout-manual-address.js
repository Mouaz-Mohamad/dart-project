// DART | Manual checkout address. No map, geocoding or inferred coordinates.
(() => {
  "use strict";
  function init() {
    const form = document.getElementById("checkoutForm");
    if (!form || form.dataset.dartManualAddressInit === "1") return;
    form.dataset.dartManualAddressInit = "1";
    form.dataset.dartAddressSource = "manual";
    form.dataset.dartAddressState = "ready";
    const ids = {
      country: "checkout-country", governorate: "governorate-select",
      area: "area-input", street: "street-input", building: "checkout-building",
      floor: "checkout-floor", fullAddress: "formatted-address-input",
    };
    const fields = Object.fromEntries(Object.entries(ids)
      .map(([key, id]) => [key, document.getElementById(id)]));
    const status = document.getElementById("checkout-address-status");
    let userEdited = false;
    const read = (name) => String(fields[name]?.value || "").trim();
    const coverageFields = () => ({
      city: String(form.elements.namedItem("city")?.value || "").trim(),
      coverageArea: String(form.elements.namedItem("coverageArea")?.value || "").trim(),
    });
    function refresh() {
      if (fields.fullAddress)
        fields.fullAddress.value = ["building", "street", "area", "governorate", "country"]
          .map(read).filter(Boolean).join(", ");
      if (status) {
        status.textContent = "راجع عنوان التوصيل بالكامل قبل تأكيد الأوردر.";
        status.dataset.state = "ready";
      }
    }
    function validate() {
      if (["country", "governorate", "area", "street", "building", "floor"].some(name => !read(name)))
        return { ok: false, message: "أكمل المحافظة والمنطقة والشارع ورقم المبنى والدور." };
      if (read("country").toLowerCase() !== "egypt")
        return { ok: false, message: "التوصيل متاح داخل مصر فقط." };
      const shipping = window.DartShippingAvailability;
      if (!shipping?.ready)
        return { ok: false, message: "تعذر تحميل تغطية التوصيل. اضغط إعادة المحاولة ثم أكد الأوردر." };
      if (!shipping.isAddressCovered({ governorate: read("governorate"), ...coverageFields() }))
        return { ok: false, message: "التوصيل غير متاح للمنطقة المختارة حاليًا." };
      return { ok: true, source: "manual", zone: "coverage-enabled" };
    }
    function snapshot() {
      return JSON.stringify([
        ...Object.keys(ids).map(read), ...Object.values(coverageFields()),
        window.DartShippingAvailability?.ready === true,
      ]);
    }
    function restore(saved) {
      if (userEdited || !saved || typeof saved !== "object") return;
      for (const name of ["country", "governorate", "area", "street", "building", "floor"]) {
        if (!saved[name] || !fields[name]) continue;
        fields[name].value = String(saved[name]);
        if (name === "governorate")
          fields[name].dispatchEvent(new Event("change", { bubbles: true }));
      }
      refresh();
    }
    form.addEventListener("input", () => { userEdited = true; refresh(); });
    form.addEventListener("change", () => { userEdited = true; refresh(); });
    window.addEventListener("dart:saved-address-hydrated", (event) => restore(event.detail?.address));
    window.addEventListener("dart:shipping-coverage-loaded", refresh);
    window.dartCheckoutAddress = Object.freeze({
      fields, validate, snapshot,
      isCurrentSnapshot: (before) => before === snapshot() && validate().ok,
      invalidate: () => {},
    });
    refresh();
    restore(window.DartState?.read?.("user_last_address", null));
    document.dispatchEvent(new Event("dart:checkout-address-ready"));
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
