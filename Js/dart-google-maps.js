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
  const angleDifference = (from, to) => ((to - from + 540) % 360) - 180;
  function metresBetween(a, b) {
    return a && b ? Math.hypot((b.lat - a.lat) * 111195,
      (b.lng - a.lng) * 111195 * Math.cos(b.lat * Math.PI / 180)) : Infinity;
  }
  function drawCourier(entry, location, heading) {
    if (entry.container.dataset.mapState === "error") return;
    entry.drawnLocation = location; entry.drawnHeading = heading;
    if (entry.follow) {
      if (entry.tilesReady && entry.map.getRenderingType?.() === "VECTOR") {
        entry.map.moveCamera({ center: location, heading, tilt: 60 });
      } else entry.map.setCenter(location);
    }
    const rotation = ((heading - (entry.map.getHeading?.() || 0)) % 360 + 360) % 360;
    if (!entry.courier) entry.courier = new google.maps.Marker({ map: entry.map,
      position: location, title: "You", icon: courierIcon(rotation), zIndex: 10 });
    else { entry.courier.setPosition(location); entry.courier.setIcon(courierIcon(rotation)); }
  }
  function animateCourier(entry, location, heading) {
    window.cancelAnimationFrame(entry.frame);
    const from = entry.drawnLocation, fromHeading = entry.drawnHeading ?? heading;
    const started = performance.now();
    const duration = Math.max(300, Math.min(1000, started - (entry.lastAnimationAt ?? started - 800)));
    entry.lastAnimationAt = started;
    // Interpolate between real fixes only. Never extrapolate a courier past the latest GPS fix.
    if (!from || metresBetween(from, location) > 250 || document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawCourier(entry, location, heading); entry.frame = null; return;
    }
    const tick = time => {
      const t = Math.min(1, (time - started) / duration);
      drawCourier(entry, { lat: from.lat + (location.lat - from.lat) * t,
        lng: from.lng + (location.lng - from.lng) * t },
        (fromHeading + angleDifference(fromHeading, heading) * t + 360) % 360);
      entry.frame = t < 1 ? window.requestAnimationFrame(tick) : null;
    };
    entry.frame = window.requestAnimationFrame(tick);
  }
  function setFollow(entry, enabled) {
    entry.follow = Boolean(enabled);
    if (entry.follow && entry.location) {
      entry.map.setZoom(17);
      drawCourier(entry, entry.drawnLocation || entry.location, entry.drawnHeading ?? entry.heading ?? 0);
    }
    document.dispatchEvent(new CustomEvent("dart:rep-map-follow", { detail: { following: entry.follow } }));
  }
  function setRepresentativeFollow(enabled) {
    for (const entry of mounted.values()) setFollow(entry, enabled);
  }
  function useStandardRepresentativeMap() {
    for (const entry of mounted.values()) {
      if (entry.container.dataset.mapRenderer !== "RASTER" || entry.container.dataset.mapState === "error") createRepresentativeMap(entry, "RASTER");
    }
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
  function disposeRepresentativeMap(entry) {
    clearTimeout(entry.tileTimer);
    clearTimeout(entry.followTimer);
    window.cancelAnimationFrame(entry.frame);
    entry.frame = null;
    entry.destination?.setMap(null); entry.courier?.setMap(null); entry.route?.setMap(null);
    if (entry.map) window.google?.maps?.event?.clearInstanceListeners(entry.map);
    entry.container.replaceChildren();
    entry.courier = null;
  }
  function mapState(entry, state, message = "") {
    entry.container.dataset.mapState = state;
    document.dispatchEvent(new CustomEvent("dart:rep-map-state", { detail: { orderId: entry.id, state, message } }));
  }
  function createRepresentativeMap(entry, renderer = "VECTOR") {
    const center = (!entry.follow && point(entry.map?.getCenter?.())) || entry.location || entry.target || { lat: 30.0444, lng: 31.2357 };
    disposeRepresentativeMap(entry);
    entry.tilesReady = false;
    const canvas = document.createElement("div");
    canvas.className = "dart-google-map-overlay";
    entry.container.appendChild(canvas);
    entry.container.dataset.mapRenderer = renderer;
    let map = null;
    const recover = () => {
      if (mounted.get(entry.id) !== entry || authFailed || (map && entry.map !== map)) return;
      if (renderer === "VECTOR") createRepresentativeMap(entry, "RASTER");
      else {
        disposeRepresentativeMap(entry);
        entry.container.textContent = "Google map streets could not load. Check your connection and retry Google Maps.";
        mapState(entry, "error", entry.container.textContent);
      }
    };
    try {
      map = new google.maps.Map(canvas, { center, zoom: 17, renderingType: renderer,
        tilt: renderer === "VECTOR" ? 60 : 0, heading: renderer === "VECTOR" ? entry.heading ?? 0 : 0,
        tiltInteractionEnabled: true, headingInteractionEnabled: true, isFractionalZoomEnabled: true,
        disableDefaultUI: true, colorScheme: "LIGHT", clickableIcons: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      entry.map = map;
      entry.drawnLocation = entry.location; entry.drawnHeading = entry.heading ?? 0;
      entry.destination = entry.target ? new google.maps.Marker({ map, position: entry.target, title: "Customer destination" }) : null;
      entry.route = new google.maps.Polyline({ map, path: entry.path, strokeColor: "#1a73e8", strokeOpacity: 1, strokeWeight: 6 });
      map.addListener("dragstart", () => { clearTimeout(entry.followTimer); setFollow(entry, false); });
      map.addListener("dragend", () => {
        entry.followTimer = setTimeout(() => { if (mounted.get(entry.id) === entry && entry.map === map) setFollow(entry, true); }, 8000);
      });
      map.addListener("heading_changed", () => {
        entry.courier?.setIcon(courierIcon(((entry.drawnHeading - (map.getHeading() || 0)) % 360 + 360) % 360));
      });
      map.addListener("renderingtype_changed", () => {
        if (entry.map === map && entry.tilesReady && entry.location) drawCourier(entry, entry.location, entry.heading ?? 0);
      });
      map.addListener("tilesloaded", () => {
        if (entry.map !== map || mounted.get(entry.id) !== entry || entry.tilesReady) return;
        entry.tilesReady = true; clearTimeout(entry.tileTimer);
        window.cancelAnimationFrame(entry.frame); entry.frame = null;
        entry.container.dataset.mapRenderer = map.getRenderingType?.() || renderer;
        mapState(entry, "ready", entry.container.dataset.mapRenderer === "RASTER" ? "Showing the standard Google Maps view." : "");
        if (entry.location) drawCourier(entry, entry.location, entry.heading ?? 0);
      });
      canvas.addEventListener("webglcontextlost", recover, { once: true, capture: true });
      mapState(entry, "loading", renderer === "RASTER" ? "Switching to the standard Google Maps view..." : "Loading Google road map...");
      const checkTiles = () => {
        if (entry.map !== map || mounted.get(entry.id) !== entry || entry.tilesReady) return;
        if (document.hidden) entry.tileTimer = setTimeout(checkTiles, 10000);
        else recover();
      };
      entry.tileTimer = setTimeout(checkTiles, 10000);
      setFollow(entry, entry.follow);
    } catch { recover(); }
  }
  function destroyRepresentatives() {
    mountGeneration += 1;
    for (const entry of mounted.values()) disposeRepresentativeMap(entry);
    mounted.clear();
  }
  function resizeRepresentatives() {
    for (const entry of mounted.values()) {
      if (entry.map && entry.container.getBoundingClientRect().height > 0) {
        google.maps.event?.trigger?.(entry.map, "resize");
        if (entry.location) drawCourier(entry, entry.location, entry.heading ?? 0);
      }
    }
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
      const entry = { id, container, target: destination, location: courier, heading: gpsHeading(position),
        courseOrigin: courier, follow: true, path: [] };
      mounted.set(id, entry);
      createRepresentativeMap(entry);
    }
  }
  function updateRepresentativeLocation(position) {
    const location = point(position);
    const updatedAt = Date.parse(position?.updatedAt || "");
    const sampledAt = Date.parse(position?.sampledAt || position?.updatedAt || "");
    if (!location || !Number.isFinite(updatedAt) || Math.abs(Date.now() - updatedAt) > 120000) return;
    if (!Number.isFinite(sampledAt) || Math.abs(Date.now() - sampledAt) > 120000) return;
    const previous = window.DART_REP_LAST_LOCATION;
    if (sampledAt < Date.parse(previous?.sampledAt || previous?.updatedAt || "")) return;
    window.DART_REP_LAST_LOCATION = { ...location, heading: position.heading, speed: position.speed,
      accuracy: position.accuracy, sampledAt: new Date(sampledAt).toISOString(), updatedAt: position.updatedAt };
    for (const entry of mounted.values()) {
      let heading = gpsHeading(position);
      const origin = entry.courseOrigin;
      // Devices often omit GPS heading. Derive a course only after moving beyond GPS jitter.
      const metres = metresBetween(origin, location);
      if (origin && metres >= Math.max(8, Number(position.accuracy) || 0)) {
        if (heading == null && (position.speed == null || position.speed >= 0.8)) heading = bearing(origin, location);
        entry.courseOrigin = location;
      } else if (!origin) entry.courseOrigin = location;
      const nextHeading = heading ?? entry.heading ?? 0;
      if (metresBetween(entry.location, location) < 0.01 && Math.abs(angleDifference(entry.heading ?? 0, nextHeading)) < 0.01) continue;
      entry.heading = nextHeading;
      entry.location = location;
      animateCourier(entry, location, nextHeading);
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    for (const entry of mounted.values()) {
      window.cancelAnimationFrame(entry.frame); entry.frame = null;
      if (entry.location) drawCourier(entry, entry.location, entry.heading ?? 0);
    }
  });
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
    const entry = mounted.get(String(orderId));
    if (entry && path.every(Boolean)) { entry.path = path; entry.route?.setPath(path); }
  });
  window.DartGoogleMaps = Object.freeze({ loadMaps, attachRepresentatives,
    resizeRepresentatives, updateRepresentativeLocation, setRepresentativeFollow, useStandardRepresentativeMap, destroyRepresentatives, computeRoute,
    get errorMessage() { return errorMessage; },
  });
})();
