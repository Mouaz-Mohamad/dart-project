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
  function bearing(a, b) {
    const radians = Math.PI / 180, delta = (b.lng - a.lng) * radians;
    const y = Math.sin(delta) * Math.cos(b.lat * radians);
    const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians) -
      Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos(delta);
    return (Math.atan2(y, x) / radians + 360) % 360;
  }
  function gpsHeading(position) {
    const heading = position?.heading, speed = position?.speed;
    return typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading < 360 &&
      (speed == null || (Number.isFinite(speed) && speed >= 0.8)) ? heading : null;
  }
  function courierIcon(heading) {
    return { path: "M 0,-12 9,10 0,6 -9,10 Z", scale: 1.5, rotation: heading ?? 0,
      anchor: new google.maps.Point(0, 0), fillColor: "#1a73e8", fillOpacity: 1,
      strokeColor: "#ffffff", strokeWeight: 2 };
  }
  function setFollow(entry, enabled) {
    entry.follow = Boolean(enabled);
    if (entry.follow && entry.location) { entry.map.panTo(entry.location); entry.map.setZoom(17); }
    document.dispatchEvent(new CustomEvent("dart:rep-map-follow", { detail: { following: entry.follow } }));
  }
  function setRepresentativeFollow(enabled) {
    for (const entry of mounted.values()) setFollow(entry, enabled);
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
      const saved = order.courierLocation, live = window.DART_REP_LAST_LOCATION;
      const position = (Date.parse(live?.updatedAt || "") || 0) > (Date.parse(saved?.updatedAt || "") || 0) ? live : saved || live;
      const courier = point(position);
      container.replaceChildren();
      const canvas = document.createElement("div");
      canvas.className = "dart-google-map-overlay";
      container.appendChild(canvas);
      try {
        const map = new google.maps.Map(canvas, { center: courier || destination || { lat: 30.0444, lng: 31.2357 },
          zoom: 17, clickableIcons: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
        const heading = gpsHeading(position);
        const entry = { map, container, location: courier, heading, courseOrigin: courier, follow: true,
          destination: destination ? new google.maps.Marker({ map, position: destination, title: "Customer destination" }) : null,
          courier: courier ? new google.maps.Marker({ map, position: courier, title: "You", icon: courierIcon(heading), zIndex: 10 }) : null,
          route: new google.maps.Polyline({ map, path: [], strokeColor: "#1a73e8", strokeOpacity: 1, strokeWeight: 6 }),
        };
        map.addListener("dragstart", () => setFollow(entry, false));
        mounted.set(id, entry);
        setFollow(entry, true);
      } catch { container.textContent = "Google Maps could not display. Use Google Maps navigation or retry."; }
    }
  }
  function updateRepresentativeLocation(position) {
    const location = point(position);
    const updatedAt = Date.parse(position?.updatedAt || "");
    if (!location || !Number.isFinite(updatedAt) || Math.abs(Date.now() - updatedAt) > 120000) return;
    if (updatedAt < Date.parse(window.DART_REP_LAST_LOCATION?.updatedAt || "")) return;
    window.DART_REP_LAST_LOCATION = { ...location, heading: position.heading, speed: position.speed,
      accuracy: position.accuracy, updatedAt: position.updatedAt };
    for (const entry of mounted.values()) {
      let heading = gpsHeading(position);
      const origin = entry.courseOrigin;
      // Devices often omit GPS heading. Derive a course only after moving beyond GPS jitter.
      const metres = origin ? Math.hypot((location.lat - origin.lat) * 111195,
        (location.lng - origin.lng) * 111195 * Math.cos(location.lat * Math.PI / 180)) : 0;
      if (origin && metres >= Math.max(8, Number(position.accuracy) || 0)) {
        if (heading == null) heading = bearing(origin, location);
        entry.courseOrigin = location;
      } else if (!origin) entry.courseOrigin = location;
      if (heading != null) entry.heading = heading;
      entry.location = location;
      if (!entry.courier) entry.courier = new google.maps.Marker({ map: entry.map, position: location,
        title: "You", icon: courierIcon(entry.heading), zIndex: 10 });
      else { entry.courier.setPosition(location); entry.courier.setIcon(courierIcon(entry.heading)); }
      if (entry.follow) entry.map.panTo(location);
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
    updateRepresentativeLocation, setRepresentativeFollow, destroyRepresentatives, computeRoute,
    get errorMessage() { return errorMessage; },
  });
})();
