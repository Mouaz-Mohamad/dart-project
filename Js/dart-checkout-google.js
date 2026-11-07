// Dart checkout: one Google Maps viewport, with a safe manual-address fallback.
// Google is the only address provider; delivery coordinates are never guessed.
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
    let checked = false, version = 0, userEdited = false, errorMessage = "", googleAddress = "";
    let searchVersion = 0, gpsVersion = 0;
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
    function refresh() { fields.fullAddress.value = checked && googleAddress
      ? [read(fields.building), googleAddress].filter(Boolean).join(", ") : addressString(); }
    function clearPin() {
      version += 1;
      checked = false;
      googleAddress = "";
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
    const geocode = request => new Promise((resolve, reject) => {
      geocoder.geocode(request, (results, resultStatus) => {
        if (resultStatus === "OK" && results?.[0]) resolve(results[0]);
        else reject(new Error(resultStatus === "ZERO_RESULTS" ? "No matching Google address found. Try a nearby street." :
          "Google address lookup is unavailable. Check Geocoding API access or retry."));
      });
    });
    function applyGoogleAddress(result) {
      const parts = result.address_components || [];
      const part = (...types) => parts.find(p => types.some(type => p.types.includes(type)))?.long_name || "";
      const country = parts.find(p => p.types.includes("country"));
      if (country?.short_name && country.short_name !== "EG") throw new Error("Choose an address inside Egypt.");
      const province = part("administrative_area_level_1");
      const canonical = window.DartShippingAvailability?.canonical(province);
      if (!canonical) throw new Error("Google could not identify the governorate. Choose a more precise street location.");
      if (fields.governorate.value !== canonical) {
        fields.governorate.value = canonical;
        // Refresh coverage selectors, without clearing the new pin as a manual edit.
        applyingAddress = true;
        try { fields.governorate.dispatchEvent(new Event("change", { bubbles: true })); }
        finally { applyingAddress = false; }
      }
      fields.country.value = "Egypt";
      fields.area.value = part("sublocality_level_1", "sublocality", "neighborhood", "administrative_area_level_2", "locality");
      fields.street.value = part("route");
      const building = part("street_number", "premise");
      if (building && !read(fields.building)) fields.building.value = building;
      googleAddress = String(result.formatted_address || addressString());
      if (search) search.value = googleAddress;
      form.dispatchEvent(new CustomEvent("dart:address-selected", { bubbles: true }));
    }
    let applyingAddress = false;
    async function selectLocation(lat, lng, resolvedAddress = null) {
      clearPin();
      const selection = version;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 21.5 || lat > 32.1 || lng < 24.5 || lng > 36.2) {
        setStatus("Choose a point inside Egypt.", "error"); return false;
      }
      if (!window.DartShippingAvailability?.ready || !geocoder) {
        setStatus("Delivery coverage and Google Maps must finish loading. Retry selecting the location.", "error"); return false;
      }
      setStatus("Looking up your Google address and checking delivery coverage...", "loading");
      try {
        const result = resolvedAddress || await geocode({ location: { lat, lng } });
        if (selection !== version) return false;
        applyGoogleAddress(result);
        const governorate = read(fields.governorate);
        const response = await fetch(apiBase() + "/api/v1/shipping/validate-point", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ governorate, latitude: lat, longitude: lng }), cache: "no-store",
        });
        if (!response.ok) throw new Error("Location verification is unavailable. Retry or complete the address manually.");
        const validation = await response.json();
        if (selection !== version) return false;
        if (validation.valid !== true) throw new Error("The selected point is outside the identified governorate. Choose a precise street location.");
        fields.latitude.value = lat.toFixed(7);
        fields.longitude.value = lng.toFixed(7);
        checked = true;
        form.dataset.dartAddressSource = "map";
        if (map) {
          if (marker) marker.setMap(null);
          marker = new google.maps.Marker({ position: { lat, lng }, map, draggable: true, title: "Delivery location — drag to adjust" });
          marker.addListener("dragend", event => {
            if (event.latLng) void selectLocation(event.latLng.lat(), event.latLng.lng());
          });
          map.panTo({ lat, lng }); map.setZoom(16);
        }
        refresh();
        setStatus("Location and Google address confirmed. Check building, floor and delivery coverage.", "success");
        return true;
      } catch (error) {
        if (selection === version) {
          clearPin(); refresh();
          setStatus(error.message || "Location lookup failed. Retry or enter the address manually.", "error");
        }
        return false;
      }
    }
    async function googleLoader() {
      // https://maps.googleapis.com/maps/api/js is loaded once by the shared Google loader.
      const ok = await window.DartGoogleMaps?.loadMaps();
      errorMessage = window.DartGoogleMaps?.errorMessage || "Google Maps could not load.";
      return Boolean(ok);
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
          userEdited = true;
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
      userEdited = true;
      const requestId = ++searchVersion;
      clearPin();
      const selection = version;
      await showMap();
      if (!geocoder || !map) {
        setStatus("Google search is unavailable. Enter the address manually.", "error"); return;
      }
      const query = read(search) || addressString();
      if (!query) return;
      setStatus("Searching Google Maps...", "loading");
      try {
        const result = await geocode({ address: query, componentRestrictions: { country: "EG" } });
        if (requestId !== searchVersion || selection !== version) return;
        const point = result.geometry?.location;
        if (!point) throw new Error("Google could not locate that address.");
        void selectLocation(point.lat(), point.lng(), result);
      } catch (error) {
        if (requestId === searchVersion && selection === version) setStatus(error.message, "error");
      }
    });
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); button?.click(); }
    });
    get("dart-google-current-location")?.addEventListener("click", async () => {
      userEdited = true;
      const gpsRequest = ++gpsVersion;
      clearPin();
      const selection = version;
      await showMap();
      if (!map) return;
      if (!navigator.geolocation) {
        setStatus("GPS is unavailable. Select your location on the map.", "error"); return;
      }
      setStatus("Finding your current location...", "loading");
      navigator.geolocation.getCurrentPosition(
        pos => { if (gpsRequest === gpsVersion && selection === version) void selectLocation(pos.coords.latitude, pos.coords.longitude); },
        () => { if (gpsRequest === gpsVersion && selection === version) setStatus("Location permission denied or GPS unavailable. Search for your address.", "error"); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
      );
    });
    document.addEventListener("dart:google-maps-error", event => {
      clearPin(); map = null; geocoder = null;
      panel.textContent = event.detail?.message || "Google Maps could not load.";
      setStatus(panel.textContent, "error");
    });
    form.addEventListener("input", (event) => {
      if (applyingAddress) return;
      userEdited = true;
      if ((Object.values(fields).includes(event.target) && ![fields.building, fields.floor].includes(event.target) && event.target.dataset.dartCoverageUpdate !== "1") || event.target === search) clearPin();
      refresh();
    });
    form.addEventListener("change", (event) => {
      if (applyingAddress) return;
      userEdited = true;
      if (Object.values(fields).includes(event.target) && ![fields.fullAddress, fields.building, fields.floor].includes(event.target) && event.target.dataset.dartCoverageUpdate !== "1") clearPin();
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
