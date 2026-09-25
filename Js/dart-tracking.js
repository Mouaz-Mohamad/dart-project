// DART CODE GUIDE | Js/dart-tracking.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-tracking.js
// Order/return tracking cards, maps, timelines, and live state.
// BEGIN MODULE

(function () {
  "use strict";

  const maps = new Map();
  const liveTrips = new Map();
  const LIVE_LOCATION_POLL_MS = 1000;
  const SNAPSHOT_REFRESH_MS = 3000;
  const ROAD_ROUTE_REFRESH_MS = 5000;
  let lastViewSignature = "";
  let lastLiveTripSignature = "";
  let liveRefreshBusy = false;
  let snapshotRefreshBusy = false;
  let liveTrackingUnsupported = false;
  const read = (key, fallback = []) => window.DartState?.read?.(key, fallback) ?? fallback;
  const money = (value) => `${Math.trunc(Number(value) || 0)} EGP`;
  const orderTotal = (order) => Number.isFinite(Number(order?.finalAmount))
    ? Math.max(0, Number(order.finalAmount))
    : Math.max(0, Number(order?.totalPrice || 0) - (Number(order?.orderLevelDiscountAmount) || Number(order?.totalPrice || 0) * Number(order?.discount || 0) / 100));

  function activeOrders() {
    return read("dart_orders", []).filter((order) => !order.isDeleted && !order.isArchived && !["Delivered", "Cancelled", "Refused"].includes(order.status));
  }

  function orderGroups(records) {
    return window.DartGroups?.groupOrders?.(records) || records.map((record) => ({ key: String(record.id), records: [record] }));
  }

  function currentOrders() {
    const orders = activeOrders();
    const requested = new URLSearchParams(location.search).get("order");
    const lastOrderId = sessionStorage.getItem("dart_last_order_id");
    const user = window.DartPlatform?.currentUser?.();
    let customerOrders = user?.customerId
      ? orders.filter((order) => String(order.clientId) === String(user.customerId))
      : [];
    if (requested) {
      const exact = orders.find((order) => String(order.orderId) === String(requested) || String(order.id) === String(requested));
      if (!exact) return [];
      const group = orderGroups(orders).find((entry) => entry.records.some((order) => order === exact));
      return group?.records || [exact];
    }
    if (user?.customerId) {
      return customerOrders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    if (lastOrderId) {
      const exact = orders.find((order) => String(order.orderId) === String(lastOrderId) || String(order.id) === String(lastOrderId));
      if (exact) {
        const group = orderGroups(orders).find((entry) => entry.records.includes(exact));
        return group?.records || [exact];
      }
    }
    return [];
  }

  function currentOrder() { return currentOrders()[0] || null; }

  function allTrackableReturns() {
    return read("dart_returns", []).filter(
      (record) => !record.isDeleted && !record.isArchived && record.isPostDeliveryReturn,
    );
  }

  function activeReturns() {
    return allTrackableReturns().filter(
      (record) => !["Completed", "Rejected"].includes(String(record.status || "")),
    );
  }

  function currentReturns() {
    const active = activeReturns();
    const all = allTrackableReturns();
    const requested = new URLSearchParams(location.search).get("return");
    const lastId = sessionStorage.getItem("dart_last_return_id");
    const records = requested || lastId ? all : active;
    const user = window.DartPlatform?.currentUser?.();
    if (requested) {
      const exact = records.find((record) => String(record.returnId) === String(requested) || String(record.id) === String(requested));
      if (!exact) return [];
      const group = (window.DartGroups?.groupReturns?.(records) || []).find((entry) => entry.records.includes(exact));
      return group?.records || [exact];
    }
    if (lastId) {
      const exact = all.find((record) => String(record.returnId) === String(lastId) || String(record.id) === String(lastId));
      if (exact) {
        const group = (window.DartGroups?.groupReturns?.(all) || []).find((entry) => entry.records.includes(exact));
        return group?.records || [exact];
      }
    }
    const own = user?.customerId
      ? active.filter((record) => String(record.clientId) === String(user.customerId))
      : [];
    return own.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function markerIcon(type) {
    const safeType = type === "courier" ? "courier" : "destination";
    const iconClass = safeType === "courier" ? "fa-motorcycle" : "fa-location-dot";
    return L.divIcon({
      className: "dart-route-pin",
      html: `<span class="${safeType}"><i class="fa-solid ${iconClass}"></i></span>`,
      iconSize: [42, 42],
      iconAnchor: [21, 40],
    });
  }

  function fullAddress(record) {
    return record.fullAddress || [record.building, record.street, record.area, record.governorate, record.country].filter(Boolean).join("، ");
  }

  function tripKey(kind, record) {
    const id = record?.id || (kind === "order" ? record?.orderId : record?.returnId);
    return `${kind}:${String(id || "")}`;
  }

  function hasCoordinate(value) {
    return Number.isFinite(Number(value)) && Number(value) !== 0;
  }

  function liveRecord(kind, record) {
    return liveTrips.get(tripKey(kind, record)) || null;
  }

  function activeTrackingRecord(records = []) {
    if (!records.length) return null;
    return records.find((record) => {
      const live = liveRecord("order", record);
      return Boolean(
        live?.deliveryStartedAt &&
        hasCoordinate(live?.courierLocation?.lat) &&
        hasCoordinate(live?.courierLocation?.lng)
      );
    }) || records.find((record) => String(record.status || "") === "Representative On The Way")
      || records.find((record) => Boolean(record.deliveryStartedAt))
      || records[0];
  }

  function clearAnimation(state) {
    if (state.animationFrame == null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.animationFrame);
    else clearTimeout(state.animationFrame);
    state.animationFrame = null;
  }

  function scheduleAnimation(callback) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return setTimeout(() => callback(Date.now()), 16);
  }

  function showResetControl(state, show) {
    if (state.resetButton) state.resetButton.hidden = !show;
  }

  function markManualView(state) {
    if (!state.courierPosition || state.programmaticViewChange) return;
    state.manualView = true;
    showResetControl(state, true);
  }

  function fitTrip(state, animate = true) {
    if (!state?.map || state.manualView) return;
    state.programmaticViewChange = true;
    if (state.courierPosition) {
      const samePoint =
        Math.abs(state.courierPosition.lat - state.destination.lat) < 0.00001 &&
        Math.abs(state.courierPosition.lng - state.destination.lng) < 0.00001;
      if (samePoint) {
        state.map.setView(
          [state.destination.lat, state.destination.lng],
          17,
          { animate },
        );
      } else {
        state.map.fitBounds(
          [
            [state.destination.lat, state.destination.lng],
            [state.courierPosition.lat, state.courierPosition.lng],
          ],
          {
            padding: [45, 45],
            maxZoom: 17,
            animate,
            duration: animate ? 0.55 : 0,
          },
        );
      }
    } else {
      state.map.setView([state.destination.lat, state.destination.lng], 15, { animate });
    }
    setTimeout(() => {
      state.programmaticViewChange = false;
    }, animate ? 650 : 0);
  }

  function addResetControl(state) {
    const control = L.control({ position: "topright" });
    control.onAdd = () => {
      const wrap = L.DomUtil.create("div", "dart-map-reset-control leaflet-bar");
      const button = L.DomUtil.create("button", "dart-map-reset", wrap);
      button.type = "button";
      button.hidden = true;
      button.textContent = "Reset view";
      button.title = "Show the customer and representative at the best zoom";
      button.setAttribute("aria-label", button.title);
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation?.(wrap);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.stop(event);
        state.manualView = false;
        showResetControl(state, false);
        fitTrip(state, true);
      });
      state.resetButton = button;
      return wrap;
    };
    control.addTo(state.map);
    state.resetControl = control;
  }

  function ensureCourierLayers(state, position) {
    if (!state.courierMarker) {
      state.courierMarker = L.marker([position.lat, position.lng], {
        icon: markerIcon("courier"),
      }).addTo(state.map).bindPopup("Dart representative");
    }
    if (!state.route) {
      state.route = L.polyline(
        [
          [state.destination.lat, state.destination.lng],
          [position.lat, position.lng],
        ],
        { color: "#8c1d2c", weight: 4, opacity: 0.82 },
      ).addTo(state.map);
    }
  }

  function removeCourierLayers(state) {
    clearAnimation(state);
    if (state.courierMarker) {
      state.map.removeLayer(state.courierMarker);
      state.courierMarker = null;
    }
    if (state.route) {
      state.map.removeLayer(state.route);
      state.route = null;
    }
    state.courierPosition = null;
    state.hasRoadRoute = false;
    state.lastRoadRouteAt = 0;
    state.roadRouteRequestId = Number(state.roadRouteRequestId || 0) + 1;
    state.manualView = false;
    showResetControl(state, false);
  }

  async function refreshRoadRoute(state, position, force = false) {
    if (!state?.route || state.kind !== "order" || !position) return;
    const now = Date.now();
    if (!force && now - Number(state.lastRoadRouteAt || 0) < ROAD_ROUTE_REFRESH_MS) return;
    state.lastRoadRouteAt = now;
    const requestId = Number(state.roadRouteRequestId || 0) + 1;
    state.roadRouteRequestId = requestId;
    const points = `${position.lng},${position.lat};${state.destination.lng},${state.destination.lat}`;
    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=false`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Routing provider unavailable");
      const payload = await response.json();
      const raw = payload.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(raw) || raw.length < 2 || state.roadRouteRequestId !== requestId) return;
      const geometry = raw.map(([lng, lat]) => [Number(lat), Number(lng)]);
      if (geometry.some(([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng))) return;
      state.hasRoadRoute = true;
      state.route.setLatLngs(geometry);
    } catch {
      if (state.roadRouteRequestId !== requestId) return;
      state.hasRoadRoute = false;
      state.route.setLatLngs([
        [position.lat, position.lng],
        [state.destination.lat, state.destination.lng],
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function animateCourier(state, nextPosition) {
    ensureCourierLayers(state, nextPosition);
    const currentLatLng = state.courierMarker.getLatLng();
    const from = {
      lat: Number(currentLatLng.lat),
      lng: Number(currentLatLng.lng),
    };
    const distance =
      Math.abs(from.lat - nextPosition.lat) + Math.abs(from.lng - nextPosition.lng);
    if (!Number.isFinite(distance) || distance < 0.000001) {
      state.courierMarker.setLatLng([nextPosition.lat, nextPosition.lng]);
      if (!state.hasRoadRoute) {
        state.route.setLatLngs([
          [nextPosition.lat, nextPosition.lng],
          [state.destination.lat, state.destination.lng],
        ]);
      }
      state.courierPosition = nextPosition;
      void refreshRoadRoute(state, nextPosition);
      if (!state.manualView) fitTrip(state, true);
      return;
    }

    clearAnimation(state);
    const startedAt = typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
    const duration = 850;

    const step = (timestamp) => {
      const nowValue = Number(timestamp) || Date.now();
      const progress = Math.min(1, Math.max(0, (nowValue - startedAt) / duration));
      const eased = 1 - ((1 - progress) ** 3);
      const position = {
        lat: from.lat + (nextPosition.lat - from.lat) * eased,
        lng: from.lng + (nextPosition.lng - from.lng) * eased,
      };
      state.courierMarker.setLatLng([position.lat, position.lng]);
      if (!state.hasRoadRoute) {
        state.route.setLatLngs([
          [position.lat, position.lng],
          [state.destination.lat, state.destination.lng],
        ]);
      }
      state.courierPosition = position;
      if (progress < 1) {
        state.animationFrame = scheduleAnimation(step);
        return;
      }
      state.animationFrame = null;
      state.courierPosition = nextPosition;
      void refreshRoadRoute(state, nextPosition);
      if (!state.manualView) fitTrip(state, true);
    };

    state.animationFrame = scheduleAnimation(step);
  }

  function updateMapState(state, record, live = null) {
    if (!state || !record) return;
    state.record = record;
    const courier = live?.courierLocation || record.courierLocation || null;
    const started = Boolean(
      live?.deliveryStartedAt ||
      live?.pickupStartedAt ||
      record.deliveryStartedAt ||
      record.pickupStartedAt ||
      live?.status === "Representative On The Way" ||
      live?.status === "Pickup On The Way" ||
      record.status === "Representative On The Way" ||
      record.status === "Pickup On The Way"
    );
    const hasRep = Boolean(record.representativeId || record.representativeBusinessId);
    const hasCourier =
      started &&
      hasCoordinate(courier?.lat) &&
      hasCoordinate(courier?.lng);

    if (hasCourier) {
      const nextPosition = {
        lat: Number(courier.lat),
        lng: Number(courier.lng),
      };
      state.shell?.classList.remove("is-disabled");
      if (state.overlay) state.overlay.hidden = true;
      if (state.summary) state.summary.textContent = "The representative location is updating live.";
      if (!state.courierPosition) {
        ensureCourierLayers(state, nextPosition);
        state.courierMarker.setLatLng([nextPosition.lat, nextPosition.lng]);
        state.route.setLatLngs([
          [nextPosition.lat, nextPosition.lng],
          [state.destination.lat, state.destination.lng],
        ]);
        state.courierPosition = nextPosition;
        void refreshRoadRoute(state, nextPosition, true);
        fitTrip(state, false);
      } else {
        animateCourier(state, nextPosition);
      }
      return;
    }

    if (state.courierMarker || state.route) removeCourierLayers(state);
    // A saved destination is useful before GPS arrives: keep the actual map and
    // destination pin visible and only dim it while waiting for the courier.
    state.shell?.classList.remove("is-disabled");
    if (state.overlay) {
      state.overlay.hidden = false;
      state.overlay.textContent = started
        ? "Waiting for representative location"
        : hasRep
          ? "Waiting for the representative to start delivery"
          : "Waiting for representative assignment";
    }
    if (state.summary) {
      state.summary.textContent = `Saved destination: ${fullAddress(record) || "-"}`;
    }
  }

  function createMap(container, record, shell, overlay, summary, kind) {
    const destination = {
      lat: Number(record.latitude),
      lng: Number(record.longitude),
    };
    const hasDestination =
      hasCoordinate(destination.lat) &&
      hasCoordinate(destination.lng);

    if (!container || typeof L === "undefined" || !hasDestination) {
      shell?.classList.add("is-disabled");
      if (overlay) {
        overlay.hidden = false;
        overlay.textContent = hasDestination
          ? "Map unavailable"
          : "Saved coordinates are unavailable";
      }
      if (summary) summary.textContent = fullAddress(record) || "Address unavailable";
      return;
    }

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
    }).setView([destination.lat, destination.lng], 15);
    map.attributionControl?.setPrefix(false);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd", attribution: "&copy; OpenStreetMap contributors &copy; CARTO" },
    ).addTo(map);

    const state = {
      kind,
      entityKey: tripKey(kind, record),
      record,
      map,
      container,
      shell,
      overlay,
      summary,
      destination,
      destinationMarker: L.marker(
        [destination.lat, destination.lng],
        { icon: markerIcon("destination") },
      ).addTo(map).bindPopup(
        kind === "return" ? "Saved pickup location" : "Saved delivery location",
      ),
      courierMarker: null,
      route: null,
      courierPosition: null,
      animationFrame: null,
      hasRoadRoute: false,
      lastRoadRouteAt: 0,
      roadRouteRequestId: 0,
      manualView: false,
      programmaticViewChange: false,
      resetControl: null,
      resetButton: null,
    };

    maps.set(container, state);
    addResetControl(state);
    map.on("dragstart", () => markManualView(state));
    map.on("zoomstart", () => {
      if (!state.programmaticViewChange) markManualView(state);
    });
    updateMapState(state, record, liveRecord(kind, record));
    setTimeout(() => map.invalidateSize(), 60);
  }

  function disposeMaps() {
    for (const state of maps.values()) {
      clearAnimation(state);
      try { state.map.remove(); } catch {}
    }
    maps.clear();
  }

  function recordForMapState(state) {
    const records = state.kind === "order" ? currentOrders() : currentReturns();
    return records.find((record) => tripKey(state.kind, record) === state.entityKey) || state.record;
  }

  function updateLiveMaps() {
    for (const state of maps.values()) {
      const record = recordForMapState(state);
      updateMapState(state, record, liveTrips.get(state.entityKey) || null);
    }
  }

  function stableTrackingRecord(record) {
    const {
      courierLocation: _courierLocation,
      updatedAt: _updatedAt,
      ...stable
    } = record || {};
    return stable;
  }

  function trackingStructureSignature() {
    return JSON.stringify({
      orders: currentOrders().map(stableTrackingRecord),
      returns: currentReturns().map(stableTrackingRecord),
    });
  }

  function syncTrackingView() {
    const signature = trackingStructureSignature();
    if (!lastViewSignature || signature !== lastViewSignature) {
      render();
      return;
    }
    updateLiveMaps();
  }

  function statusIndex(order) {
    return ({ New: 0, Accepted: 0, Preparing: 1, "Out With Representative": 2, "Representative On The Way": 3, Delivered: 4 })[order.status] ?? 0;
  }

  function templateFragment(id) {
    return document.getElementById(id)?.content?.cloneNode(true) || null;
  }

  function appendDivider(container) {
    const divider = templateFragment("tracking-unit-divider-template");
    if (divider) container.appendChild(divider);
  }

  function appendOrderLine(container, description, amount) {
    const fragment = templateFragment("order-tracking-line-template");
    if (!fragment) return;
    fragment.querySelector('[data-order-line-field="description"]').textContent = description;
    fragment.querySelector('[data-order-line-field="amount"]').textContent = amount;
    container.appendChild(fragment);
  }

  function renderOrderUnit(order) {
    const fragment = templateFragment("order-tracking-unit-template");
    if (!fragment) return null;
    const unit = fragment.querySelector("[data-order-unit]");
    unit.querySelector('[data-order-unit-field="id"]').textContent = `Order #${order.orderId || "-"}`;
    unit.querySelector('[data-order-unit-field="status"]').textContent = order.status || "New";
    unit.querySelector('[data-order-unit-field="date"]').textContent = `${order.date || "-"} ${order.time || ""}`.trim();
    unit.querySelector('[data-order-unit-field="total"]').textContent = money(orderTotal(order));
    const lines = unit.querySelector("[data-order-unit-lines]");
    if (!(order.priceSnapshot || []).length) appendOrderLine(lines, "Item details are being prepared.", "—");
    (order.priceSnapshot || []).forEach((line) => {
      const quantity = Number(line.qty) || 1;
      appendOrderLine(
        lines,
        `${quantity}× ${line.name || line.modelCode || "Item"} · ${line.size || "-"} · ${line.color || "-"}`,
        money((Number(line.finalUnitPrice) || 0) * quantity),
      );
    });
    return fragment;
  }

  function renderOrders() {
    const list = document.getElementById("orderTrackingList"), template = document.getElementById("order-tracking-card-template");
    if (!list || !template) return;
    list.replaceChildren();
    const groups = orderGroups(currentOrders());
    if (!groups.length) {
      const empty = templateFragment("order-tracking-empty-template");
      if (empty) list.appendChild(empty);
      return;
    }
    groups.forEach((group) => {
      const fragment = template.content.cloneNode(true), card = fragment.querySelector("[data-order-tracking-card]"), records = group.records;
      const first = records[0], trackingRecord = activeTrackingRecord(records) || first, minimum = Math.min(...records.map(statusIndex));
      card.querySelector('[data-order-field="id"]').textContent = records.length > 1 ? `${records.length} orders in one delivery group` : `Order ID: #${first.orderId}`;
      card.querySelector('[data-order-field="date"]').textContent = records.length > 1 ? "Same customer, country, governorate, area and street" : `Date: ${first.date || "-"} ${first.time || ""}`;
      const items = card.querySelector("[data-order-items]");
      records.forEach((record, index) => {
        if (index) appendDivider(items);
        const unit = renderOrderUnit(record);
        if (unit) items.appendChild(unit);
      });
      card.querySelectorAll("[data-order-step]").forEach((step, index) => {
        step.classList.toggle("active", index <= minimum);
        step.querySelector(".circle").textContent = index < minimum ? "✓" : String(index + 1);
      });
      card.querySelector("[data-order-progress]").style.width = `${minimum * 25}%`;
      const representatives = new Set(records.map((record) => record.representativeId).filter(Boolean));
      const assigned = representatives.size === 1;
      card.querySelector('[data-order-field="representative"]').textContent = assigned ? trackingRecord.representativeName || first.representativeName || "Dart representative" : "Representative not assigned yet";
      card.querySelector('[data-order-field="representativeMeta"]').textContent = assigned ? `Courier ID: ${trackingRecord.representativeBusinessId || trackingRecord.representativeId || first.representativeBusinessId || first.representativeId}` : "Waiting for assignment";
      const call = card.querySelector("[data-order-call]"); call.hidden = !assigned || !(trackingRecord.representativePhone || first.representativePhone); call.href = call.hidden ? "#" : `tel:${trackingRecord.representativePhone || first.representativePhone}`;
      card.querySelector("[data-order-eta]").textContent = (liveRecord("order", trackingRecord)?.deliveryStartedAt || trackingRecord.deliveryStartedAt) ? "Live trip" : "ETA: Not determined";
      list.appendChild(fragment);
      const inserted = list.lastElementChild;
      createMap(inserted.querySelector("[data-order-map]"), trackingRecord, inserted.querySelector("[data-order-map-shell]"), inserted.querySelector("[data-order-map-disabled]"), inserted.querySelector("[data-order-map-summary]"), "order");
    });
  }

  function publicReturnState(record) {
    const value = window.DartReturns?.publicStatus(record) || "Under Review";
    if (value === "Rejected") return { label: "مرفوض", index: 1, rejected: true };
    if (value === "Return Received") return { label: "تم استلام المرتجع", index: 3, rejected: false };
    if (value === "Representative On The Way")
      return { label: "المندوب في الطريق", index: 2, rejected: false };
    if (value === "Approved") return { label: "تم قبول الطلب", index: 1, rejected: false };
    return { label: "جاري المراجعة", index: 0, rejected: false };
  }

  function renderReturnUnit(record) {
    const state = publicReturnState(record), exchange = window.DartReturns?.isExchange(record) || record.requestType === "Exchange";
    const fee = Number(record.customerCourierFee) || 0;
    const fragment = templateFragment("return-tracking-unit-template");
    if (!fragment) return null;
    const unit = fragment.querySelector("[data-return-unit]");
    const status = unit.querySelector('[data-return-unit-field="status"]');
    unit.querySelector('[data-return-unit-field="id"]').textContent = record.returnId || record.id || "-";
    status.textContent = state.label;
    status.classList.toggle("is-rejected", state.rejected);
    unit.querySelector('[data-return-unit-field="type"]').textContent = exchange ? "استبدال" : "استرجاع";
    unit.querySelector('[data-return-unit-field="originalItem"]').textContent = record.itemCode || "-";
    const replacementRow = unit.querySelector("[data-return-unit-replacement]");
    replacementRow.hidden = !exchange;
    unit.querySelector('[data-return-unit-field="replacementItem"]').textContent = record.replacementItemCode || `${record.requestedColor || "-"} / ${record.requestedSize || "-"}`;
    unit.querySelector('[data-return-unit-field="netAmount"]').textContent = money(record.originalNetAmount || 0);
    unit.querySelector('[data-return-unit-field="courierFee"]').textContent = fee ? money(fee) : "لا توجد";
    const rejectionRow = unit.querySelector("[data-return-unit-rejection]");
    rejectionRow.hidden = !state.rejected;
    unit.querySelector('[data-return-unit-field="rejectionReason"]').textContent = record.rejectionReason || "-";
    return fragment;
  }

  function renderReturns() {
    const list = document.getElementById("returnTrackingList"), template = document.getElementById("return-tracking-card-template");
    if (!list || !template) return;
    list.replaceChildren();
    const records = currentReturns(), groups = window.DartGroups?.groupReturns?.(records) || records.map((record) => ({ records: [record] }));
    if (!groups.length) {
      const empty = templateFragment("return-tracking-empty-template");
      if (empty) list.appendChild(empty);
      return;
    }
    groups.forEach((group) => {
      const fragment = template.content.cloneNode(true), card = fragment.querySelector("[data-return-tracking-card]"), rows = group.records, first = rows[0];
      const states = rows.map(publicReturnState), minimum = Math.min(...states.map((state) => state.index));
      card.querySelector('[data-return-field="id"]').textContent = rows.length > 1 ? `${rows.length} طلبات في مشوار استلام واحد` : `رقم الطلب: ${first.returnId || first.id}`;
      card.querySelector('[data-return-field="date"]').textContent = rows.length > 1 ? "كل طلب وقطعة مستقلان" : `التاريخ: ${first.date || "-"}`;
      card.querySelector('[data-return-field="status"]').textContent = rows.length > 1 ? "مجموعة استلام" : states[0].label;
      const details = card.querySelector("[data-return-items]");
      rows.forEach((record, index) => {
        if (index) appendDivider(details);
        const unit = renderReturnUnit(record);
        if (unit) details.appendChild(unit);
      });
      card.querySelectorAll("[data-return-step]").forEach((step, index) => { step.classList.toggle("active", index <= minimum); step.querySelector(".circle").textContent = index < minimum ? "✓" : String(index + 1); });
      card.querySelector("[data-return-progress]").style.width = `${minimum * (100 / 3)}%`;
      card.querySelector('[data-return-field="representative"]').textContent = first.representativeName || "لم يتم تعيين مندوب بعد";
      card.querySelector('[data-return-field="representativeMeta"]').textContent = first.representativeBusinessId ? `رقم المندوب: ${first.representativeBusinessId}` : "بانتظار الموافقة والتعيين";
      const call = card.querySelector("[data-return-call]"); call.hidden = !first.representativePhone; call.href = call.hidden ? "#" : `tel:${first.representativePhone}`;
      list.appendChild(fragment);
      const inserted = list.lastElementChild;
      createMap(inserted.querySelector("[data-return-map]"), first, inserted.querySelector("[data-return-map-shell]"), inserted.querySelector("[data-return-map-disabled]"), inserted.querySelector("[data-return-map-summary]"), "return");
    });
  }

  function render() {
    disposeMaps();
    renderOrders();
    renderReturns();
    lastViewSignature = trackingStructureSignature();
    updateLiveMaps();
  }

  async function refreshServerTracking() {
    if (document.hidden || snapshotRefreshBusy) return;
    if (!window.DartPlatform?.currentUser?.() || !window.DartPlatform?.hydrateCustomerCommerce) {
      syncTrackingView();
      return;
    }
    snapshotRefreshBusy = true;
    try {
      await window.DartPlatform.hydrateCustomerCommerce();
    } catch (error) {
      if (error.status !== 401) console.warn("Dart tracking refresh failed", error);
    } finally {
      snapshotRefreshBusy = false;
    }
    syncTrackingView();
  }

  async function refreshLiveTracking() {
    if (
      document.hidden ||
      liveRefreshBusy ||
      liveTrackingUnsupported ||
      !window.DartPlatform?.currentUser?.() ||
      !window.DartApi?.request
    ) return;

    liveRefreshBusy = true;
    try {
      const payload = await window.DartApi.request("/api/v1/me/tracking/live");
      const next = new Map();
      const signatureRows = [];

      for (const row of payload?.orders || []) {
        const key = tripKey("order", row);
        next.set(key, row);
        signatureRows.push([
          key,
          row.status || "",
          row.deliveryStartedAt || "",
          Boolean(row.courierLocation),
        ]);
      }
      for (const row of payload?.returns || []) {
        const key = tripKey("return", row);
        next.set(key, row);
        signatureRows.push([
          key,
          row.status || "",
          row.pickupStartedAt || "",
          Boolean(row.courierLocation),
        ]);
      }

      liveTrips.clear();
      for (const [key, value] of next) liveTrips.set(key, value);
      updateLiveMaps();

      const liveSignature = JSON.stringify(signatureRows.sort((a, b) =>
        String(a[0]).localeCompare(String(b[0]))
      ));
      if (lastLiveTripSignature && liveSignature !== lastLiveTripSignature) {
        void refreshServerTracking();
      }
      lastLiveTripSignature = liveSignature;
    } catch (error) {
      if (error.status === 404) {
        liveTrackingUnsupported = true;
      } else if (error.status !== 401) {
        console.warn("Dart live tracking refresh failed", error);
      }
    } finally {
      liveRefreshBusy = false;
    }
  }

  window.DartTracking = {
    render,
    refreshServerTracking,
    refreshLiveTracking,
    currentOrder,
    currentOrders,
    currentReturns,
    renderReturns,
    orderGroups,
  };

  document.addEventListener("DOMContentLoaded", () => {
    render();
    void refreshServerTracking();
    void refreshLiveTracking();
  });
  window.addEventListener("storage", (event) => {
    if (["dart_orders", "dart_returns"].includes(event.key)) syncTrackingView();
  });
  window.addEventListener("dart:data-changed", (event) => {
    if (["dart_orders", "dart_returns"].includes(event.detail?.key)) syncTrackingView();
  });
  window.addEventListener("focus", () => {
    void refreshServerTracking();
    void refreshLiveTracking();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshServerTracking();
      void refreshLiveTracking();
    }
  });
  setInterval(() => void refreshLiveTracking(), LIVE_LOCATION_POLL_MS);
  setInterval(() => void refreshServerTracking(), SNAPSHOT_REFRESH_MS);

})();


// END MODULE
