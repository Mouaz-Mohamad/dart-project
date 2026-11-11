// Shared Google Maps loader and courier route renderer. Browser key comes from deployment configuration.
(() => {
  "use strict";
  const mounted = new Map(), pendingPaths = new Map();
  let preloadRequest = null, libraryStartedAt = 0, libraryLoadMs = null;
  let request = null, authFailed = false, errorMessage = "", mountGeneration = 0;
  const configurationError = "تعذر تشغيل خرائط Google. تحقق من إعدادات واجهة الخرائط والفوترة والدومين المسموح في Google Cloud.";
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
  function applyCamera(entry, location, heading) {
    clearTimeout(entry.cameraTimer); entry.cameraTimer = null;
    if (!entry.follow || !entry.tilesReady || !mapIsVisible(entry) || entry.state === "error") return;
    entry.cameraAt = performance.now(); entry.cameraLocation = location; entry.cameraHeading = heading;
    entry.cameraUpdates = (entry.cameraUpdates || 0) + 1;
    if (entry.map.getRenderingType?.() === "VECTOR") entry.map.moveCamera({ center: location, heading, tilt: 60 });
    else entry.map.setCenter(location);
  }
  function drawCourier(entry, location, heading, final = false) {
    if (entry.container.dataset.mapState === "error" || !mapIsVisible(entry)) return;
    entry.drawnLocation = location; entry.drawnHeading = heading;
    // Keep the initial viewport still until streets load. GPS/marker animation must not churn tiles.
    if (entry.follow && entry.tilesReady) {
      const time = performance.now();
      const changed = final || entry.cameraAt == null || !entry.cameraLocation || metresBetween(entry.cameraLocation, location) >= 1 ||
        Math.abs(angleDifference(entry.cameraHeading ?? heading, heading)) >= 1;
      entry.pendingCamera = { location, heading };
      if (changed) {
        const remaining = entry.cameraAt == null ? 0 : 200 - (time - entry.cameraAt);
        if (remaining <= 0) applyCamera(entry, location, heading);
        else if (!entry.cameraTimer) entry.cameraTimer = setTimeout(() => {
          entry.cameraTimer = null;
          const target = entry.pendingCamera;
          if (mounted.get(entry.id) === entry && target) applyCamera(entry, target.location, target.heading);
        }, remaining);
      }
    }
    const rotation = ((heading - (entry.map.getHeading?.() || 0)) % 360 + 360) % 360;
    if (!entry.courier) entry.courier = new google.maps.Marker({ map: entry.map,
      position: location, title: "موقعك الحالي", icon: courierIcon(rotation), zIndex: 10 });
    else { entry.courier.setPosition(location); entry.courier.setIcon(courierIcon(rotation)); }
  }
  function animateCourier(entry, location, heading) {
    window.cancelAnimationFrame(entry.frame);
    if (!mapIsVisible(entry)) { entry.frame = null; return; }
    const from = entry.drawnLocation, fromHeading = entry.drawnHeading ?? heading;
    const started = performance.now();
    const duration = Math.max(300, Math.min(1000, started - (entry.lastAnimationAt ?? started - 800)));
    entry.lastAnimationAt = started;
    // Interpolate between real fixes only. Never extrapolate a courier past the latest GPS fix.
    if (!from || metresBetween(from, location) > 250 || document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawCourier(entry, location, heading, true); entry.frame = null; return;
    }
    const tick = time => {
      const t = Math.min(1, (time - started) / duration);
      drawCourier(entry, { lat: from.lat + (location.lat - from.lat) * t,
        lng: from.lng + (location.lng - from.lng) * t },
        (fromHeading + angleDifference(fromHeading, heading) * t + 360) % 360, t >= 1);
      entry.frame = t < 1 ? window.requestAnimationFrame(tick) : null;
    };
    entry.frame = window.requestAnimationFrame(tick);
  }
  function setFollow(entry, enabled) {
    entry.follow = Boolean(enabled);
    if (entry.follow && mapIsVisible(entry)) {
      entry.cameraAt = null; entry.cameraLocation = null;
      if (entry.tilesReady) entry.map.setZoom(17);
      if (entry.location) drawCourier(entry, entry.drawnLocation || entry.location, entry.drawnHeading ?? entry.heading ?? 0);
      else if (entry.target) applyCamera(entry, entry.target, entry.heading ?? 0);
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
      fail(authFailed ? configurationError : "مفتاح خرائط Google غير مفعّل في إعدادات النشر.");
      return Promise.resolve(false);
    }
    if (window.google?.maps?.Map) return Promise.resolve(true);
    if (request) return request;
    libraryStartedAt = Date.now();
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
        else libraryLoadMs = Date.now() - libraryStartedAt;
        resolve(Boolean(ok && !authFailed && window.google?.maps?.Map));
      };
      const timer = window.setTimeout(() => {
        fail("انتهت مهلة تحميل خرائط Google. تحقق من الاتصال وحاول مجددًا.");
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
      script.onerror = () => { fail("تعذر تحميل خرائط Google. تحقق من الاتصال وحاول مجددًا."); script.remove(); finish(false); };
      document.head.appendChild(script);
    });
    return request;
  }
  function preloadRepresentativeLibraries() {
    if (!preloadRequest) preloadRequest = loadMaps().then(async ok => {
      if (!ok) return false;
      await Promise.allSettled([google.maps.importLibrary("maps"), google.maps.importLibrary("routes")]);
      return true;
    }).catch(() => false);
    return preloadRequest;
  }
  function disposeRepresentativeMap(entry) {
    clearTimeout(entry.tileTimer);
    clearTimeout(entry.followTimer);
    clearTimeout(entry.cameraTimer); entry.cameraTimer = null;
    window.cancelAnimationFrame(entry.frame);
    entry.frame = null;
    entry.destination?.setMap(null); entry.courier?.setMap(null); entry.route?.setMap(null);
    if (entry.map) window.google?.maps?.event?.clearInstanceListeners(entry.map);
    entry.container.replaceChildren();
    entry.courier = null;
  }
  function mapState(entry, state, message = "") {
    entry.container.dataset.mapState = state;
    entry.state = state;
    document.dispatchEvent(new CustomEvent("dart:rep-map-state", { detail: {
      orderId: entry.id, state, message, renderer: entry.container.dataset.mapRenderer,
      fallbackReason: entry.fallbackReason || "",
    } }));
  }
  function mapIsVisible(entry) {
    const rect = entry.container.getBoundingClientRect();
    return !document.hidden && Boolean(entry.container.closest("dialog")?.open) && rect.width > 0 && rect.height > 0;
  }
  function getRepresentativeDiagnostics() {
    return [...mounted.values()].map(entry => ({
      requestedRenderer: entry.requestedRenderer, actualRenderer: entry.map?.getRenderingType?.() || "UNINITIALIZED",
      state: entry.state || "loading", fallbackReason: entry.fallbackReason || "",
      visible: mapIsVisible(entry), heading: entry.map?.getHeading?.() ?? null,
      tilt: entry.map?.getTilt?.() ?? null, startupFailure: entry.startupFailure || "",
      libraryLoadMs, firstTilesMs: entry.firstTilesMs ?? null, loadingIssue: entry.loadingIssue || "",
      cameraUpdates: entry.cameraUpdates || 0,
    }));
  }
  function createRepresentativeMap(entry, renderer = "VECTOR") {
    const center = (!entry.follow && point(entry.map?.getCenter?.())) || entry.location || entry.target || { lat: 30.0444, lng: 31.2357 };
    disposeRepresentativeMap(entry);
    entry.tilesReady = false; entry.createdAt = Date.now(); entry.firstTilesMs = null; entry.loadingIssue = "";
    entry.cameraAt = null; entry.cameraLocation = null;
    const canvas = document.createElement("div");
    canvas.className = "dart-google-map-overlay";
    entry.container.appendChild(canvas);
    entry.container.dataset.mapRenderer = renderer;
    entry.requestedRenderer ??= renderer;
    entry.container.dataset.mapFallbackReason = entry.fallbackReason || "";
    let map = null;
    const recover = reason => {
      if (mounted.get(entry.id) !== entry || authFailed || (map && entry.map !== map)) return;
      entry.fallbackReason = reason;
      entry.container.dataset.mapFallbackReason = reason;
      if (renderer === "VECTOR") createRepresentativeMap(entry, "RASTER");
      else {
        disposeRepresentativeMap(entry);
        entry.container.textContent = "تعذر تحميل شوارع الخريطة. تحقق من الاتصال وحاول مجددًا.";
        mapState(entry, "error", entry.container.textContent);
      }
    };
    try {
      map = new google.maps.Map(canvas, { center, zoom: 17, renderingType: renderer,
        // Google Maps road view: native map gestures and controls, 60° follow camera on VECTOR.
        // Raster mode cannot tilt, so keep its normal readable Google road map instead.
        tilt: 0, heading: 0, mapTypeId: "roadmap",
        tiltInteractionEnabled: true, headingInteractionEnabled: true, isFractionalZoomEnabled: true,
        disableDefaultUI: false, gestureHandling: "greedy", keyboardShortcuts: true,
        zoomControl: true, rotateControl: true, scaleControl: true,
        colorScheme: "LIGHT", clickableIcons: false, mapTypeControl: false,
        streetViewControl: false, fullscreenControl: false });
      entry.map = map;
      entry.drawnLocation = entry.location; entry.drawnHeading = entry.heading ?? 0;
      entry.destination = entry.target ? new google.maps.Marker({ map, position: entry.target, title: "مكان التسليم" }) : null;
      entry.route = new google.maps.Polyline({ map, path: entry.path, strokeColor: "#1a73e8", strokeOpacity: 1, strokeWeight: 6 });
      // Panning or rotating pauses automatic follow until the courier taps recenter.
      // Do not override a manually selected direction after an arbitrary timeout.
      map.addListener("dragstart", () => { clearTimeout(entry.followTimer); setFollow(entry, false); });
      const recenterButton = document.createElement("button");
      recenterButton.type = "button";
      recenterButton.className = "dart-google-map-recenter";
      recenterButton.textContent = "⌖";
      recenterButton.setAttribute("aria-label", "العودة إلى موقعي ومتابعة الاتجاه");
      recenterButton.title = "العودة إلى موقعي";
      recenterButton.addEventListener("click", () => {
        if (mounted.get(entry.id) === entry) setFollow(entry, true);
      });
      // Some test/fallback map adapters lack Google control buckets.
      const controlPosition = google.maps.ControlPosition?.RIGHT_BOTTOM;
      if (controlPosition != null && map.controls?.[controlPosition]?.push) {
        map.controls[controlPosition].push(recenterButton);
      } else {
        canvas.appendChild(recenterButton);
      }
      map.addListener("heading_changed", () => {
        // User rotation must not be immediately overwritten by the next GPS camera update.
        if (entry.tilesReady && entry.follow && entry.cameraHeading != null &&
            Math.abs(angleDifference(entry.cameraHeading, map.getHeading() || 0)) > 0.5) {
          setFollow(entry, false);
          clearTimeout(entry.followTimer);
        }
        entry.courier?.setIcon(courierIcon(((entry.drawnHeading - (map.getHeading() || 0)) % 360 + 360) % 360));
      });
      const readRenderer = () => {
        if (entry.map !== map || mounted.get(entry.id) !== entry) return;
        const actual = map.getRenderingType?.();
        if (actual === "VECTOR" || actual === "RASTER") {
          entry.container.dataset.mapRenderer = actual;
          if (renderer === "VECTOR" && actual === "RASTER") {
            entry.fallbackReason = "google-selected-raster";
            entry.container.dataset.mapFallbackReason = entry.fallbackReason;
          }
          // Google may resolve the rendering type after tilesloaded. Restore the real 60-degree camera then too.
          if (entry.tilesReady && actual === "VECTOR") setFollow(entry, entry.follow);
        }
      };
      map.addListener("renderingtype_changed", readRenderer);
      readRenderer();
      map.addListener("tilesloaded", () => {
        if (entry.map !== map || mounted.get(entry.id) !== entry || entry.tilesReady) return;
        entry.tilesReady = true; entry.loadingIssue = "";
        entry.firstTilesMs = Date.now() - entry.createdAt;
        entry.cameraAt = null; entry.cameraLocation = null;
        clearTimeout(entry.tileTimer);
        window.cancelAnimationFrame(entry.frame); entry.frame = null;
        entry.container.dataset.mapRenderer = map.getRenderingType?.() || renderer;
        if (renderer === "VECTOR" && entry.container.dataset.mapRenderer === "RASTER") {
          entry.fallbackReason = "google-selected-raster";
          entry.container.dataset.mapFallbackReason = entry.fallbackReason;
        }
        mapState(entry, "ready", "");
        setFollow(entry, entry.follow);
      });
      canvas.addEventListener("webglcontextlost", () => recover("webgl-context-lost"), { once: true, capture: true });
      mapState(entry, "loading", renderer === "RASTER" ? "جارٍ عرض خريطة Google العادية..." : "جارٍ تحميل خريطة الشوارع...");
      // A delayed all-visible-tiles event is not proof that VECTOR failed. Never recreate on a timer.
      entry.visibleSince = mapIsVisible(entry) ? Date.now() : null;
      const checkTiles = () => {
        if (entry.map !== map || mounted.get(entry.id) !== entry || entry.tilesReady) return;
        if (!mapIsVisible(entry)) entry.visibleSince = null;
        else {
          entry.visibleSince ??= Date.now();
          const elapsed = Date.now() - entry.visibleSince;
          if (elapsed >= 20000) {
            entry.loadingIssue = "streets-timeout";
            mapState(entry, "error", "لم يكتمل تحميل الشوارع. أغلق النافذة وافتحها مجددًا لإعادة المحاولة.");
            return;
          }
          if (elapsed >= 8000) mapState(entry, "slow", "تحميل الشوارع يستغرق وقتًا أطول. ما زالت المحاولة جارية.");
        }
        entry.tileTimer = setTimeout(checkTiles, 4000);
      };
      entry.tileTimer = setTimeout(checkTiles, 4000);
      setFollow(entry, entry.follow);
    } catch (error) {
      entry.startupFailure = error instanceof Error ? error.name : "Error";
      recover("map-startup-error");
    }
  }
  function destroyRepresentatives() {
    mountGeneration += 1;
    for (const entry of mounted.values()) disposeRepresentativeMap(entry);
    mounted.clear();
    pendingPaths.clear();
  }
  function resizeRepresentatives() {
    for (const entry of mounted.values()) {
      if (entry.map && entry.container.getBoundingClientRect().height > 0) {
        if (!entry.tilesReady) entry.visibleSince = Date.now();
        google.maps.event?.trigger?.(entry.map, "resize");
        entry.cameraAt = null; entry.cameraLocation = null;
        if (entry.location) drawCourier(entry, entry.location, entry.heading ?? 0);
        else if (entry.target) applyCamera(entry, entry.target, entry.heading ?? 0);
      }
    }
  }
  function pauseRepresentatives() {
    for (const entry of mounted.values()) {
      window.cancelAnimationFrame(entry.frame); clearTimeout(entry.cameraTimer);
      entry.frame = null; entry.cameraTimer = null; entry.visibleSince = null;
    }
  }
  async function attachRepresentatives(orders) {
    const generation = mountGeneration;
    const nodes = [...document.querySelectorAll("[data-rep-live-map]")].filter(node => node.closest("dialog")?.open);
    if (!nodes.length) return;
    if (!await loadMaps()) {
      nodes.forEach(node => { node.textContent = errorMessage; node.dataset.mapState = "error"; });
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
        courseOrigin: courier, follow: true, path: pendingPaths.get(id) || [] };
      pendingPaths.delete(id);
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
    if (document.hidden) pauseRepresentatives();
    else resizeRepresentatives();
  });
  async function computeRoute(origin, destination) {
    if (!await loadMaps()) throw new Error(errorMessage);
    const { Route } = await google.maps.importLibrary("routes");
    const result = await Route.computeRoutes({ origin, destination, travelMode: "DRIVING",
      language: "ar", region: "eg", fields: ["path", "legs", "distanceMeters", "durationMillis", "warnings"],
    });
    const route = result.routes?.[0];
    if (!route?.path?.length) throw new Error("تعذر العثور على مسار مناسب للسيارة.");
    return { geometry: route.path.map(p => { const c = point(p); return c ? [c.lat, c.lng] : null; }).filter(Boolean),
      steps: (route.legs || []).flatMap(leg => leg.steps || []).map(step => ({
        instruction: String(step.instructions || "استمر للأمام"), maneuver: String(step.maneuver || "STRAIGHT"),
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
    if (!path.every(Boolean)) return;
    if (entry) { entry.path = path; entry.route?.setPath(path); }
    else { pendingPaths.clear(); pendingPaths.set(String(orderId), path); }
  });
  window.DartGoogleMaps = Object.freeze({ loadMaps, preloadRepresentativeLibraries, pauseRepresentatives, attachRepresentatives,
    getRepresentativeDiagnostics, resizeRepresentatives, updateRepresentativeLocation, setRepresentativeFollow, useStandardRepresentativeMap, destroyRepresentatives, computeRoute,
    get errorMessage() { return errorMessage; },
  });
})();
