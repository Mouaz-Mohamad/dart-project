// Google Places suggestions for checkout only. Predictions and session tokens stay in memory.
(() => {
  "use strict";
  function init() {
    const input = document.getElementById("address-input"), form = document.getElementById("checkoutForm");
    const address = window.dartCheckoutAddress;
    if (!input || !form || !address || input.dataset.dartPlacesReady) return;
    input.dataset.dartPlacesReady = "1";
    const host = input.closest(".dart-checkout-location-search");
    if (!host) return;
    const dropdown = document.createElement("div");
    dropdown.className = "dart-address-predictions"; dropdown.hidden = true;
    const list = document.createElement("div");
    list.id = "dart-address-predictions"; list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Google address suggestions");
    const notice = document.createElement("p"); notice.className = "dart-address-predictions-status";
    notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
    const attribution = document.createElement("small"); attribution.textContent = "Google Maps";
    dropdown.append(list, notice, attribution); host.appendChild(dropdown);
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id); input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off"); input.setAttribute("aria-haspopup", "listbox");
    let timer = null, sequence = 0, rows = [], active = -1, library = null;
    let token = null, tokenAt = 0, composing = false, selecting = false;
    const value = () => input.value.trim();
    function close() {
      dropdown.hidden = true; input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant"); active = -1;
    }
    function cancel() {
      sequence += 1; clearTimeout(timer); rows = []; list.replaceChildren(); close();
      if (selecting) { selecting = false; address.invalidate(); }
    }
    function message(text) {
      dropdown.hidden = false; input.setAttribute("aria-expanded", "true");
      notice.textContent = text; notice.hidden = !text;
    }
    function setActive(index) {
      active = index;
      [...list.children].forEach((row, i) => row.setAttribute("aria-selected", String(i === index)));
      const selected = list.children[index];
      if (selected) { input.setAttribute("aria-activedescendant", selected.id); selected.scrollIntoView({ block: "nearest" }); }
    }
    async function places() {
      await address.showMap();
      if (!await window.DartGoogleMaps?.loadMaps()) throw new Error("Maps unavailable");
      if (!library) library = google.maps.importLibrary("places").catch(error => { library = null; throw error; });
      return library;
    }
    async function choose(prediction) {
      cancel();
      const request = sequence, query = value();
      address.invalidate();
      const snapshot = address.snapshot();
      selecting = true; address.beginSelection();
      message("Confirming selected Google address...");
      try {
        const place = prediction.toPlace();
        // The token is attached by Google to the prediction; fetchFields concludes that session.
        token = null;
        await place.fetchFields({ fields: ["location"] });
        if (request !== sequence || query !== value() || snapshot !== address.snapshot()) return;
        const location = place.location;
        if (!location) throw new Error("Place has no location");
        selecting = false; close();
        // Reverse lookup fills the same structured address and server-verified pin as a map click.
        await address.selectLocation(location.lat(), location.lng());
      } catch {
        if (request === sequence) { selecting = false; address.invalidate(); message("Could not select that address. Retry, use Search or choose a point on the map."); }
      }
    }
    async function suggest(request, query) {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await places();
        if (request !== sequence || query !== value()) return;
        if (!token || Date.now() - tokenAt > 180000) { token = new AutocompleteSessionToken(); tokenAt = Date.now(); }
        const bounds = address.mapBounds?.();
        const result = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query, includedRegionCodes: ["eg"], language: "ar", region: "eg", sessionToken: token,
          locationBias: bounds || { south: 21.5, north: 32.1, west: 24.5, east: 36.2 },
        });
        if (request !== sequence || query !== value()) return;
        rows = (result.suggestions || []).map(row => row.placePrediction).filter(Boolean).slice(0, 5);
        list.replaceChildren(); active = -1;
        for (const [index, prediction] of rows.entries()) {
          const option = document.createElement("div"); option.id = `${list.id}-${request}-${index}`;
          option.className = "dart-address-prediction"; option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false"); option.dir = "auto";
          const name = document.createElement("strong"), detail = document.createElement("span");
          name.textContent = String(prediction.mainText || prediction.text || "Address");
          detail.textContent = String(prediction.secondaryText || "");
          option.append(name, detail);
          // Keep focus until click selects the row, including touch/pen input on mobile.
          option.addEventListener("pointerdown", event => event.preventDefault());
          option.addEventListener("mousedown", event => event.preventDefault());
          option.addEventListener("click", () => void choose(prediction)); list.appendChild(option);
        }
        message(rows.length ? "" : "No matching suggestions. Add a street or district, or use Search.");
      } catch {
        if (request === sequence && query === value()) {
          rows = []; list.replaceChildren(); token = null;
          message("Google suggestions are temporarily unavailable. Use Search or choose a point on the map.");
        }
      }
    }
    function schedule() {
      cancel();
      const query = value(), request = sequence;
      if (composing || query.length < 3) { if (!query) token = null; return; }
      message("Searching Google addresses...");
      timer = setTimeout(() => void suggest(request, query), 300);
    }
    input.addEventListener("input", schedule);
    input.addEventListener("compositionstart", () => { composing = true; cancel(); });
    input.addEventListener("compositionend", () => { composing = false; schedule(); });
    input.addEventListener("keydown", event => {
      if (event.isComposing || composing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
      if (dropdown.hidden || !rows.length) return;
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "Enter") void choose(rows[active < 0 ? 0 : active]);
        else setActive(event.key === "ArrowDown" ? (active + 1) % rows.length : (active < 0 ? rows.length - 1 : (active - 1 + rows.length) % rows.length));
      }
    }, true);
    input.addEventListener("blur", () => { cancel(); token = null; });
    document.addEventListener("click", event => { if (!event.composedPath().includes(host)) cancel(); });
    form.addEventListener("input", event => { if (event.target !== input) cancel(); });
    form.addEventListener("change", event => { if (event.target !== input) cancel(); });
    for (const id of ["dart-google-search", "dart-google-current-location", "dart-checkout-google-map"]) {
      document.getElementById(id)?.addEventListener("click", cancel, true);
    }
    document.addEventListener("dart:google-maps-error", cancel);
    window.addEventListener("pagehide", () => { cancel(); token = null; });
  }
  document.addEventListener("dart:checkout-address-ready", init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
