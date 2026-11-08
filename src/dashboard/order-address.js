// Google delivery-address picker for manual orders. All durable writes stay in the existing order API.
(() => {
  "use strict";
  let controller = null;
  const read = node => String(node?.value || "").trim();
  function create() {
    if (controller) return controller;
    const get = id => document.getElementById(id);
    const form = get("orderForm"), modal = get("orderModal"), panel = get("dashboard-order-map");
    const input = get("orderAddress"), host = get("dashboard-order-location-search");
    if (!form || !modal || !panel || !input || !host || !window.DartGooglePlaces) return null;
    const fields = Object.fromEntries(Object.entries({ country: "orderCountry", governorate: "governorate",
      area: "orderArea", street: "orderStreetName", building: "orderBuildingNumber", floor: "orderFloor",
      latitude: "orderLatitude", longitude: "orderLongitude", fullAddress: "orderFullAddress",
    }).map(([key, id]) => [key, get(id)]));
    const status = get("dashboard-address-status"), searchButton = get("dashboard-google-search");
    const manualButton = get("dashboard-locate-manual-address");
    let map = null, marker = null, geocoder = null, mapLoading = null, pendingValidation = null;
    let version = 0, checked = false, applying = false, googleAddress = "", predictions = null, searchPending = false;
    const active = () => !modal.hidden && modal.getClientRects().length > 0 &&
      !document.body.classList.contains("dart-admin-locked");
    const addressString = () => ["building", "street", "area", "governorate", "country"].map(key => read(fields[key])).filter(Boolean).join(", ");
    function setStatus(message, state = "ready") {
      if (status) { status.textContent = message; status.dataset.state = state; }
      form.dataset.dartAddressState = state;
      form.dispatchEvent(new CustomEvent("dart:address-state", { bubbles: true, detail: { state } }));
    }
    function refresh() { fields.fullAddress.value = checked && googleAddress ? googleAddress : addressString(); }
    function invalidate(keepMarker = false) {
      version += 1; checked = false; googleAddress = "";
      pendingValidation?.abort(); pendingValidation = null;
      fields.latitude.value = ""; fields.longitude.value = "";
      form.dataset.dartAddressSource = "manual"; form.dataset.dartAddressReady = "false";
      if (marker && !keepMarker) { marker.setMap(null); marker = null; }
      refresh();
      setStatus("Choose a Google location or complete the address manually.");
    }
    function snapshot() {
      return JSON.stringify([version, input.value, ...Object.values(fields).map(read), form.dataset.dartAddressSource]);
    }
    function validate() {
      if (form.dataset.dartAddressState === "loading") return { ok: false, message: "Wait for the Google location check to finish." };
      if (searchPending && !checked) return { ok: false, message: "Select the searched Google place or update the manual street and area before saving." };
      const missing = ["country", "governorate", "area", "street", "building", "floor"].filter(key => !read(fields[key]));
      if (missing.length) return { ok: false, message: `Complete: ${missing.join(", ")}.` };
      if (read(fields.country).toLowerCase() !== "egypt") return { ok: false, message: "Delivery is available inside Egypt only." };
      const coverage = window.DartShippingAvailability;
      if (!coverage?.ready) return { ok: false, message: "Delivery coverage is unavailable. Reopen the order or retry Search." };
      if (!coverage.isGovernorateOpen(read(fields.governorate))) return { ok: false, message: "Delivery is unavailable in this governorate." };
      return { ok: true, source: checked ? "map" : "manual", zone: "coverage-enabled" };
    }
    async function showMap() {
      if (!active()) return;
      if (map) return;
      if (mapLoading) return mapLoading;
      mapLoading = (async () => {
        panel.textContent = "Loading Google Maps…";
        try {
          await window.DartShippingAvailability?.load();
          if (!await window.DartGoogleMaps?.loadMaps()) throw new Error("Google Maps is unavailable. Enter the complete address manually or retry Search.");
          if (!active()) return;
          panel.replaceChildren();
          map = new google.maps.Map(panel, { center: { lat: 30.0444, lng: 31.2357 }, zoom: 11,
            colorScheme: "LIGHT", mapTypeId: "roadmap", backgroundColor: "#f7f8f8",
            mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
            clickableIcons: false, gestureHandling: "cooperative", zoomControl: true,
          });
          geocoder = new google.maps.Geocoder();
          map.addListener("click", event => {
            predictions?.cancel();
            if (event.latLng) void selectLocation(event.latLng.lat(), event.latLng.lng());
          });
        } catch {
          map = null; geocoder = null;
          panel.textContent = "Google Maps is unavailable. Enter the complete address manually or retry Search.";
          setStatus(panel.textContent, "error");
        }
      })().finally(() => { mapLoading = null; });
      return mapLoading;
    }
    function geocode(request) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Google address lookup timed out. Retry or enter the address manually.")), 12000);
        geocoder.geocode(request, (results, resultStatus) => {
          clearTimeout(timeout);
          if (resultStatus === "OK" && results?.[0]) resolve(results[0]);
          else reject(new Error(resultStatus === "ZERO_RESULTS" ? "No matching Google address. Refine the place or street." : "Google address lookup is unavailable. Retry or enter the address manually."));
        });
      });
    }
    function parts(result) {
      const values = result.address_components || [];
      const part = (...types) => values.find(row => types.some(type => row.types.includes(type)))?.long_name || "";
      if (values.find(row => row.types.includes("country"))?.short_name !== "EG") throw new Error("Choose an address inside Egypt.");
      const provinces = values.filter(row => row.types.includes("administrative_area_level_1"));
      const governorate = provinces.flatMap(row => [row.long_name, row.short_name])
        .map(label => window.DartShippingAvailability.canonical(label)).find(Boolean);
      if (!governorate || !window.DartShippingAvailability.isGovernorateOpen(governorate)) throw new Error("Google could not identify an available delivery governorate. Choose a precise street location.");
      return { country: "Egypt", governorate, area: part("sublocality_level_1", "sublocality", "neighborhood", "administrative_area_level_2", "locality"),
        street: part("route"), building: part("street_number", "premise"), fullAddress: String(result.formatted_address || "") };
    }
    async function selectLocation(lat, lng, result = null) {
      if (!active()) return false;
      invalidate();
      const selection = version;
      setStatus("Checking Google address and location…", "loading");
      try {
        await showMap();
        if (selection !== version || !active()) return false;
        if (!geocoder || !map) throw new Error("Google Maps is unavailable. Enter the complete address manually.");
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 21.5 || lat > 32.1 || lng < 24.5 || lng > 36.2) throw new Error("Choose a point inside Egypt.");
        const found = result || await geocode({ location: { lat, lng } });
        if (selection !== version || !active()) return false;
        const address = parts(found);
        const abort = new AbortController(); pendingValidation = abort;
        const timeout = setTimeout(() => abort.abort(), 12000);
        let response;
        try {
          response = await fetch(`${String(window.DART_API_BASE_URL || location.origin).replace(/\/$/, "")}/api/v1/shipping/validate-point`, {
            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: abort.signal,
            body: JSON.stringify({ governorate: address.governorate, latitude: lat, longitude: lng }),
          });
        } finally { clearTimeout(timeout); if (pendingValidation === abort) pendingValidation = null; }
        if (selection !== version || !active()) return false;
        if (!response.ok || (await response.json()).valid !== true) throw new Error("The location could not be verified in this governorate. Retry or use the manual address.");
        if (selection !== version || !active()) return false;
        applying = true;
        try {
          for (const key of ["country", "governorate", "area", "street"]) {
            const field = fields[key];
            if (field.tagName === "SELECT" && ![...field.options].some(option => option.value === address[key])) field.add(new Option(address[key], address[key]));
            field.value = address[key];
          }
          if (!read(fields.building) && address.building) fields.building.value = address.building;
          fields.governorate.dispatchEvent(new Event("change", { bubbles: true }));
          googleAddress = address.fullAddress || addressString(); input.value = googleAddress;
          fields.latitude.value = lat.toFixed(7); fields.longitude.value = lng.toFixed(7);
          checked = true; searchPending = false; form.dataset.dartAddressSource = "map"; form.dataset.dartAddressReady = "true";
          refresh();
        } finally { applying = false; }
        marker = new google.maps.Marker({ map, position: { lat, lng }, draggable: true, title: "Delivery location — drag to adjust" });
        marker.addListener("dragstart", () => { invalidate(true); setStatus("Release the pin to check its new location…", "loading"); });
        marker.addListener("dragend", event => {
          if (event.latLng) void selectLocation(event.latLng.lat(), event.latLng.lng());
        });
        map.panTo({ lat, lng }); map.setZoom(16);
        setStatus("Google location confirmed. Check the building, floor and address details.", "success");
        form.dispatchEvent(new CustomEvent("dart:address-selected", { bubbles: true, detail: { lat, lng, parts: address } }));
        return true;
      } catch (error) {
        if (selection === version && active()) { invalidate(); setStatus(error.name === "AbortError" ? "Location check timed out. Retry or enter the address manually." : error.message, "error"); }
        return false;
      }
    }
    async function search(manual = false) {
      predictions?.cancel(); invalidate();
      const request = version, query = manual ? addressString() : read(input);
      if (!query || !active()) return;
      setStatus("Searching Google Maps…", "loading");
      await showMap();
      if (request !== version || !active()) return;
      if (!geocoder) { setStatus("Google search is unavailable. Complete the delivery address manually.", "error"); return; }
      try {
        const result = await geocode({ address: query, componentRestrictions: { country: "EG" } });
        if (request !== version || !active()) return;
        const point = result.geometry?.location;
        if (!point) throw new Error("Google could not locate that address.");
        await selectLocation(point.lat(), point.lng(), result);
      } catch (error) { if (request === version && active()) setStatus(error.message, "error"); }
    }
    searchButton?.addEventListener("click", () => void search());
    manualButton?.addEventListener("click", () => void search(true));
    input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void search(); } });
    form.addEventListener("input", event => {
      if (applying) return;
      if (event.target === input) { searchPending = Boolean(read(input)); invalidate(); }
      else if ([fields.country, fields.governorate, fields.area, fields.street].includes(event.target)) { searchPending = false; invalidate(); }
      else if ([fields.building, fields.floor].includes(event.target)) refresh();
    });
    form.addEventListener("change", event => { if (!applying && event.target === fields.governorate) { searchPending = false; invalidate(); } });
    form.addEventListener("reset", () => { predictions?.cancel(); searchPending = false; invalidate(); });
    document.addEventListener("dart:google-maps-error", () => {
      predictions?.cancel(); invalidate(); map = null; geocoder = null;
      panel.textContent = "Google Maps is unavailable. Enter the complete address manually.";
      setStatus(panel.textContent, "error");
    });
    const address = { fields, selectLocation, showMap, snapshot, invalidate,
      beginSelection: () => setStatus("Checking selected Google address…", "loading"),
      mapBounds: () => map?.getBounds?.()?.toJSON?.() || null,
    };
    predictions = window.DartGooglePlaces.create({ input, form, host, address,
      listId: "dashboard-address-results", isActive: active, cancelTargets: [searchButton, manualButton, panel],
    });
    new MutationObserver(() => {
      if (active()) void showMap();
      else { predictions?.cancel(); if (form.dataset.dartAddressState === "loading") invalidate(); }
    }).observe(modal, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("dart:admin-logged-out", () => { predictions?.cancel(); invalidate(); });
    window.addEventListener("pagehide", () => { predictions?.cancel(); invalidate(); });
    controller = Object.freeze({ fields, validate, snapshot, selectLocation,
      isCurrentSnapshot: old => validate().ok && old === snapshot(),
      resize: () => { if (active()) void showMap(); },
    });
    return controller;
  }
  window.DartOrderAddress = Object.freeze({ create });
})();
