// Dart checkout: one Google Maps viewport, with a safe manual-address fallback.
// No Leaflet, OpenStreetMap, Nominatim, or guessed delivery coordinates.
(() => {
  "use strict";
  const apiBase = () => String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "");
  const read = (el) => String(el?.value || "").trim();
  function init() {
    const form = document.getElementById("checkoutForm");
    const panel = document.getElementById("dart-checkout-google-map");
    if (!form || !panel || form.dataset.dartGoogleCheckoutInit) return;
    form.dataset.dartGoogleCheckoutInit = "1";
    const get = (id) => document.getElementById(id);
    const fields = {
      country: get("checkout-country"), governorate: get("governorate-select"),
      area: get("area-input"), street: get("street-input"),
      building: get("checkout-building"), floor: get("checkout-floor"),
      latitude: get("lat-input"), longitude: get("lng-input"),
      fullAddress: get("formatted-address-input"),
    };
    const status = get("checkout-address-status");
    const button = get("dart-google-search");
    const search = get("address-input");
    let map = null, marker = null, geocoder = null, loading = null;
    let checked = false, version = 0, userEdited = false, errorMessage = "";
    form.dataset.dartAddressSource = "manual";
    form.dataset.dartAddressState = "ready";

    const shipFields = () => ({
      governorate: read(fields.governorate),
      city: read(form.elements.namedItem("city")),
      coverageArea: read(form.elements.namedItem("coverageArea")),
    });
    const addressString = () => [read(fields.building), read(fields.street),
      read(fields.area), read(fields.governorate), "Egypt"].filter(Boolean).join(", ");
    function setStatus(message, state = "ready") {
      if (status) { status.textContent = message; status.dataset.state = state; }
      form.dataset.dartAddressState = state;
      form.dispatchEvent(new CustomEvent("dart:address-state", { bubbles: true, detail: { state } }));
    }
    function refresh() { fields.fullAddress.value = addressString(); }
    function clearPin() {
      version += 1;
      checked = false;
      fields.latitude.value = "";
      fields.longitude.value = "";
      form.dataset.dartAddressSource = "manual";
      if (marker) { marker.setMap(null); marker = null; }
      // A form edit supersedes an in-flight pin check: never leave submit locked.
      if (form.dataset.dartAddressState === "loading")
        setStatus("Location changed. Choose a new pin or use the manual address.", "ready");
    }
    function validate() {
      if (form.dataset.dartAddressState === "loading") return {
        ok: false, message: "Checking selected Google Maps location..." };
      if (["country", "governorate", "area", "street", "building", "floor"].some(k => !read(fields[k])))
        return { ok: false, message: "أكمل المحافظة والمنطقة والشارع ورقم المبنى والدور." };
      if (read(fields.country).toLowerCase() !== "egypt")
        return { ok: false, message: "التوصيل متاح داخل مصر فقط." };
      const shipping = window.DartShippingAvailability;
      if (!shipping?.ready) return {
        ok: false, message: "تعذر تحميل مناطق التوصيل. أعد المحاولة قبل تأكيد الأوردر." };
      if (!shipping.isAddressCovered(shipFields()))
        return { ok: false, message: "التوصيل غير متاح للمحافظة أو المنطقة المختارة." };
      if (form.dataset.dartAddressSource === "map" && !checked)
        return { ok: false, message: "Location verification is incomplete." };
      return { ok: true, source: checked ? "map" : "manual", zone: "coverage-enabled" };
    }
    const snapshot = () => JSON.stringify([
      ...["country","governorate","area","street","building","floor","latitude","longitude"].map(k => read(fields[k])),
      ...Object.values(shipFields()), form.dataset.dartAddressSource, version,
    ]);
    const restore = (saved) => {
      if (!saved || userEdited) return;
      for (const key of ["country","governorate","area","street","building","floor"]) {
        if (!saved[key] || !fields[key]) continue;
        fields[key].value = String(saved[key]);
      }
      fields.governorate.dispatchEvent(new Event("change", { bubbles: true }));
      refresh();
      if (saved.lat != null && saved.lng != null) {
        const lat = Number(saved.lat), lng = Number(saved.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          // Saved coordinates are NOT automatically trusted as a new verified pin.
          pendingSavedPin = { lat, lng };
          if (map) map.setCenter(pendingSavedPin);
        }
      }
    };
    let pendingSavedPin = null;
    async function selectLocation(lat, lng) {
      clearPin();
      const selection = version;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 21.5 || lat > 32.1 || lng < 24.5 || lng > 36.2) {
        setStatus("Choose a point inside Egypt.", "error"); return false;
      }
      if (!window.DartShippingAvailability?.ready) {
        setStatus("Delivery coverage is loading. Retry selecting the location.", "error"); return false;
      }
      const governorate = read(fields.governorate);
      if (!governorate) { setStatus("Choose a governorate before selecting a pin.", "error"); return false; }
      setStatus("Checking Google Maps location against Dart delivery coverage...", "loading");
      try {
        const response = await fetch(apiBase() + "/api/v1/shipping/validate-point", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ governorate, latitude: lat, longitude: lng }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Location verification is unavailable.");
        const result = await response.json();
        if (selection !== version) return false;
        if (result.valid !== true) {
          setStatus("النقطة خارج المحافظة المختارة. اختر موقعًا داخل المحافظة.", "error"); return false;
        }
        fields.latitude.value = lat.toFixed(7);
        fields.longitude.value = lng.toFixed(7);
        checked = true;
        form.dataset.dartAddressSource = "map";
        if (map) {
          if (marker) marker.setMap(null);
          marker = new google.maps.Marker({ position: { lat, lng }, map, title: "Verified delivery point" });
          map.panTo({ lat, lng });
        }
        refresh();
        setStatus("Location confirmed. Complete your address and check delivery coverage.", "success");
        return true;
      } catch {
        if (selection === version) {
          clearPin();
          setStatus("تعذر تأكيد الدبوس حاليًا. يمكنك كتابة العنوان يدويًا.", "error");
        }
        return false;
      }
    }
    async function googleLoader() {
      if (window.google?.maps?.Map) return true;
      const key = String(window.DART_GOOGLE_MAPS_BROWSER_KEY || "").trim();
      if (!key) { errorMessage = "Google Maps key is not configured."; return false; }
      return new Promise((resolve) => {
        const callback = "__dartCheckoutGoogleReady";
        let done = false;
        const finish = ok => {
          if (done) return; done = true;
          clearTimeout(timer); delete window[callback];
          resolve(Boolean(ok && window.google?.maps?.Map));
        };
        const timer = window.setTimeout(() => finish(false), 8000);
        window[callback] = () => finish(true);
        const priorFailure = window.gm_authFailure;
        window.gm_authFailure = () => {
          errorMessage = "Google Maps authentication failed. Check the key, enabled APIs, billing and website restrictions.";
          finish(false);
          if (typeof priorFailure === "function") priorFailure();
        };
        const script = document.createElement("script");
        script.async = true;
        script.referrerPolicy = "strict-origin-when-cross-origin";
        script.src = "https://maps.googleapis.com/maps/api/js?" +
          new URLSearchParams({ key, v: "weekly", loading: "async", callback });
        script.onerror = () => finish(false);
        document.head.appendChild(script);
      });
    }
    async function showMap() {
      if (map) return;
      if (loading) return loading;
      loading = (async () => {
        panel.replaceChildren();
        const busy = document.createElement("p");
        busy.textContent = "Loading Google Maps...";
        busy.style.padding = "14px";
        panel.appendChild(busy);
        if (!await googleLoader()) {
          panel.textContent = "Google Maps is unavailable. You can still enter a complete delivery address below.";
          setStatus(errorMessage || "Google Maps unavailable. Manual address entry is available.", "error");
          return;
        }
        if (!panel.isConnected) return;
        panel.replaceChildren();
        try { map = new google.maps.Map(panel, {
          center: pendingSavedPin || { lat: 30.0444, lng: 31.2357 },
          zoom: pendingSavedPin ? 15 : 11,
          clickableIcons: false, mapTypeControl: false,
          streetViewControl: false, fullscreenControl: false,
        }); } catch {
          map = null;
          panel.textContent = "Google Maps cannot be displayed right now. Enter your address manually.";
          setStatus("Google Maps error. Manual checkout is still available.", "error");
          return;
        }
        if (window.google.maps.Geocoder) geocoder = new google.maps.Geocoder();
        map.addListener("click", (event) => {
          const point = event.latLng;
          if (point) void selectLocation(point.lat(), point.lng());
        });
        if (pendingSavedPin) void selectLocation(pendingSavedPin.lat, pendingSavedPin.lng);
      })().finally(() => { loading = null; });
      return loading;
    }
    function readyForMap() {
      const view = get("checkoutView");
      if (!view) return true;
      return !view.hidden && getComputedStyle(view).display !== "none";
    }
    function maybeLoad() { if (readyForMap() && !map) void showMap(); }
    const view = get("checkoutView");
    if (view) new MutationObserver(maybeLoad).observe(view, {
      attributes: true, attributeFilter: ["style", "class", "hidden"],
    });
    button?.addEventListener("click", async () => {
      await showMap();
      if (!geocoder || !map) {
        setStatus("Google search is unavailable. Enter the address manually.", "error"); return;
      }
      const query = read(search) || addressString();
      if (!query) return;
      geocoder.geocode({ address: query + ", Egypt", componentRestrictions: { country: "EG" } },
        (results, resultStatus) => {
          if (resultStatus !== "OK" || !results?.[0]?.geometry?.location) {
            setStatus("Google could not find that address. Select the pin manually.", "error"); return;
          }
          const point = results[0].geometry.location;
          map.setCenter(point); map.setZoom(16);
          void selectLocation(point.lat(), point.lng());
        });
    });
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); button?.click(); }
    });
    get("dart-google-current-location")?.addEventListener("click", async () => {
      await showMap();
      if (!map) return;
      if (!navigator.geolocation) {
        setStatus("GPS is unavailable. Select your location on the map.", "error"); return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => { void selectLocation(pos.coords.latitude, pos.coords.longitude); },
        () => setStatus("Location permission denied. You can use manual address.", "error"),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
      );
    });
    form.addEventListener("input", (event) => {
      userEdited = true;
      if (Object.values(fields).includes(event.target)) clearPin();
      refresh();
    });
    form.addEventListener("change", (event) => {
      userEdited = true;
      if (Object.values(fields).includes(event.target) && event.target !== fields.fullAddress) clearPin();
      refresh();
    });
    window.addEventListener("dart:saved-address-hydrated", (event) => restore(event.detail?.address));
    window.addEventListener("dart:shipping-coverage-loaded", maybeLoad);
    window.dartCheckoutAddress = Object.freeze({
      fields, validate, snapshot, selectLocation, showMap,
      isCurrentSnapshot: old => old === snapshot() && validate().ok,
      invalidate: clearPin,
    });
    refresh();
    restore(window.DartState?.read?.("user_last_address", null));
    document.dispatchEvent(new Event("dart:checkout-address-ready"));
    maybeLoad();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
