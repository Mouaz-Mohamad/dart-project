// Dart Google Maps for representative deliveries. No Leaflet dependency.
(() => {
  "use strict";
  const key = String(window.DART_GOOGLE_MAPS_BROWSER_KEY || "").trim();
  const mounted = new Map();
  const routes = new Map();
  let request = null, authFailed = false, errorMessage = "";

  function status(message) {
    const field = document.getElementById("repLocationStatus");
    if (field) { field.textContent = message; field.dataset.state = "error"; }
  }
  function coords(lat, lng) {
    if (lat === "" || lng === "" || lat == null || lng == null) return null;
    const a = Number(lat), b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 &&
      b >= -180 && b <= 180 && a !== 0 && b !== 0 ? { lat: a, lng: b } : null;
  }
  function loadMaps() {
    if (authFailed || !key) {
      errorMessage = key ? errorMessage : "Google Maps key is not configured for Dart.";
      return Promise.resolve(false);
    }
    if (window.google?.maps?.Map) return Promise.resolve(true);
    if (request) return request;
    request = new Promise(resolve => {
      let done = false;
      const callback = "__dartCourierGoogleLoaded";
      function finish(ok) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        delete window[callback];
        resolve(Boolean(ok && !authFailed && window.google?.maps?.Map));
      }
      const timer = window.setTimeout(() => {
        errorMessage = "Google Maps loading timed out. Please retry.";
        finish(false);
      }, 8000);
      window[callback] = () => finish(true);
      const prior = window.gm_authFailure;
      window.gm_authFailure = () => {
        authFailed = true;
        errorMessage = "Google Maps authentication failed. Check Dart website restrictions, billing and Maps JavaScript API.";
        destroyRepresentatives();
        status(errorMessage);
        finish(false);
        if (typeof prior === "function") prior();
      };
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?" +
        new URLSearchParams({ key, v: "weekly", loading: "async", callback });
      script.async = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      script.onerror = () => { errorMessage = "Google Maps failed to load."; finish(false); };
      document.head.appendChild(script);
    });
    return request;
  }
  function destroyRepresentatives() {
    for (const entry of mounted.values()) {
      entry.destination?.setMap(null);
      entry.courier?.setMap(null);
      entry.route?.setMap(null);
      entry.container.replaceChildren();
    }
    mounted.clear();
  }
  async function attachRepresentatives(orders) {
    if (!Array.isArray(orders) || !orders.length) return;
    const nodes = [...document.querySelectorAll("[data-rep-live-map]")];
    if (!nodes.length) return;
    for (const node of nodes) {
      if (!mounted.has(String(node.dataset.orderId)))
        node.textContent = "Loading Google Maps...";
    }
    if (!await loadMaps()) {
      for (const node of nodes) {
        node.textContent = errorMessage || "Google Maps unavailable. Use Open navigation.";
      }
      status(errorMessage || "Google Maps unavailable. Use Open navigation.");
      return;
    }
    for (const order of orders) {
      const id = String(order.id || "");
      const container = nodes.find(node => node.isConnected && node.dataset.orderId === id);
      if (!container || mounted.has(id)) continue;
      const destination = coords(order.latitude, order.longitude);
      const courierPosition = coords(order.courierLocation?.lat, order.courierLocation?.lng) ||
        coords(window.DART_REP_LAST_LOCATION?.lat, window.DART_REP_LAST_LOCATION?.lng);
      const center = destination || courierPosition || { lat: 30.0444, lng: 31.2357 };
      container.replaceChildren();
      if (!destination) {
        const notice = document.createElement("p");
        notice.className = "dart-rep-map-manual-notice";
        notice.textContent = "Manual address — customer has no verified map pin. Open navigation to find the written address.";
        notice.style.cssText = "padding:7px;font-size:12px;color:#ab012b;background:#fff;position:relative;z-index:2";
        container.appendChild(notice);
      }
      const canvas = document.createElement("div");
      canvas.className = "dart-google-map-overlay";
      canvas.style.cssText = "height:100%;min-height:230px;width:100%;border-radius:8px";
      container.appendChild(canvas);
      let map;
      try {
        map = new google.maps.Map(canvas, { center, zoom: destination ? 15 : 12,
          clickableIcons: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      } catch {
        container.textContent = "Google Maps could not display. Use Open navigation.";
        continue;
      }
      const destinationMarker = destination
        ? new google.maps.Marker({ map, position: destination, title: "Verified customer destination" }) : null;
      const courierMarker = courierPosition
        ? new google.maps.Marker({ map, position: courierPosition, title: "You" }) : null;
      const route = destination ? new google.maps.Polyline({ map, path: [],
        strokeColor: "#ab012b", strokeWeight: 4, strokeOpacity: 0.85 }) : null;
      if (destination && courierPosition) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(destination); bounds.extend(courierPosition);
        map.fitBounds(bounds, 32);
      }
      mounted.set(id, { map, container, destination: destinationMarker, courier: courierMarker, route });
      if (routes.has(id)) drawRoadRoute(id, routes.get(id));
    }
  }
  function updateRepresentativeLocation(position) {
    const point = coords(position?.lat, position?.lng);
    if (!point) return;
    window.DART_REP_LAST_LOCATION = point;
    for (const entry of mounted.values()) {
      if (!entry.courier) entry.courier = new google.maps.Marker({
        map: entry.map, position: point, title: "You" });
      else entry.courier.setPosition(point);
    }
  }
  function drawRoadRoute(id, geometry) {
    const key = String(id || "");
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > 15000) return;
    const path = geometry.map(pair => Array.isArray(pair) ? coords(pair[0], pair[1]) : null);
    if (path.some(point => !point)) return;
    routes.set(key, geometry);
    mounted.get(key)?.route?.setPath(path);
  }
  document.addEventListener("dart:rep-road-route", event => {
    drawRoadRoute(event.detail?.orderId, event.detail?.geometry);
  });
  window.DartGoogleMaps = Object.freeze({
    attachRepresentatives, updateRepresentativeLocation,
    destroyRepresentatives, loadMaps,
  });
})();
