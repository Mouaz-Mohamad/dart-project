// Dart Maps: Google Maps display for checkout and active courier deliveries.
// Existing Leaflet address validation, GPS permissions, and delivery authority
// remain intact as a fallback if Maps JavaScript cannot be loaded.
(() => {
  "use strict";
  const browserKey = String(window.DART_GOOGLE_MAPS_BROWSER_KEY || "").trim();
  const representativeMaps = new Map();
  const knownRoadRoutes = new Map();
  let mapsPromise = null;
  let checkoutMap = null;

  function mapsReady() {
    return Boolean(window.google?.maps?.Map && window.google?.maps?.Marker);
  }

  function loadMaps() {
    if (!browserKey) return Promise.resolve(false);
    if (mapsReady()) return Promise.resolve(true);
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve) => {
      const callback = "__dartGoogleMapsLoaded";
      const timer = window.setTimeout(() => {
        delete window[callback];
        resolve(false);
      }, 16000);
      window[callback] = () => {
        window.clearTimeout(timer);
        delete window[callback];
        resolve(mapsReady());
      };
      const script = document.createElement("script");
      script.async = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({
        key: browserKey,
        v: "weekly",
        loading: "async",
        callback,
      });
      script.onerror = () => {
        window.clearTimeout(timer);
        delete window[callback];
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return mapsPromise;
  }

  function latLng(lat, lng) {
    if (lat == null || lng == null || String(lat).trim() === "" || String(lng).trim() === "") return null;
    const a = Number(lat), b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180
      ? { lat: a, lng: b } : null;
  }

  function overlay(container) {
    if (!container || !container.isConnected) return null;
    container.style.position = "relative";
    const canvas = document.createElement("div");
    canvas.className = "dart-google-map-overlay";
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", zIndex: "1100", width: "100%",
      height: "100%", background: "#f5f5f5", borderRadius: "inherit",
    });
    // Do not also trigger Leaflet's underlying pan/click handlers.
    for (const name of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup",
      "touchstart", "touchend", "wheel", "contextmenu"]) {
      canvas.addEventListener(name, (event) => event.stopPropagation());
    }
    container.appendChild(canvas);
    return canvas;
  }

  async function setupCheckout() {
    if (!document.getElementById("checkoutForm") || checkoutMap || !browserKey) return;
    const providerReady = await loadMaps();
    if (!providerReady || checkoutMap) return; // Retain original Leaflet UI.
    const bridge = window.dartCheckoutAddress;
    const container = document.getElementById("map");
    if (!bridge?.selectLocation || !container?.isConnected) return;
    const pin = latLng(bridge.fields?.latitude?.value, bridge.fields?.longitude?.value);
    const canvas = overlay(container);
    if (!canvas) return;
    const center = pin || { lat: 30.0444, lng: 31.2357 };
    const map = new google.maps.Map(canvas, {
      center, zoom: pin ? 16 : 11,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      clickableIcons: false, gestureHandling: "greedy",
    });
    let marker = pin ? new google.maps.Marker({ map, position: pin, draggable: false, title: "Delivery address" }) : null;
    checkoutMap = { map, marker, canvas };

    const updatePin = (coords) => {
      if (!coords || !checkoutMap || checkoutMap.canvas !== canvas) return;
      if (!marker) marker = new google.maps.Marker({ map, position: coords, title: "Delivery address" });
      else marker.setPosition(coords);
      checkoutMap.marker = marker;
      map.panTo(coords);
      map.setZoom(Math.max(map.getZoom() || 15, 15));
    };
    map.addListener("click", (event) => {
      const coords = event.latLng && latLng(event.latLng.lat(), event.latLng.lng());
      if (coords) void bridge.selectLocation(coords.lat, coords.lng);
    });
    container.closest("form")?.addEventListener("dart:address-selected", (event) => {
      updatePin(latLng(event.detail?.lat, event.detail?.lng));
    });
    const locateButton = document.createElement("button");
    locateButton.type = "button";
    locateButton.className = "dart-google-locate";
    locateButton.textContent = "◎";
    locateButton.title = "Use my current location";
    locateButton.setAttribute("aria-label", "Use my current location");
    Object.assign(locateButton.style, {
      position: "absolute", zIndex: "1101", bottom: "12px", right: "12px",
      minWidth: "40px", minHeight: "40px", background: "#fff",
      color: "#ab012b", border: "1px solid #ddd", borderRadius: "8px",
      boxShadow: "0 1px 5px #0002", cursor: "pointer", fontSize: "24px",
    });
    locateButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => { void bridge.selectLocation(pos.coords.latitude, pos.coords.longitude); },
        () => {
          const status = document.getElementById("checkout-address-status");
          if (status) status.textContent = "Location permission denied. Select your address on the map.";
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
    container.appendChild(locateButton);
    if (pin) updatePin(pin);
  }

  function destroyRepresentatives() {
    for (const entry of representativeMaps.values()) {
      if (entry.courier) entry.courier.setMap(null);
      if (entry.destination) entry.destination.setMap(null);
      if (entry.route) entry.route.setMap(null);
      entry.canvas.remove();
    }
    representativeMaps.clear();
  }

  async function attachRepresentatives(orders) {
    if (!browserKey || !Array.isArray(orders) || !orders.length) return;
    if (!await loadMaps()) return; // Leaflet remains fully functional.
    for (const order of orders) {
      const id = String(order.id || "");
      const container = [...document.querySelectorAll("[data-rep-live-map]")]
        .find((element) => element.dataset.orderId === id);
      if (!container || representativeMaps.has(id)) continue;
      const destinationCoords = latLng(order.latitude, order.longitude);
      if (!destinationCoords) continue;
      const canvas = overlay(container);
      if (!canvas) continue;
      const courierCoords = latLng(order.courierLocation?.lat, order.courierLocation?.lng)
        || latLng(window.DART_REP_LAST_LOCATION?.lat, window.DART_REP_LAST_LOCATION?.lng);
      const map = new google.maps.Map(canvas, {
        center: destinationCoords, zoom: 15, mapTypeControl: false,
        streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      });
      const destination = new google.maps.Marker({ map, position: destinationCoords, title: "Customer" });
      const courier = courierCoords
        ? new google.maps.Marker({ map, position: courierCoords, title: "You" })
        : null;
      const route = new google.maps.Polyline({
        map, path: [], strokeColor: "#ab012b", strokeWeight: 4,
        strokeOpacity: 0.85,
      });
      if (courierCoords) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(destinationCoords);
        bounds.extend(courierCoords);
        map.fitBounds(bounds, 32);
      }
      representativeMaps.set(id, { map, canvas, destination, courier, route });
      const previous = knownRoadRoutes.get(id);
      if (previous) drawRoadRoute(id, previous);
    }
  }

  function updateRepresentativeLocation(location) {
    const coords = latLng(location?.lat, location?.lng);
    if (!coords) return;
    window.DART_REP_LAST_LOCATION = coords;
    for (const entry of representativeMaps.values()) {
      if (!entry.courier) entry.courier = new google.maps.Marker({
        map: entry.map, position: coords, title: "You",
      });
      else entry.courier.setPosition(coords);
    }
  }

  function drawRoadRoute(id, geometry) {
    const key = String(id);
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > 15000) return;
    const points = geometry.map((coords) => Array.isArray(coords)
      ? latLng(coords[0], coords[1]) : null);
    if (points.some((coords) => !coords)) return;
    knownRoadRoutes.set(key, geometry);
    const entry = representativeMaps.get(key);
    if (entry) entry.route.setPath(points);
  }

  document.addEventListener("dart:rep-road-route", (event) => {
    drawRoadRoute(event.detail?.orderId, event.detail?.geometry);
  });
  document.addEventListener("dart:checkout-address-ready", () => {
    void setupCheckout();
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void setupCheckout(); }, { once: true });
  } else {
    void setupCheckout();
  }
  window.DartGoogleMaps = Object.freeze({
    attachRepresentatives,
    updateRepresentativeLocation,
    destroyRepresentatives,
  });
})();
