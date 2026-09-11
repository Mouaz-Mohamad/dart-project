(function () {
  "use strict";

  let map = null;
  let destinationMarker = null;
  let courierMarker = null;
  let routeLine = null;
  let lastRouteKey = "";

  const read = (key, fallback = []) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const money = (value) => `${Math.trunc(Number(value) || 0)} EGP`;
  const orderTotal = (order) =>
    Number.isFinite(Number(order?.finalAmount))
      ? Math.max(0, Number(order.finalAmount))
      : Math.max(
          0,
          Number(order?.totalPrice || 0) -
            (Number(order?.orderLevelDiscountAmount) ||
              (Number(order?.totalPrice || 0) * Number(order?.discount || 0)) /
                100),
        );

  function currentOrder() {
    const orders = read("dart_orders", []).filter(
      (order) => !order.isDeleted && order.status !== "Delivered",
    );
    const requested = new URLSearchParams(location.search).get("order");
    if (requested) {
      const exact = orders.find(
        (order) =>
          String(order.orderId) === String(requested) ||
          String(order.id) === String(requested),
      );
      return exact || null;
    }

    const lastOrderId = sessionStorage.getItem("dart_last_order_id");
    if (lastOrderId) {
      const last = orders.find(
        (order) =>
          String(order.orderId) === String(lastOrderId) ||
          String(order.id) === String(lastOrderId),
      );
      if (last) return last;
    }

    const user = window.DartPlatform?.currentUser?.();
    if (!user?.customerId) return null;
    return (
      orders
        .filter((order) => String(order.clientId) === String(user.customerId))
        .sort(
          (first, second) =>
            new Date(second.createdAt || 0) - new Date(first.createdAt || 0),
        )[0] || null
    );
  }

  function markerIcon(type) {
    const icon = type === "courier" ? "fa-motorcycle" : "fa-location-dot";
    return L.divIcon({
      className: "dart-route-pin",
      html: `<span class="${type}"><i class="fa-solid ${icon}"></i></span>`,
      iconSize: [42, 42],
      iconAnchor: [21, 40],
    });
  }

  function setMapDisabled(disabled, message = "") {
    const shell = document.getElementById("trackingMapShell");
    const overlay = document.getElementById("trackingMapDisabled");
    shell?.classList.toggle("is-disabled", disabled);
    if (overlay) {
      overlay.hidden = !disabled;
      if (message) overlay.textContent = message;
    }
  }

  function setSummary(message) {
    const summary = document.getElementById("trackingMapSummary");
    if (summary) summary.textContent = message;
  }

  function setEta(message) {
    const eta = document.getElementById("etaTime");
    if (eta) eta.textContent = message;
  }

  function ensureMap() {
    if (
      map ||
      typeof L === "undefined" ||
      !document.getElementById("tracking-map")
    )
      return map;
    map = L.map("tracking-map", {
      zoomControl: false,
      attributionControl: false,
    }).setView([30.0444, 31.2357], 12);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd" },
    ).addTo(map);
    window.trackingMap = map;
    return map;
  }

  function clearMovingRoute() {
    if (!map) return;
    if (courierMarker) {
      map.removeLayer(courierMarker);
      courierMarker = null;
    }
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    lastRouteKey = "";
  }

  async function updateRoute(order, courier, destination) {
    const key = `${courier.lat.toFixed(4)},${courier.lng.toFixed(4)}:${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
    if (key === lastRouteKey) return;
    lastRouteKey = key;
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${courier.lng},${courier.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`,
      );
      const data = await response.json();
      const route = data.routes?.[0];
      if (!route) throw new Error("No route");
      const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      if (routeLine) routeLine.setLatLngs(points);
      else
        routeLine = L.polyline(points, {
          color: "#2563eb",
          weight: 5,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
      const minutes = Math.max(1, Math.round(route.duration / 60));
      const distance = (route.distance / 1000).toFixed(1);
      setSummary(`Representative is approximately ${distance} km away.`);
      setEta(`ETA: ${minutes} mins`);
    } catch {
      lastRouteKey = "";
      setSummary(
        "The live location is visible, but route time is temporarily unavailable.",
      );
      setEta("ETA: Updating");
    }
  }

  function updateMap(order) {
    const hasRepresentative = Boolean(
      order.representativeId || order.representativeBusinessId,
    );
    const currentMap = ensureMap();
    if (!currentMap) {
      setSummary("The map service could not be loaded.");
      setEta("ETA: Not determined");
      return;
    }

    const destination = {
      lat: Number(order.latitude),
      lng: Number(order.longitude),
    };
    const courier = {
      lat: Number(order.courierLocation?.lat),
      lng: Number(order.courierLocation?.lng),
    };
    const hasDestination =
      Number.isFinite(destination.lat) &&
      Number.isFinite(destination.lng) &&
      destination.lat &&
      destination.lng;
    const hasCourier =
      Number.isFinite(courier.lat) &&
      Number.isFinite(courier.lng) &&
      courier.lat &&
      courier.lng;
    const deliveryStarted = Boolean(order.deliveryStartedAt);

    if (!hasDestination) {
      setMapDisabled(true, "Delivery location is not available");
      setSummary("This order has no saved delivery coordinates.");
      setEta("ETA: Not determined");
      clearMovingRoute();
      return;
    }

    if (destinationMarker)
      destinationMarker.setLatLng([destination.lat, destination.lng]);
    else
      destinationMarker = L.marker([destination.lat, destination.lng], {
        icon: markerIcon("destination"),
      })
        .addTo(currentMap)
        .bindPopup("Your delivery address");

    // BEGIN Waiting map — show the real destination under a 20% black layer.
    if (!hasRepresentative || !deliveryStarted) {
      clearMovingRoute();
      currentMap.setView([destination.lat, destination.lng], 15);
      setMapDisabled(
        true,
        hasRepresentative
          ? "Waiting for the representative to start this delivery"
          : "Representative not assigned yet",
      );
      setSummary(
        hasRepresentative
          ? "Delivery address is fixed. The live route starts when the representative presses Start Delivery."
          : "Delivery address is fixed. Waiting for a representative assignment.",
      );
      setEta("ETA: Not determined");
      setTimeout(() => currentMap.invalidateSize(), 60);
      return;
    }
    // END Waiting map.

    setMapDisabled(false);

    if (hasCourier) {
      if (courierMarker) courierMarker.setLatLng([courier.lat, courier.lng]);
      else
        courierMarker = L.marker([courier.lat, courier.lng], {
          icon: markerIcon("courier"),
        })
          .addTo(currentMap)
          .bindPopup("Dart representative");
      currentMap.fitBounds(
        [
          [destination.lat, destination.lng],
          [courier.lat, courier.lng],
        ],
        { padding: [55, 55], maxZoom: 16 },
      );
      if (order.status === "Delivered") {
        setSummary("This order has been delivered.");
        setEta("Delivered");
      } else {
        const age =
          Date.now() - Date.parse(order.courierLocation?.updatedAt || 0);
        if (age > 120000) {
          setSummary("Waiting for a fresh representative location update…");
          setEta("ETA: Updating");
        } else {
          updateRoute(order, courier, destination);
        }
      }
    } else {
      clearMovingRoute();
      currentMap.setView([destination.lat, destination.lng], 15);
      setSummary(
        "Delivery has started. Waiting for the first representative location update…",
      );
      setEta("ETA: Updating");
    }
    setTimeout(() => currentMap.invalidateSize(), 60);
  }

  function renderProgress(order) {
    const statusIndex = {
      New: 0,
      Accepted: 0,
      Preparing: 1,
      "Out With Representative": 2,
      "Representative On The Way": 3,
      Delivered: 4,
    };
    const index = statusIndex[order.status] ?? 0;
    const steps = document.querySelectorAll(".tracking-card .step");
    steps.forEach((step, stepIndex) => {
      step.classList.toggle("active", stepIndex <= index);
      const circle = step.querySelector(".circle");
      if (circle)
        circle.textContent = stepIndex < index ? "✓" : String(stepIndex + 1);
    });
    const progress = document.querySelector(".tracking-card .stepper-progress");
    if (progress) progress.style.width = `${Math.min(100, index * 25)}%`;
    if (["Refused", "Cancelled"].includes(order.status)) setEta(order.status);
  }

  function renderEmpty() {
    const card = document.querySelector(".tracking-card");
    if (!card) return;
    setMapDisabled(true, "No order selected");
    setSummary("Open the tracking link from your order or place a new order.");
    setEta("ETA: Not determined");
    const orderId = card.querySelector(".order-id");
    if (orderId) orderId.textContent = "No active order";
    const date = card.querySelector(".order-header div div:nth-child(2)");
    if (date) date.textContent = "Order details will appear here.";
    const items = card.querySelector(".items-box");
    if (items)
      items.innerHTML =
        '<div class="empty-state">No active order matches this tracking link. Delivered orders are removed from tracking.</div>';
    const driver = card.querySelector(".driver-box");
    if (driver)
      driver.innerHTML =
        "<div data-representative-empty>Representative not assigned yet</div>";
    document
      .querySelectorAll(".tracking-card .step")
      .forEach((step) => step.classList.remove("active"));
    const progress = card.querySelector(".stepper-progress");
    if (progress) progress.style.width = "0%";
  }

  function render() {
    const card = document.querySelector(".tracking-card");
    if (!card) return;
    const order = currentOrder();
    if (!order) {
      renderEmpty();
      return;
    }

    const orderId = card.querySelector(".order-id");
    if (orderId) orderId.textContent = `Order ID: #${order.orderId}`;
    const date = card.querySelector(".order-header div div:nth-child(2)");
    if (date)
      date.textContent = `Date: ${order.date || "-"} ${order.time || ""}`;

    const items = card.querySelector(".items-box");
    if (items) {
      items.innerHTML = `<div class="items-title">Order Items:</div>${(order.priceSnapshot || []).map((line) => `<div class="item-row"><span>${Number(line.qty) || 1}× ${esc(line.name || line.modelCode || "Item")} · ${esc(line.size || "-")} · ${esc(line.color || "-")}</span><strong>${esc(money((Number(line.finalUnitPrice) || 0) * (Number(line.qty) || 1)))}</strong></div>`).join("") || '<div class="item-row"><span>Item details are being prepared.</span><strong>—</strong></div>'}<hr><div class="item-row tracking-final-row"><span>Total:</span><strong>${esc(money(orderTotal(order)))}</strong></div>`;
    }

    renderProgress(order);
    const representativeAssigned = Boolean(
      order.representativeId || order.representativeBusinessId,
    );
    const driverName = card.querySelector(".driver-box div div:first-child");
    const driverMeta = card.querySelector(".driver-box div div:nth-child(2)");
    if (driverName)
      driverName.textContent = representativeAssigned
        ? order.representativeName || "Dart representative"
        : "Representative not assigned yet";
    if (driverMeta)
      driverMeta.textContent = representativeAssigned
        ? `Courier (ID: ${order.representativeBusinessId || order.representativeId})`
        : "Waiting for assignment";
    const call = card.querySelector(".btn-call");
    if (call) {
      const visible =
        representativeAssigned && Boolean(order.representativePhone);
      call.hidden = !visible;
      call.href = visible ? `tel:${order.representativePhone}` : "#";
    }

    updateMap(order);
  }

  window.DartTracking = { render, currentOrder };

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector(".tracking-card")) return;
    // A platform DOMContentLoaded handler may already have delegated the first render
    // to this module. Remove only a foreign legacy map, never this module's own map.
    if (window.trackingMap && window.trackingMap !== map) {
      try {
        window.trackingMap.remove();
      } catch {}
      window.trackingMap = null;
    }
    render();
    setInterval(() => {
      if (!document.hidden) render();
    }, 4000);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === "dart_orders") render();
  });
})();
