// Shared Google Maps loader and courier route renderer. Browser key comes from deployment configuration.
(() => {
  "use strict";
  const mounted = new Map();
  let request = null, authFailed = false, errorMessage = "", mountGeneration = 0;
  const configurationError = "Google Maps authorization failed. Check Maps JavaScript API, billing and allowed Dart website domains in Google Cloud.";
  function fail(message) {
    errorMessage = message;
    document.dispatchEvent(new CustomEvent("dart:google-maps-error", { detail: { message } }));
  }
  function coords(lat, lng) {
    if (lat === "" || lng === "" || lat == null || lng == null) return null;
    const a = Number(lat), b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 &&
      b >= -180 && b <= 180 && a !== 0 && b !== 0 ? { lat: a, lng: b } : null;
  }
  function point(value) {
    return coords(typeof value?.lat === "function" ? value.lat() : value?.lat,
      typeof value?.lng === "function" ? value.lng() : value?.lng);
  }
  function loadMaps() {
    const key = String(window.DART_GOOGLE_MAPS_BROWSER_KEY || "").trim();
    if (authFailed || !key) {
      fail(authFailed ? configurationError : "Google Maps browser key is missing from this deployment.");
      return Promise.resolve(false);
    }
    if (window.google?.maps?.Map) return Promise.resolve(true);
    if (request) return request;
    request = new Promise(resolve => {
      let done = false;
      const callback = "__dartGoogleLoaded";
      const finish = ok => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        // Keep a harmless callback after timeout so a late Google response cannot throw.
        window[callback] = () => {};
        if (!ok) request = null;
        resolve(Boolean(ok && !authFailed && window.google?.maps?.Map));
      };
      const timer = window.setTimeout(() => {
        fail("Google Maps loading timed out. Check your connection and retry.");
        script.remove();
        finish(false);
      }, 15000);
      window[callback] = () => finish(true);
      const prior = window.gm_authFailure;
      window.gm_authFailure = () => {
        authFailed = true;
        destroyRepresentatives();
        fail(configurationError);
        finish(false);
        if (typeof prior === "function") prior();
      };
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({
        key, v: "weekly", loading: "async", callback, language: "ar", region: "EG",
      });
      script.async = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
      script.onerror = () => { fail("Google Maps failed to load. Check your connection and retry."); script.remove(); finish(false); };
      document.head.appendChild(script);
    });
    return request;
  }
  function destroyRepresentatives() {
    mountGeneration += 1;
    for (const entry of mounted.values()) {
      entry.destination?.setMap(null);
      entry.courier?.setMap(null);
      entry.route?.setMap(null);
      window.google?.maps?.event?.clearInstanceListeners(entry.map);
      entry.container.replaceChildren();
    }
    mounted.clear();
  }
  async function attachRepresentatives(orders) {
    const generation = mountGeneration;
    const nodes = [...document.querySelectorAll("[data-rep-live-map]")].filter(node => node.closest("dialog")?.open);
    if (!nodes.length) return;
    if (!await loadMaps()) {
      nodes.forEach(node => { node.textContent = errorMessage; });
      return;
    }
    if (generation !== mountGeneration) return;
    for (const order of orders) {
      const id = String(order.id || "");
      const container = nodes.find(node => node.isConnected && node.dataset.orderId === id);
      if (!container || mounted.has(id)) continue;
      const destination = coords(order.latitude, order.longitude);
      const courier = point(order.courierLocation) || point(window.DART_REP_LAST_LOCATION);
      container.replaceChildren();
      const canvas = document.createElement("div");
      canvas.className = "dart-google-map-overlay";
      container.appendChild(canvas);
      try {
        const map = new google.maps.Map(canvas, { center: destination || courier || { lat: 30.0444, lng: 31.2357 },
          zoom: 16, clickableIcons: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
        const entry = { map, container,
          destination: destination ? new google.maps.Marker({ map, position: destination, title: "Customer destination" }) : null,
          courier: courier ? new google.maps.Marker({ map, position: courier, title: "You" }) : null,
          route: new google.maps.Polyline({ map, path: [], strokeColor: "#ab012b", strokeWeight: 5 }),
        };
        if (destination && courier) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(destination); bounds.extend(courier); map.fitBounds(bounds, 40);
        }
        mounted.set(id, entry);
      } catch { container.textContent = "Google Maps could not display. Use Google Maps navigation or retry."; }
    }
  }
  function updateRepresentativeLocation(position) {
    const location = point(position);
    if (!location) return;
    window.DART_REP_LAST_LOCATION = location;
    for (const entry of mounted.values()) {
      if (!entry.courier) entry.courier = new google.maps.Marker({ map: entry.map, position: location, title: "You" });
      else entry.courier.setPosition(location);
    }
  }
  async function computeRoute(origin, destination) {
    if (!await loadMaps()) throw new Error(errorMessage);
    const { Route } = await google.maps.importLibrary("routes");
    const result = await Route.computeRoutes({ origin, destination, travelMode: "DRIVING",
      language: "ar", region: "eg", fields: ["path", "legs", "distanceMeters", "durationMillis", "warnings"],
    });
    const route = result.routes?.[0];
    if (!route?.path?.length) throw new Error("Google could not find a driving route.");
    return { geometry: route.path.map(p => { const c = point(p); return c ? [c.lat, c.lng] : null; }).filter(Boolean),
      steps: (route.legs || []).flatMap(leg => leg.steps || []).map(step => ({
        instruction: String(step.instructions || "Continue"), maneuver: String(step.maneuver || "STRAIGHT"),
        start: point(step.startLocation), end: point(step.endLocation),
        path: (step.path || []).map(point).filter(Boolean), distanceMeters: step.distanceMeters,
      })), distanceMeters: route.distanceMeters, durationMillis: route.durationMillis,
      warnings: (route.warnings || []).map(String),
    };
  }
  document.addEventListener("dart:rep-road-route", event => {
    const { orderId, geometry } = event.detail || {};
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > 30000) return;
    const path = geometry.map(pair => coords(pair?.[0], pair?.[1]));
    if (path.every(Boolean)) mounted.get(String(orderId))?.route?.setPath(path);
  });
  window.DartGoogleMaps = Object.freeze({ loadMaps, attachRepresentatives,
    updateRepresentativeLocation, destroyRepresentatives, computeRoute,
    get errorMessage() { return errorMessage; },
  });
})();
