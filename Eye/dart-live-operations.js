// DART CODE GUIDE | Eye/dart-live-operations.js
// الغرض: تشغيل Live Operations Map من Backend فقط، بتحديث 3 ثوانٍ ودون إعادة تحميل الصفحة.
(function () {
  "use strict";

  const section = document.getElementById("live-operations");
  if (!section) return;

  const POLL_MS = 3000;
  const ROUTE_REFRESH_MS = 15000;
  const COLORS = Object.freeze({
    current: "#AB012B",
    upcoming: "#2563eb",
    delivered: "#16a34a",
    waiting: "#eab308",
    problem: "#ea580c",
    cancelled: "#ea580c",
    refused: "#ea580c",
  });
  const FILTER_GROUP = Object.freeze({
    current: "current",
    upcoming: "upcoming",
    delivered: "delivered",
    waiting: "waiting",
    problem: "problem",
    cancelled: "problem",
    refused: "problem",
  });

  const nodes = {
    total: document.getElementById("live-map-total-orders"),
    delivered: document.getElementById("live-map-delivered-orders"),
    current: document.getElementById("live-map-current-orders"),
    reps: document.getElementById("live-map-active-reps"),
    repSelect: document.getElementById("live-map-representative-filter"),
    repList: document.getElementById("live-map-representatives"),
    map: document.getElementById("dart-live-operations-map"),
    status: document.getElementById("live-map-connection"),
    statusText: document.getElementById("live-map-connection-text"),
    panel: document.getElementById("live-map-panel"),
    panelBody: document.getElementById("live-map-panel-body"),
    empty: document.getElementById("live-map-empty"),
    error: document.getElementById("live-map-error"),
    loading: document.getElementById("live-map-loading"),
    fit: document.getElementById("live-map-fit"),
    refresh: document.getElementById("live-map-refresh"),
    fullscreen: document.getElementById("live-map-fullscreen"),
  };

  let snapshot = { capturedAt: null, totals: {}, representatives: [] };
  let map = null;
  let refreshTimer = null;
  let requestInFlight = false;
  let selectedRepresentativeId = "";
  let selectedOrderId = "";
  let manualView = false;
  let repMarkers = new Map();
  let orderMarkers = new Map();
  let routeLayers = new Map();
  let routeFetchState = new Map();

  function api(path, options) {
    if (!window.DartApi?.request) {
      return Promise.reject(new Error("Dart API is unavailable."));
    }
    return window.DartApi.request(path, options);
  }

  function can(permission) {
    return window.DartAdminAccess?.can?.(permission) === true;
  }

  function canRead() {
    return can("live_map.read") || can("orders.read");
  }

  function canManage() {
    return can("live_map.manage") || can("orders.manage");
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stateLabel(state) {
    return ({
      current: "Delivering",
      upcoming: "Upcoming",
      delivered: "Delivered",
      waiting: "Waiting",
      problem: "Problem",
      cancelled: "Cancelled",
      refused: "Refused",
    })[state] || "Upcoming";
  }

  function stateIcon(state) {
    return ({
      current: "fa-location-arrow",
      upcoming: "fa-clock",
      delivered: "fa-circle-check",
      waiting: "fa-hourglass-half",
      problem: "fa-triangle-exclamation",
      cancelled: "fa-ban",
      refused: "fa-circle-xmark",
    })[state] || "fa-location-dot";
  }

  function filterEnabled(state) {
    const key = FILTER_GROUP[state] || state;
    const input = section.querySelector(`[data-live-filter="${key}"]`);
    return Boolean(input?.checked);
  }

  function visibleRep(rep) {
    return !selectedRepresentativeId || String(rep.id) === selectedRepresentativeId;
  }

  function activeSection() {
    return section.classList.contains("active-section") && !document.hidden;
  }

  function setConnection(kind, text) {
    if (!nodes.status || !nodes.statusText) return;
    nodes.status.classList.toggle("is-stale", kind === "stale");
    nodes.status.classList.toggle("is-error", kind === "error");
    nodes.statusText.textContent = text;
  }

  function setState(name) {
    if (nodes.loading) nodes.loading.hidden = name !== "loading";
    if (nodes.empty) nodes.empty.hidden = name !== "empty";
    if (nodes.error) nodes.error.hidden = name !== "error";
  }

  function ensureMap() {
    if (map || !nodes.map || typeof window.L === "undefined") return map;
    map = window.L.map(nodes.map, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([30.0444, 31.2357], 11);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.on("dragstart zoomstart", () => {
      manualView = true;
    });
    window.setTimeout(() => map.invalidateSize(), 100);
    return map;
  }

  function repIcon(rep) {
    const stale = rep.connectionStatus === "Location Stale";
    const offline = rep.connectionStatus === "Offline";
    const glyph = offline ? "fa-user-clock" : stale ? "fa-location-crosshairs" : "fa-motorcycle";
    return window.L.divIcon({
      className: "",
      html: `<div class="dart-live-rep-marker" aria-label="${esc(rep.name)} ${esc(rep.connectionStatus)}"><i class="fa-solid ${glyph}"></i></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function orderIcon(order) {
    const state = String(order.routeState || "upcoming");
    const color = COLORS[state] || COLORS.upcoming;
    return window.L.divIcon({
      className: "",
      html: `<div class="dart-live-marker" style="background:${color}" aria-label="${esc(order.orderId)} ${esc(stateLabel(state))}"><i class="fa-solid ${stateIcon(state)}"></i></div>`,
      iconSize: [36, 36],
      iconAnchor: [9, 31],
    });
  }

  function orderCoordinates(order) {
    const lat = Number(order.latitude);
    const lng = Number(order.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }

  function allBoundsPoints() {
    const points = [];
    for (const rep of snapshot.representatives || []) {
      if (!visibleRep(rep)) continue;
      if (rep.location && Number.isFinite(Number(rep.location.lat)) && Number.isFinite(Number(rep.location.lng))) {
        points.push([Number(rep.location.lat), Number(rep.location.lng)]);
      }
      for (const order of rep.orders || []) {
        if (!filterEnabled(order.routeState)) continue;
        const point = orderCoordinates(order);
        if (point) points.push(point);
      }
    }
    return points;
  }

  function fitMap(force = false) {
    if (!map || (!force && manualView)) return;
    const points = allBoundsPoints();
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(window.L.latLngBounds(points), { padding: [46, 46], maxZoom: 15 });
  }

  function clearLayerMap(layerMap) {
    for (const layer of layerMap.values()) {
      try { layer.remove(); } catch {}
    }
    layerMap.clear();
  }

  function routeCoordinates(rep) {
    const stops = (rep.orders || [])
      .filter((order) => filterEnabled(order.routeState))
      .filter((order) => orderCoordinates(order))
      .sort((a, b) => {
        if (a.routeState === "current" && b.routeState !== "current") return -1;
        if (b.routeState === "current" && a.routeState !== "current") return 1;
        const av = Number(a.sequenceNumber || a.suggestedSequence || 9999);
        const bv = Number(b.sequenceNumber || b.suggestedSequence || 9999);
        return av - bv;
      });
    const coordinates = [];
    if (rep.location && Number.isFinite(Number(rep.location.lat)) && Number.isFinite(Number(rep.location.lng))) {
      coordinates.push([Number(rep.location.lat), Number(rep.location.lng)]);
    }
    for (const stop of stops) coordinates.push(orderCoordinates(stop));
    return { stops, coordinates };
  }

  async function roadGeometry(rep, coordinates) {
    if (!coordinates || coordinates.length < 2 || String(rep.id) !== selectedRepresentativeId) {
      return null;
    }
    const now = Date.now();
    const cached = routeFetchState.get(rep.id);
    if (cached && now - cached.at < ROUTE_REFRESH_MS) return cached.geometry;
    const points = coordinates.slice(0, 20).map(([lat, lng]) => `${lng},${lat}`).join(";");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=false`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      if (!response.ok) throw new Error("Routing provider unavailable");
      const payload = await response.json();
      const raw = payload.routes?.[0]?.geometry?.coordinates;
      const geometry = Array.isArray(raw)
        ? raw.map(([lng, lat]) => [lat, lng])
        : null;
      routeFetchState.set(rep.id, { at: now, geometry });
      return geometry;
    } catch {
      routeFetchState.set(rep.id, { at: now, geometry: null });
      return null;
    }
  }

  async function renderRoutes() {
    if (!map) return;
    clearLayerMap(routeLayers);
    for (const rep of snapshot.representatives || []) {
      if (!visibleRep(rep)) continue;
      const { stops, coordinates } = routeCoordinates(rep);
      if (coordinates.length < 2) continue;

      const currentStop = stops.find((stop) => stop.routeState === "current") || null;
      const road = currentStop ? await roadGeometry(rep, coordinates.slice(0, 2)) : null;
      if (road?.length) {
        const layer = window.L.polyline(road, {
          color: COLORS.current,
          weight: 6,
          opacity: .82,
        }).addTo(map);
        routeLayers.set(`${rep.id}:road-current`, layer);
      }

      // Keep the full operational route visible with its approved state colors.
      // The selected representative additionally receives a road-aware current segment above.
      for (let index = 1; index < coordinates.length; index += 1) {
        const target = stops[Math.max(0, index - 1)];
        if (!target) continue;
        const layer = window.L.polyline(
          [coordinates[index - 1], coordinates[index]],
          {
            color: COLORS[target.routeState] || COLORS.upcoming,
            weight: target.routeState === "current" ? 5 : 3,
            opacity: target.routeState === "delivered" ? .55 : .72,
            dashArray: target.routeState === "upcoming" ? "8 8" : undefined,
          },
        ).addTo(map);
        routeLayers.set(`${rep.id}:${target.orderId}`, layer);
      }
    }
  }

  function renderMarkers() {
    ensureMap();
    if (!map) return;
    clearLayerMap(repMarkers);
    clearLayerMap(orderMarkers);

    for (const rep of snapshot.representatives || []) {
      if (!visibleRep(rep)) continue;
      if (rep.location && Number.isFinite(Number(rep.location.lat)) && Number.isFinite(Number(rep.location.lng))) {
        const marker = window.L.marker(
          [Number(rep.location.lat), Number(rep.location.lng)],
          { icon: repIcon(rep), zIndexOffset: 1000 },
        )
          .addTo(map)
          .bindTooltip(esc(rep.name), { permanent: false, direction: "top", className: "dart-live-marker-label" });
        marker.on("click", () => selectRepresentative(rep.id, true));
        repMarkers.set(String(rep.id), marker);
      }

      for (const order of rep.orders || []) {
        if (!filterEnabled(order.routeState)) continue;
        const point = orderCoordinates(order);
        if (!point) continue;
        const marker = window.L.marker(point, {
          icon: orderIcon(order),
          zIndexOffset: order.routeState === "current" ? 800 : 100,
        }).addTo(map);
        marker.bindPopup(
          `<div class="dart-live-order-popup"><strong>#${esc(order.orderId)}</strong><small>${esc(stateLabel(order.routeState))}</small><small>${esc(order.clientName || "")}</small></div>`,
        );
        marker.on("click", () => selectOrder(rep.id, order.orderId));
        orderMarkers.set(String(order.orderId), marker);
      }
    }
    void renderRoutes();
    fitMap();
  }

  function renderCards() {
    const totals = snapshot.totals || {};
    if (nodes.total) nodes.total.textContent = Number(totals.totalOrders || 0);
    if (nodes.delivered) nodes.delivered.textContent = Number(totals.deliveredOrders || 0);
    if (nodes.current) nodes.current.textContent = Number(totals.deliveringNow || 0);
    if (nodes.reps) nodes.reps.textContent = Number(totals.activeRepresentatives || 0);
  }

  function repCounts(rep) {
    const counts = { delivered: 0, current: 0, upcoming: 0, waiting: 0, problem: 0 };
    for (const order of rep.orders || []) {
      const key = FILTER_GROUP[order.routeState] || order.routeState;
      if (key in counts) counts[key] += 1;
    }
    return counts;
  }

  function renderRepresentativeList() {
    if (!nodes.repList || !nodes.repSelect) return;
    const reps = snapshot.representatives || [];
    const currentSelection = selectedRepresentativeId;
    nodes.repSelect.innerHTML =
      '<option value="">All active representatives</option>' +
      reps.map((rep) => `<option value="${esc(rep.id)}">${esc(rep.name)} · ${esc(rep.repId)}</option>`).join("");
    nodes.repSelect.value = currentSelection;

    nodes.repList.innerHTML = reps.map((rep) => {
      const counts = repCounts(rep);
      const last = rep.lastLocationAt ? new Date(rep.lastLocationAt).toLocaleTimeString() : "No GPS";
      return `<button type="button" class="dart-live-rep-card ${String(rep.id) === selectedRepresentativeId ? "is-selected" : ""}" data-live-rep-id="${esc(rep.id)}">
        <div class="dart-live-rep-row">
          <div class="dart-live-rep-name"><span class="dart-live-rep-avatar"><i class="fa-solid fa-motorcycle"></i></span><span><strong>${esc(rep.name)}</strong><small>${esc(rep.repId)}</small></span></div>
          <span class="dart-live-pill">${esc(rep.connectionStatus)}</span>
        </div>
        <div class="dart-live-rep-meta">
          <span>${counts.current} current</span><span>${counts.upcoming} upcoming</span><span>${counts.delivered} delivered</span><span>${esc(last)}</span>
        </div>
      </button>`;
    }).join("") || '<div class="dart-live-empty">No active representatives.</div>';
  }

  function stopRows(rep) {
    const orders = [...(rep.orders || [])].sort((a, b) => {
      if (a.routeState === "current" && b.routeState !== "current") return -1;
      if (b.routeState === "current" && a.routeState !== "current") return 1;
      return Number(a.sequenceNumber || a.suggestedSequence || 9999) - Number(b.sequenceNumber || b.suggestedSequence || 9999);
    });
    return orders.map((order, index) => `
      <div class="dart-live-stop" data-route-order="${esc(order.orderId)}">
        <span class="dart-live-stop-index" style="border:2px solid ${COLORS[order.routeState] || COLORS.upcoming}">${index + 1}</span>
        <button type="button" class="dart-live-stop-copy" data-live-order="${esc(order.orderId)}" style="border:0;background:transparent;text-align:left;cursor:pointer">
          <strong>#${esc(order.orderId)} · ${esc(stateLabel(order.routeState))}</strong>
          <small>${esc(order.clientName)} · Suggested #${esc(order.suggestedSequence || "-")}</small>
        </button>
        ${canManage() && ["current","upcoming","waiting","problem"].includes(order.routeState) ? `
        <span class="dart-live-stop-actions">
          <button type="button" class="dart-live-mini-btn" data-route-move="up" aria-label="Move stop up"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="dart-live-mini-btn" data-route-move="down" aria-label="Move stop down"><i class="fa-solid fa-chevron-down"></i></button>
        </span>` : ""}
      </div>`).join("");
  }

  function renderRepresentativePanel(rep) {
    if (!nodes.panel || !nodes.panelBody) return;
    const counts = repCounts(rep);
    const last = rep.lastLocationAt ? new Date(rep.lastLocationAt).toLocaleString() : "No location received";
    nodes.panelBody.innerHTML = `
      <div class="dart-live-panel-head"><div><small>${esc(rep.repId)}</small><h2>${esc(rep.name)}</h2></div><button type="button" class="dart-live-panel-close" data-live-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dart-live-panel-grid">
        <div class="dart-live-panel-stat"><small>Status</small><strong>${esc(rep.connectionStatus)}</strong></div>
        <div class="dart-live-panel-stat"><small>GPS update</small><strong>${esc(last)}</strong></div>
        <div class="dart-live-panel-stat"><small>Current</small><strong>${esc(rep.currentOrderId || "None")}</strong></div>
        <div class="dart-live-panel-stat"><small>Next</small><strong>${esc(rep.nextOrderId || "None")}</strong></div>
        <div class="dart-live-panel-stat"><small>Delivered</small><strong>${counts.delivered}</strong></div>
        <div class="dart-live-panel-stat"><small>Remaining</small><strong>${counts.current + counts.upcoming + counts.waiting + counts.problem}</strong></div>
      </div>
      <div class="dart-live-stop-list" data-live-route-list>${stopRows(rep)}</div>
      ${canManage() ? `<div class="dart-live-panel-actions">
        <button type="button" class="dart-live-action is-primary" data-route-save>Save route order</button>
        <button type="button" class="dart-live-action" data-route-suggested>Use suggested order</button>
      </div>` : ""}
    `;
    nodes.panel.hidden = false;
  }

  function renderOrderPanel(rep, order) {
    if (!nodes.panel || !nodes.panelBody) return;
    nodes.panelBody.innerHTML = `
      <div class="dart-live-panel-head"><div><small>${esc(rep.name)}</small><h2>Order #${esc(order.orderId)}</h2></div><button type="button" class="dart-live-panel-close" data-live-close><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dart-live-panel-grid">
        <div class="dart-live-panel-stat"><small>State</small><strong>${esc(stateLabel(order.routeState))}</strong></div>
        <div class="dart-live-panel-stat"><small>Suggested</small><strong>#${esc(order.suggestedSequence || "-")}</strong></div>
        <div class="dart-live-panel-stat"><small>Customer</small><strong>${esc(order.clientName || "-")}</strong></div>
        <div class="dart-live-panel-stat"><small>COD</small><strong>${esc(Number(order.finalAmount || 0).toFixed(0))} EGP</strong></div>
      </div>
      <p><strong>Address</strong><br>${esc(order.fullAddress || "Map pin only")}</p>
      ${order.note ? `<p><strong>Note</strong><br>${esc(order.note)}</p>` : ""}
      <div class="dart-live-panel-actions">
        <button type="button" class="dart-live-action" data-open-order="${esc(order.orderId)}">Open Order</button>
        ${canManage() && !["delivered","cancelled","refused"].includes(order.routeState) ? `
          <button type="button" class="dart-live-action is-primary" data-route-state="current">Set Current</button>
          <button type="button" class="dart-live-action" data-route-state="upcoming">Upcoming</button>
          <button type="button" class="dart-live-action is-waiting" data-route-state="waiting">Waiting</button>
          <button type="button" class="dart-live-action is-problem" data-route-state="problem">Problem</button>
        ` : ""}
      </div>
    `;
    nodes.panel.hidden = false;
  }

  function selectRepresentative(id, focus = false) {
    selectedRepresentativeId = String(id || "");
    selectedOrderId = "";
    if (nodes.repSelect) nodes.repSelect.value = selectedRepresentativeId;
    renderRepresentativeList();
    renderMarkers();
    const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
    if (rep) {
      renderRepresentativePanel(rep);
      if (focus && rep.location && map) {
        manualView = false;
        map.setView([Number(rep.location.lat), Number(rep.location.lng)], 14);
      }
    }
  }

  function selectOrder(repId, orderId) {
    selectedRepresentativeId = String(repId || "");
    selectedOrderId = String(orderId || "");
    renderRepresentativeList();
    const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
    const order = rep?.orders?.find((row) => String(row.orderId) === selectedOrderId);
    if (rep && order) renderOrderPanel(rep, order);
  }

  async function mutateOrderState(state) {
    if (!selectedOrderId || !canManage()) return;
    const note = state === "problem" ? (prompt("Problem note (optional):") || "") : "";
    snapshot = await api(
      `/api/v1/admin/live-operations/orders/${encodeURIComponent(selectedOrderId)}/state`,
      { method: "POST", body: { state, ...(note ? { note } : {}) } },
    );
    renderAll(false);
    const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
    const order = rep?.orders?.find((row) => String(row.orderId) === selectedOrderId);
    if (rep && order) renderOrderPanel(rep, order);
  }

  function routeOrderFromPanel() {
    return [...(nodes.panelBody?.querySelectorAll("[data-route-order]") || [])]
      .map((node) => node.getAttribute("data-route-order"))
      .filter(Boolean);
  }

  async function saveRouteOrder(rep, orderCodes) {
    if (!rep || !canManage() || !orderCodes.length) return;
    snapshot = await api(
      `/api/v1/admin/live-operations/representatives/${encodeURIComponent(rep.id)}/reorder`,
      { method: "POST", body: { orderCodes } },
    );
    renderAll(false);
    const fresh = (snapshot.representatives || []).find((row) => String(row.id) === String(rep.id));
    if (fresh) renderRepresentativePanel(fresh);
  }

  function renderAll(autoFit = true) {
    ensureMap();
    renderCards();
    renderRepresentativeList();
    renderMarkers();
    if (autoFit) {
      manualView = false;
      fitMap(true);
    }
    if (!(snapshot.representatives || []).length) setState("empty");
    else setState("ready");
  }

  async function refresh({ force = false } = {}) {
    if ((!force && !activeSection()) || requestInFlight || !canRead()) return;
    requestInFlight = true;
    if (!snapshot.capturedAt) setState("loading");
    try {
      const incoming = await api("/api/v1/admin/live-operations");
      snapshot = incoming || { capturedAt: null, totals: {}, representatives: [] };
      setConnection("online", `Live · every 3s · ${new Date(snapshot.capturedAt || Date.now()).toLocaleTimeString()}`);
      renderAll(!snapshot.capturedAt || !manualView);
      if (selectedOrderId) {
        const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
        const order = rep?.orders?.find((row) => String(row.orderId) === selectedOrderId);
        if (rep && order) renderOrderPanel(rep, order);
      } else if (selectedRepresentativeId) {
        const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
        if (rep) renderRepresentativePanel(rep);
      }
    } catch (error) {
      setConnection("error", error?.message || "Connection lost");
      if (!snapshot.capturedAt) {
        if (nodes.error) nodes.error.textContent = error?.message || "Live operations could not be loaded.";
        setState("error");
      } else {
        setConnection("stale", "Reconnecting · showing last known data");
      }
    } finally {
      requestInFlight = false;
    }
  }

  function startPolling() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void refresh(), POLL_MS);
    void refresh({ force: true });
  }

  function bind() {
    nodes.repSelect?.addEventListener("change", () => {
      selectedRepresentativeId = nodes.repSelect.value;
      selectedOrderId = "";
      if (selectedRepresentativeId) selectRepresentative(selectedRepresentativeId, true);
      else {
        if (nodes.panel) nodes.panel.hidden = true;
        manualView = false;
        renderRepresentativeList();
        renderMarkers();
        fitMap(true);
      }
    });
    section.querySelectorAll("[data-live-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        manualView = false;
        renderMarkers();
        fitMap(true);
      });
    });
    nodes.repList?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-live-rep-id]");
      if (card) selectRepresentative(card.dataset.liveRepId, true);
    });
    nodes.panel?.addEventListener("click", async (event) => {
      const close = event.target.closest("[data-live-close]");
      if (close) {
        nodes.panel.hidden = true;
        selectedOrderId = "";
        return;
      }
      const orderButton = event.target.closest("[data-live-order]");
      if (orderButton) {
        selectOrder(selectedRepresentativeId, orderButton.dataset.liveOrder);
        return;
      }
      const stateButton = event.target.closest("[data-route-state]");
      if (stateButton) {
        try { await mutateOrderState(stateButton.dataset.routeState); }
        catch (error) { alert(error.message || "Order state could not be changed."); }
        return;
      }
      const openOrder = event.target.closest("[data-open-order]");
      if (openOrder) {
        document.querySelector('[data-target="orders"]')?.click();
        const search = document.querySelector('#orders .search-box input');
        if (search) {
          search.value = openOrder.dataset.openOrder || "";
          search.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      const move = event.target.closest("[data-route-move]");
      if (move) {
        const row = move.closest("[data-route-order]");
        const list = row?.parentElement;
        if (!row || !list) return;
        if (move.dataset.routeMove === "up" && row.previousElementSibling) {
          list.insertBefore(row, row.previousElementSibling);
        }
        if (move.dataset.routeMove === "down" && row.nextElementSibling) {
          list.insertBefore(row.nextElementSibling, row);
        }
        return;
      }
      const save = event.target.closest("[data-route-save]");
      if (save) {
        const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
        try { await saveRouteOrder(rep, routeOrderFromPanel()); }
        catch (error) { alert(error.message || "Route could not be saved."); }
        return;
      }
      const suggested = event.target.closest("[data-route-suggested]");
      if (suggested) {
        const rep = (snapshot.representatives || []).find((row) => String(row.id) === selectedRepresentativeId);
        if (!rep) return;
        const active = (rep.orders || [])
          .filter((order) => ["current","upcoming","waiting","problem"].includes(order.routeState))
          .sort((a,b) => Number(a.suggestedSequence || 9999) - Number(b.suggestedSequence || 9999))
          .map((order) => order.orderId);
        try { await saveRouteOrder(rep, active); }
        catch (error) { alert(error.message || "Suggested route could not be saved."); }
      }
    });
    nodes.fit?.addEventListener("click", () => {
      manualView = false;
      fitMap(true);
    });
    nodes.refresh?.addEventListener("click", () => void refresh({ force: true }));
    nodes.fullscreen?.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await section.requestFullscreen();
        else await document.exitFullscreen();
      } catch {}
    });
    document.addEventListener("fullscreenchange", () => setTimeout(() => map?.invalidateSize(), 80));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && activeSection()) void refresh({ force: true });
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest('[data-target="live-operations"]');
      if (link) setTimeout(() => {
        map?.invalidateSize();
        startPolling();
      }, 40);
    });
  }

  function applyAccess() {
    const links = document.querySelectorAll('[data-target="live-operations"]');
    const readable = canRead();
    links.forEach((link) => { link.hidden = !readable; });
    if (!readable) {
      section.setAttribute("aria-hidden", "true");
      return false;
    }
    section.removeAttribute("aria-hidden");
    return true;
  }

  function initialize() {
    bind();
    if (!applyAccess()) return;
    ensureMap();
    if (activeSection()) startPolling();
  }

  document.addEventListener("DOMContentLoaded", initialize);
  window.addEventListener("dart:admin-authenticated", () => {
    if (!applyAccess()) return;
    if (activeSection()) startPolling();
  });
})();
