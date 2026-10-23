  function prefillCheckout() {
    const form = document.getElementById("checkoutForm"),
      user = currentUser();
    if (!form || !user) return;
    const values = {
      customer_name: user.name,
      phone1: displayPhone(user.phone1),
      phone2: displayPhone(user.phone2),
      email: user.email,
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (field && !field.value) field.value = value;
    });
  }

  function renderTracking() {
    if (window.DartTracking?.render) {
      window.DartTracking.render();
      return;
    }
    const card = document.querySelector(".tracking-card");
    if (!card) return;
    const params = new URLSearchParams(location.search),
      id = params.get("order"),
      orders = read(KEYS.orders, []).filter(
        (order) => order.status !== "Delivered" && !order.isDeleted,
      ),
      order = orders.find((o) => o.orderId === id);
    if (!order) {
      card.innerHTML =
        '<div class="empty-state">لا يوجد طلب نشط بهذا الرابط. الطلبات التي تم توصيلها لا تظهر في صفحة التتبع.</div>';
      return;
    }
    const set = (selector, value) => {
      const el = card.querySelector(selector);
      if (el) el.textContent = value;
    };
    set(".order-id", `Order ID: #${order.orderId}`);
    set(
      ".order-header div div:nth-child(2)",
      `Date: ${order.date} ${order.time}`,
    );
    const lines = card.querySelector(".items-box");
    if (lines) {
      lines.innerHTML = `<div class="items-title">Order Items:</div>${(order.priceSnapshot || []).map((x) => `<div class="item-row"><span>1x ${escapeHtml(x.name)} - ${escapeHtml(x.size)} / ${escapeHtml(x.color)}</span><strong>${escapeHtml(money(x.finalUnitPrice))}</strong></div>`).join("")}<hr style="border-color:#e2e8f0;margin:8px 0"><div class="item-row" style="font-weight:bold;color:#0f172a"><span>Total:</span><span>${escapeHtml(money(orderNet(order)))}</span></div>`;
    }
    const states = [
        "Accepted",
        "Preparing",
        "Out With Representative",
        "Representative On The Way",
        "Delivered",
      ],
      index = Math.max(0, states.indexOf(order.status));
    const steps = card.querySelectorAll(".step");
    steps.forEach((step, i) => {
      step.classList.toggle("active", i <= index);
      const circle = step.querySelector(".circle");
      if (circle) circle.textContent = i < index ? "✓" : String(i + 1);
    });
    const progress = card.querySelector(".stepper-progress");
    if (progress)
      progress.style.width = `${Math.min(100, (index / (states.length - 1)) * 100)}%`;
    set(
      "#etaTime",
      order.status === "Delivered"
        ? "Delivered"
        : order.status === "Representative On The Way"
          ? "ETA: On the way"
          : order.status,
    );
    set(
      ".driver-box div div:first-child",
      order.representativeName || "Representative not assigned",
    );
    set(
      ".driver-box div div:nth-child(2)",
      order.representativeId
        ? `Courier (ID: ${order.representativeId})`
        : "Waiting for assignment",
    );
    const call = card.querySelector(".btn-call");
    if (call)
      call.href = order.representativePhone
        ? `tel:${order.representativePhone}`
        : "#";
    if (typeof L !== "undefined" && document.getElementById("tracking-map")) {
      const lat = Number(
          order.courierLocation?.lat || order.latitude || 30.0444,
        ),
        lng = Number(order.courierLocation?.lng || order.longitude || 31.2357);
      try {
        if (window.trackingMap) window.trackingMap.remove();
        window.trackingMap = L.map("tracking-map", {
          zoomControl: false,
          attributionControl: true,
        }).setView([lat, lng], 13);
        window.trackingMap.attributionControl?.setPrefix(false);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_4571_1_f3f5f58e8a8808e98e8b6df9", {
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        }).addTo(window.trackingMap);
        L.marker([lat, lng]).addTo(window.trackingMap);
      } catch (error) {
        console.warn("Tracking map unavailable", error);
      }
    }
  }

  function bindRep() {
    // Production representative workflow is server-authoritative in dart-rep.js.
    // Keep this legacy demo path available only when no API is configured.
    if (API_BASE) return;
    if (!document.querySelector(".rep-driver-card")) return;
    const id = new URLSearchParams(location.search).get("order"),
      orders = read(KEYS.orders, []),
      order = orders.find((o) => o.orderId === id);
    const card = document.querySelector(".rep-driver-card");
    if (!order) {
      card.innerHTML =
        '<div class="empty-state">Order not found or not assigned.</div>';
      return;
    }
    const set = (selector, value) => {
      const el = card.querySelector(selector);
      if (el) el.textContent = value;
    };
    set(".rep-header h2", `Order #${order.orderId}`);
    set(
      ".rep-header span",
      `Courier: ${order.representativeName || "Assigned representative"}`,
    );
    set("#orderStatus", order.status);
    set(".rep-info-value", order.clientName);
    set(
      "#customerAddress",
      order.fullAddress ||
        [order.building, order.street, order.area, order.governorate]
          .filter(Boolean)
          .join(", "),
    );
    const infoBoxes = card.querySelectorAll(".rep-info-box"),
      itemsBox = infoBoxes[1];
    if (itemsBox) {
      const itemsText = itemsBox.querySelector('div[style*="margin-bottom"]');
      if (itemsText)
        itemsText.textContent =
          (order.priceSnapshot || [])
            .map((x) => `1x ${x.name} - ${x.size}`)
            .join("\n") || "No items";
    }
    const total = orderNet(order);
    const cash = itemsBox?.querySelector("span:last-child");
    if (cash) cash.textContent = money(total);
    const call = card.querySelector(".rep-btn-call");
    if (call) call.href = `tel:${order.phone1}`;
    function saveStatus(status) {
      const rows = read(KEYS.orders, []),
        stored = rows.find((o) => o.id === order.id),
        from = stored.status;
      stored.status = status;
      stored.updatedAt = now();
      if (status === "Representative On The Way")
        stored.deliveryStartedAt = order.deliveryStartedAt || now();
      if (status === "Out With Representative") {
        stored.deliveryStartedAt = null;
        stored.courierLocation = null;
      }
      if (status === "Delivered") {
        stored.deliveredAt = now();
        stored.paymentStatus = "Paid";
        stored.amountPaid = total;
        const items = read(KEYS.items, []);
        items
          .filter((x) => (stored.items || []).includes(x.itemCode))
          .forEach((x) => {
            x.status = "Sold";
            x.purchaseDate = dateGB();
          });
        write(KEYS.items, items);
        recordDartCardUsage(stored);
      }
      if (["Delivered", "Cancelled", "Refused"].includes(status))
        updateBirthdayRewardForOrder(stored, status);
      stored.activityLog = stored.activityLog || [];
      stored.activityLog.push({
        id: uid("EVT"),
        action: "COURIER_STATUS",
        fromStatus: from,
        toStatus: status,
        timestamp: now(),
        actorRole: "Courier",
      });
      write(KEYS.orders, rows);
      set("#orderStatus", status);
    }
    window.startCountdown = () => {
      if (
        !["Out With Representative", "Representative On The Way"].includes(
          order.status,
        )
      ) {
        window.DartDialog.alert("The order must be Out With Representative first.");
        return;
      }
      order.status = "Representative On The Way";
      order.deliveryStartedAt = order.deliveryStartedAt || now();
      saveStatus(order.status);
      if (navigator.geolocation) {
        window.dartLocationWatch = navigator.geolocation.watchPosition(
          (position) => {
            const rows = read(KEYS.orders, []),
              stored = rows.find((o) => o.id === order.id);
            stored.courierLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              updatedAt: now(),
            };
            write(KEYS.orders, rows);
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 10000 },
        );
      }
    };
    window.completeDelivery = () => {
      saveStatus("Delivered");
      if (window.dartLocationWatch != null)
        navigator.geolocation.clearWatch(window.dartLocationWatch);
    };
    window.cancelDelivery = () => {
      order.deliveryStartedAt = null;
      order.courierLocation = null;
      saveStatus("Out With Representative");
      if (window.dartLocationWatch != null)
        navigator.geolocation.clearWatch(window.dartLocationWatch);
    };
  }

