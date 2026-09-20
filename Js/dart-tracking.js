(function () {
  "use strict";

  const maps = new Map();
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

  function activeReturns() {
    return read("dart_returns", []).filter((record) => !record.isDeleted && !record.isArchived && record.isPostDeliveryReturn && record.status !== "Completed");
  }

  function currentReturns() {
    const records = activeReturns();
    const requested = new URLSearchParams(location.search).get("return");
    const lastId = sessionStorage.getItem("dart_last_return_id");
    const user = window.DartPlatform?.currentUser?.();
    if (requested) {
      const exact = records.find((record) => String(record.returnId) === String(requested) || String(record.id) === String(requested));
      if (!exact) return [];
      const group = (window.DartGroups?.groupReturns?.(records) || []).find((entry) => entry.records.includes(exact));
      return group?.records || [exact];
    }
    const own = user?.customerId ? records.filter((record) => String(record.clientId) === String(user.customerId)) : [];
    if (own.length) return own.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (lastId) {
      const exact = records.find((record) => String(record.returnId) === String(lastId) || String(record.id) === String(lastId));
      return exact ? [exact] : [];
    }
    return [];
  }

  function markerIcon(type) {
    const safeType = type === "courier" ? "courier" : "customer";
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

  function createMap(container, record, shell, overlay, summary) {
    const destination = { lat: Number(record.latitude), lng: Number(record.longitude) };
    const courier = { lat: Number(record.courierLocation?.lat), lng: Number(record.courierLocation?.lng) };
    const hasDestination = Number.isFinite(destination.lat) && Number.isFinite(destination.lng) && destination.lat && destination.lng;
    if (!container || typeof L === "undefined" || !hasDestination) {
      shell?.classList.add("is-disabled");
      if (overlay) { overlay.hidden = false; overlay.textContent = hasDestination ? "Map unavailable" : "Saved coordinates are unavailable"; }
      if (summary) summary.textContent = fullAddress(record) || "Address unavailable";
      return;
    }
    const map = L.map(container, { zoomControl: false, attributionControl: false }).setView([destination.lat, destination.lng], 15);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd" }).addTo(map);
    L.marker([destination.lat, destination.lng], { icon: markerIcon("destination") }).addTo(map).bindPopup("Saved destination");
    maps.set(container, map);
    const started = Boolean(record.deliveryStartedAt || record.pickupStartedAt);
    const hasRep = Boolean(record.representativeId || record.representativeBusinessId);
    const hasCourier = Number.isFinite(courier.lat) && Number.isFinite(courier.lng) && courier.lat && courier.lng;
    if (started && hasCourier) {
      L.marker([courier.lat, courier.lng], { icon: markerIcon("courier") }).addTo(map).bindPopup("Dart representative");
      L.polyline([[destination.lat, destination.lng], [courier.lat, courier.lng]], { color: "#2563eb", weight: 4, opacity: .82 }).addTo(map);
      map.fitBounds([[destination.lat, destination.lng], [courier.lat, courier.lng]], { padding: [45, 45], maxZoom: 16 });
      shell?.classList.remove("is-disabled");
      if (overlay) overlay.hidden = true;
      if (summary) summary.textContent = "The representative location is updating automatically.";
    } else {
      shell?.classList.add("is-disabled");
      if (overlay) { overlay.hidden = false; overlay.textContent = hasRep ? "Waiting for the representative to start" : "Waiting for representative assignment"; }
      if (summary) summary.textContent = `Saved destination: ${fullAddress(record) || "-"}`;
    }
    setTimeout(() => map.invalidateSize(), 60);
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
    maps.forEach((map) => { try { map.remove(); } catch {} }); maps.clear(); list.replaceChildren();
    const groups = orderGroups(currentOrders());
    if (!groups.length) {
      const empty = templateFragment("order-tracking-empty-template");
      if (empty) list.appendChild(empty);
      return;
    }
    groups.forEach((group) => {
      const fragment = template.content.cloneNode(true), card = fragment.querySelector("[data-order-tracking-card]"), records = group.records;
      const first = records[0], minimum = Math.min(...records.map(statusIndex));
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
      card.querySelector('[data-order-field="representative"]').textContent = assigned ? first.representativeName || "Dart representative" : "Representative not assigned yet";
      card.querySelector('[data-order-field="representativeMeta"]').textContent = assigned ? `Courier ID: ${first.representativeBusinessId || first.representativeId}` : "Waiting for assignment";
      const call = card.querySelector("[data-order-call]"); call.hidden = !assigned || !first.representativePhone; call.href = call.hidden ? "#" : `tel:${first.representativePhone}`;
      card.querySelector("[data-order-eta]").textContent = first.deliveryStartedAt ? "Live trip" : "ETA: Not determined";
      list.appendChild(fragment);
      const inserted = list.lastElementChild;
      createMap(inserted.querySelector("[data-order-map]"), first, inserted.querySelector("[data-order-map-shell]"), inserted.querySelector("[data-order-map-disabled]"), inserted.querySelector("[data-order-map-summary]"));
    });
  }

  function publicReturnState(record) {
    const value = window.DartReturns?.publicStatus(record) || "Under Review";
    if (value === "Rejected") return { label: "مرفوض", index: 1, rejected: true };
    if (value === "Approved") return { label: "تمت الموافقة", index: 1, rejected: false };
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
      card.querySelector("[data-return-progress]").style.width = `${minimum * 50}%`;
      card.querySelector('[data-return-field="representative"]').textContent = first.representativeName || "لم يتم تعيين مندوب بعد";
      card.querySelector('[data-return-field="representativeMeta"]').textContent = first.representativeBusinessId ? `رقم المندوب: ${first.representativeBusinessId}` : "بانتظار الموافقة والتعيين";
      const call = card.querySelector("[data-return-call]"); call.hidden = !first.representativePhone; call.href = call.hidden ? "#" : `tel:${first.representativePhone}`;
      list.appendChild(fragment);
      const inserted = list.lastElementChild;
      createMap(inserted.querySelector("[data-return-map]"), first, inserted.querySelector("[data-return-map-shell]"), inserted.querySelector("[data-return-map-disabled]"), inserted.querySelector("[data-return-map-summary]"));
    });
  }

  function render() { renderOrders(); renderReturns(); }

  async function refreshServerTracking() {
    if (document.hidden) return;
    if (window.DartPlatform?.currentUser?.() && window.DartPlatform?.hydrateCustomerCommerce) {
      try {
        await window.DartPlatform.hydrateCustomerCommerce();
      } catch (error) {
        if (error.status !== 401) console.warn("Dart tracking refresh failed", error);
      }
    }
    render();
  }

  window.DartTracking = {
    render,
    refreshServerTracking,
    currentOrder,
    currentOrders,
    currentReturns,
    renderReturns,
    orderGroups,
  };
  document.addEventListener("DOMContentLoaded", () => {
    render();
    void refreshServerTracking();
  });
  window.addEventListener("storage", (event) => {
    if (["dart_orders", "dart_returns"].includes(event.key)) render();
  });
  window.addEventListener("dart:data-changed", (event) => {
    if (["dart_orders", "dart_returns"].includes(event.detail?.key)) render();
  });
  window.addEventListener("focus", () => void refreshServerTracking());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshServerTracking();
  });
  setInterval(() => void refreshServerTracking(), 3000);
})();
