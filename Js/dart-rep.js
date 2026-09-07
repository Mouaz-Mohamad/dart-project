(function () {
  "use strict";

  const KEYS = {
    reps: "dart_representatives",
    orders: "dart_orders",
    items: "dart_items",
    users: "dart_users",
    customers: "dart_customers",
    session: "dart_rep_session",
    passwordRequests: "dart_password_reset_requests",
    audit: "dart_audit",
    notifications: "dart_notifications",
    cards: "dart_cards",
  };
  const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
  const MAX_SAVED_BYTES = 650 * 1024;
  const DELIVERY_RADIUS_KM = 1;
  const LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
  const activeOrderIds = new Set(
    JSON.parse(sessionStorage.getItem("dart_rep_active_orders") || "[]"),
  );
  let locationWatch = null;
  let locationPermissionBlocked = false;

  const read = (key, fallback = []) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) =>
    localStorage.setItem(key, JSON.stringify(value));
  const now = () => new Date().toISOString();
  const uid = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
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
  const normalizeEmail = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const phoneDigits = (value) =>
    String(value || "")
      .replace(/\D/g, "")
      .replace(/^0020/, "0")
      .replace(/^20(?=1)/, "0");
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

  function setLocationStatus(message, state = "") {
    const status = document.getElementById("repLocationStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const toRadians = (value) => (Number(value) * Math.PI) / 180;
    const firstLat = toRadians(lat1);
    const secondLat = toRadians(lat2);
    const latitudeDelta = toRadians(Number(lat2) - Number(lat1));
    const longitudeDelta = toRadians(Number(lng2) - Number(lng1));
    const value =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(firstLat) *
        Math.cos(secondLat) *
        Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function deliveryProximity(order) {
    const destinationLat = Number(order?.latitude);
    const destinationLng = Number(order?.longitude);
    const courierLat = Number(order?.courierLocation?.lat);
    const courierLng = Number(order?.courierLocation?.lng);
    if (
      ![destinationLat, destinationLng, courierLat, courierLng].every(
        Number.isFinite,
      ) ||
      !destinationLat ||
      !destinationLng
    ) {
      return {
        ok: false,
        reason: "Waiting for a precise representative location.",
      };
    }
    const updatedAt = Date.parse(order?.courierLocation?.updatedAt || 0);
    if (!updatedAt || Date.now() - updatedAt > LOCATION_MAX_AGE_MS) {
      return {
        ok: false,
        reason:
          "Your location must be refreshed before delivery can be confirmed.",
      };
    }
    const distance = distanceKm(
      courierLat,
      courierLng,
      destinationLat,
      destinationLng,
    );
    return {
      ok: distance <= DELIVERY_RADIUS_KM,
      distance,
      reason:
        distance <= DELIVERY_RADIUS_KM
          ? "You are within 1 km of the delivery address."
          : `${distance.toFixed(1)} km remaining before the Delivered button is enabled.`,
    };
  }

  function googleMapsRoute(order) {
    const lat = Number(order?.latitude);
    const lng = Number(order?.longitude);
    const destination =
      Number.isFinite(lat) && Number.isFinite(lng) && lat && lng
        ? `${lat},${lng}`
        : fullAddress(order);
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }

  async function hashPassword(password) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(password)),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function setStatus(form, message, error = false) {
    const status = form.querySelector(".form-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", error);
    status.classList.toggle("is-success", !error);
  }

  function audit(action, entityId, details = {}) {
    const rows = read(KEYS.audit, []);
    rows.unshift({
      id: uid("AUD"),
      action,
      entityType: "representative",
      entityId: String(entityId),
      details,
      timestamp: now(),
      actorRole: "Representative",
    });
    write(KEYS.audit, rows.slice(0, 2000));
  }

  function notify(type, title, message, entityId) {
    const rows = read(KEYS.notifications, []);
    rows.unshift({
      id: uid("NOT"),
      type,
      title,
      message,
      timestamp: now(),
      relatedEntityType: "representative",
      relatedEntityId: String(entityId),
      read: false,
      resolved: false,
    });
    write(KEYS.notifications, rows.slice(0, 500));
  }

  function nextRepId(reps) {
    const max = reps.reduce(
      (current, rep) => {
        const match = String(rep.repId || "").match(/^Rep-(\d+)$/i);
        return Math.max(current, match ? Number(match[1]) : 0);
      },
      Number(localStorage.getItem("dart_counter_rep")) || 0,
    );
    const next = max + 1;
    localStorage.setItem("dart_counter_rep", String(next));
    return `Rep-${next}`;
  }

  function currentSession() {
    const session = read(KEYS.session, null);
    if (
      !session ||
      !session.repId ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      localStorage.removeItem(KEYS.session);
      return null;
    }
    return session;
  }

  function currentRep() {
    const session = currentSession();
    return session
      ? read(KEYS.reps, []).find(
          (rep) =>
            rep.id === session.repId && !rep.isArchived && !rep.isDeleted,
        ) || null
      : null;
  }

  function saveSession(rep) {
    write(KEYS.session, {
      repId: rep.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
  }

  function dataUrlBytes(dataUrl) {
    return Math.ceil(
      ((String(dataUrl || "").split(",")[1] || "").length * 3) / 4,
    );
  }

  async function compressImage(file) {
    if (!ALLOWED_IMAGES.has(file?.type))
      throw new Error("Only JPG, PNG and WebP images are accepted.");
    if (file.size > MAX_SOURCE_BYTES)
      throw new Error("Each source image must be 5 MB or smaller.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = source;
    });
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas
      .getContext("2d", { alpha: false })
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.84,
      result = canvas.toDataURL("image/webp", quality);
    while (dataUrlBytes(result) > MAX_SAVED_BYTES && quality > 0.42) {
      quality -= 0.08;
      result = canvas.toDataURL("image/webp", quality);
    }
    if (dataUrlBytes(result) > MAX_SAVED_BYTES)
      throw new Error(
        "The compressed image is still too large. Use a smaller image.",
      );
    return result;
  }

  function bindImagePreviews(form) {
    ["idFront", "idBack", "face"].forEach((name) => {
      const input = form.elements[name],
        preview = form.querySelector(`[data-preview="${name}"]`);
      input?.addEventListener("change", async () => {
        try {
          const src = await compressImage(input.files[0]);
          input.dataset.compressed = src;
          preview.src = src;
          preview.hidden = false;
        } catch (error) {
          input.value = "";
          delete input.dataset.compressed;
          preview.hidden = true;
          setStatus(form, error.message, true);
        }
      });
    });
  }

  function conflict(payload) {
    const reps = read(KEYS.reps, []),
      users = read(KEYS.users, []),
      customers = read(KEYS.customers, []);
    const email = normalizeEmail(payload.email),
      phone1 = phoneDigits(payload.phone1),
      phone2 = phoneDigits(payload.phone2);
    if (phone2 && phone1 === phone2)
      return "Primary and secondary phones must be different.";
    if (
      reps.some(
        (rep) =>
          !rep.isArchived &&
          !rep.isDeleted &&
          (String(rep.nationalId) === payload.nationalId ||
            normalizeEmail(rep.email) === email ||
            [phoneDigits(rep.phone1), phoneDigits(rep.phone2)].some(
              (phone) => phone && [phone1, phone2].includes(phone),
            )),
      )
    )
      return "National ID, email or phone is already registered.";
    if (
      users.some(
        (user) =>
          !user.isArchived &&
          (normalizeEmail(user.email) === email ||
            [phoneDigits(user.phone1), phoneDigits(user.phone2)].some(
              (phone) => phone && [phone1, phone2].includes(phone),
            )),
      )
    )
      return "Email or phone is already used by another Dart account.";
    if (
      customers.some(
        (customer) =>
          !customer.isArchived &&
          !customer.isDeleted &&
          (normalizeEmail(customer.email) === email ||
            [phoneDigits(customer.phone1), phoneDigits(customer.phone2)].some(
              (phone) => phone && [phone1, phone2].includes(phone),
            )),
      )
    )
      return "Email or phone is already recorded for a Dart customer.";
    return "";
  }

  async function register(form) {
    const data = Object.fromEntries(new FormData(form));
    data.name = String(data.name || "").trim();
    data.nationalId = String(data.nationalId || "").replace(/\D/g, "");
    data.email = normalizeEmail(data.email);
    data.phone1 = phoneDigits(data.phone1);
    data.phone2 = phoneDigits(data.phone2);
    data.address = String(data.address || "").trim();
    if (data.name.length < 3) throw new Error("Enter your full name.");
    if (!/^\d{14}$/.test(data.nationalId))
      throw new Error("National ID must contain exactly 14 digits.");
    if (!/^\S+@\S+\.\S+$/.test(data.email))
      throw new Error("Enter a valid email.");
    if (!/^01[0125]\d{8}$/.test(data.phone1))
      throw new Error("Enter a valid Egyptian primary phone.");
    if (data.phone2 && !/^01[0125]\d{8}$/.test(data.phone2))
      throw new Error("Enter a valid secondary phone.");
    if (data.password.length < 8)
      throw new Error("Password must be at least 8 characters.");
    if (data.password !== data.confirmPassword)
      throw new Error("Passwords do not match.");
    if (!data.address) throw new Error("Full address is required.");
    const duplicate = conflict(data);
    if (duplicate) throw new Error(duplicate);
    const images = {
      idFrontImage: form.elements.idFront.dataset.compressed,
      idBackImage: form.elements.idBack.dataset.compressed,
      faceImage: form.elements.face.dataset.compressed,
    };
    if (!images.idFrontImage || !images.idBackImage || !images.faceImage)
      throw new Error("Upload all three verification images.");
    const reps = read(KEYS.reps, []),
      rep = {
        id: uid("RDB"),
        repId: nextRepId(reps),
        name: data.name,
        nationalId: data.nationalId,
        email: data.email,
        phone1: data.phone1,
        phone2: data.phone2 || "-",
        address: data.address,
        passwordHash: await hashPassword(data.password),
        ...images,
        status: "Pending Approval",
        createdAt: now(),
        date: new Date().toLocaleDateString("en-GB"),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };
    reps.push(rep);
    write(KEYS.reps, reps);
    audit("REP_REGISTER", rep.id, { repId: rep.repId, status: rep.status });
    notify(
      "representative_registration",
      `Representative approval: ${rep.repId}`,
      `${rep.name} submitted verification documents.`,
      rep.id,
    );
    return rep;
  }

  async function login(identifier, password) {
    const input = String(identifier || "").trim(),
      email = normalizeEmail(input),
      phone = phoneDigits(input),
      hash = await hashPassword(password);
    const rep = read(KEYS.reps, []).find(
      (row) =>
        !row.isArchived &&
        !row.isDeleted &&
        (normalizeEmail(row.email) === email ||
          phoneDigits(row.phone1) === phone ||
          phoneDigits(row.phone2) === phone ||
          String(row.repId).toLowerCase() === input.toLowerCase() ||
          String(row.nationalId) === input),
    );
    if (!rep || rep.passwordHash !== hash)
      throw new Error("Incorrect login details.");
    if (rep.status === "Pending Approval")
      throw new Error("Your account is still waiting for dashboard approval.");
    if (rep.status === "Rejected")
      throw new Error(
        `Your account was rejected${rep.rejectionReason ? `: ${rep.rejectionReason}` : "."}`,
      );
    if (rep.status !== "Active")
      throw new Error("This representative account is not available.");
    saveSession(rep);
    audit("REP_LOGIN", rep.id);
    return rep;
  }

  function showAuth(name = "login") {
    document.getElementById("repAuthView").hidden = false;
    document.getElementById("repDashboardView").hidden = true;
    const login = document.getElementById("repLoginForm"),
      registerForm = document.getElementById("repRegisterForm"),
      change = document.getElementById("repChangePasswordForm");
    login.hidden = name !== "login";
    registerForm.hidden = name !== "register";
    change.hidden = name !== "change";
    const card = document.getElementById("repAuthCard"),
      loginPrompt = document.getElementById("repLoginPrompt"),
      registerPrompt = document.getElementById("repRegisterPrompt");
    if (card) card.dataset.view = name;
    if (loginPrompt) loginPrompt.hidden = name !== "register";
    if (registerPrompt) registerPrompt.hidden = name !== "login";
  }

  function repOrders(rep) {
    return read(KEYS.orders, []).filter(
      (order) =>
        (String(order.representativeId) === String(rep.id) ||
          String(order.representativeId) === String(rep.repId)) &&
        !order.isArchived &&
        !order.isDeleted &&
        !["Delivered", "Refused", "Cancelled"].includes(order.status),
    );
  }

  function fullAddress(order) {
    return (
      order.fullAddress ||
      [
        order.building,
        order.street,
        order.area,
        order.governorate,
        order.country,
      ]
        .filter(Boolean)
        .join(", ")
    );
  }

  function renderOrders() {
    const rep = currentRep();
    if (!rep) {
      showAuth("login");
      return;
    }
    if (rep.mustChangePassword) {
      showAuth("change");
      return;
    }
    document.getElementById("repAuthView").hidden = true;
    document.getElementById("repDashboardView").hidden = false;
    document.getElementById("repIdentity").textContent =
      `${rep.name} · ${rep.repId} · ${rep.phone1}`;
    const orders = repOrders(rep),
      list = document.getElementById("repOrdersList");
    activeOrderIds.clear();
    orders
      .filter(
        (order) =>
          order.deliveryStartedAt &&
          order.status === "Representative On The Way",
      )
      .forEach((order) => activeOrderIds.add(order.id));
    saveActiveIds();
    list.innerHTML =
      orders
        .map((order) => {
          const started =
            activeOrderIds.has(order.id) && Boolean(order.deliveryStartedAt);
          const proximity = started
            ? deliveryProximity(order)
            : {
                ok: false,
                reason:
                  "Start delivery to open Google Maps and begin secure location sharing.",
              };
          const items =
            (order.priceSnapshot || [])
              .map(
                (line) =>
                  `<div class="dart-rep-line"><span>${Number(line.qty) || 1}× ${esc(line.name || line.modelCode || "Item")} · ${esc(line.size || "-")} · ${esc(line.color || "-")}</span><b>${esc(money((Number(line.finalUnitPrice) || 0) * (Number(line.qty) || 1)))}</b></div>`,
              )
              .join("") || "<div>No item details</div>";
          return `<article class="rep-driver-card" data-order-id="${esc(order.id)}">
        <div class="rep-header"><div><h2>Order #${esc(order.orderId)}</h2><span>${esc(order.date || "")} ${esc(order.time || "")}</span></div><span class="rep-status-badge">${esc(order.status)}</span></div>
        <div class="rep-info-box"><div class="rep-info-title">Customer &amp; address</div><div class="rep-info-value">${esc(order.clientName)}</div><div class="dart-rep-customer-phone">${esc(order.phone1 || "-")}${order.phone2 && order.phone2 !== "-" ? ` · ${esc(order.phone2)}` : ""}</div><address>${esc(fullAddress(order) || "Address missing")}</address>${order.deliveryNotes ? `<p class="dart-rep-notes">${esc(order.deliveryNotes)}</p>` : ""}</div>
        <div class="rep-info-box"><div class="rep-info-title">Items &amp; cash collection</div>${items}<div class="dart-rep-total"><span>Collect cash</span><strong>${esc(money(orderTotal(order)))}</strong></div></div>
        <p class="dart-rep-proximity ${proximity.ok ? "is-ready" : ""}" role="status">${esc(proximity.reason)}</p>
        <div class="dart-rep-order-actions">
          <a href="tel:${esc(order.phone1)}" class="rep-btn rep-btn-call"><i class="fa-solid fa-phone"></i> Call customer</a>
          ${!started ? '<button type="button" class="rep-btn rep-btn-go" data-action="start"><i class="fa-solid fa-diamond-turn-right"></i> Start delivery</button>' : ""}
          ${started ? '<button type="button" class="rep-btn rep-btn-cancel" data-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel delivery</button>' : ""}
          ${started && proximity.ok ? '<button type="button" class="rep-btn rep-btn-complete" data-action="complete"><i class="fa-solid fa-circle-check"></i> Delivered</button>' : ""}
        </div>
      </article>`;
        })
        .join("") ||
      '<div class="empty-state">No active orders are assigned to you.</div>';
    ensureLocationWatch();
  }

  function saveActiveIds() {
    sessionStorage.setItem(
      "dart_rep_active_orders",
      JSON.stringify([...activeOrderIds]),
    );
  }

  function updateOrderStatus(orderId, status) {
    const rep = currentRep(),
      orders = read(KEYS.orders, []),
      order = orders.find((row) => String(row.id) === String(orderId));
    if (
      !rep ||
      !order ||
      (String(order.representativeId) !== String(rep.id) &&
        String(order.representativeId) !== String(rep.repId))
    )
      throw new Error("This order is not assigned to your account.");
    const previous = order.status;
    order.status = status;
    order.updatedAt = now();
    if (status === "Representative On The Way") {
      order.representativeOnWayAt = now();
      order.deliveryStartedAt = order.deliveryStartedAt || now();
    }
    if (status === "Out With Representative") {
      order.representativeOnWayAt = null;
      order.deliveryStartedAt = null;
      order.courierLocation = null;
    }
    if (status === "Delivered") {
      order.deliveredAt = now();
      order.paymentStatus = "Paid";
      order.amountPaid = orderTotal(order);
      activeOrderIds.delete(order.id);
      const items = read(KEYS.items, []);
      items
        .filter((item) => (order.items || []).includes(item.itemCode))
        .forEach((item) => {
          item.status = "Sold";
          item.purchaseDate = new Date().toLocaleDateString("en-GB");
        });
      write(KEYS.items, items);
      if (order.dartCardId && !order.dartCardUsageRecorded) {
        const cards = read(KEYS.cards, []),
          card = cards.find(
            (row) => row.cardId === order.dartCardId && row.status === "Active",
          );
        if (card) {
          card.purchasedItems = String(
            Number(card.purchasedItems || 0) +
              Number(order.totalProducts || order.items?.length || 0),
          );
          if (
            Number(card.purchasedItems) >=
            Number(card.itemLimit || card.purchasedLimit || 10)
          )
            card.status = "Expired";
          order.dartCardUsageRecorded = true;
          write(KEYS.cards, cards);
        }
      }
    }
    order.activityLog = order.activityLog || [];
    order.activityLog.push({
      id: uid("EVT"),
      type: "COURIER_STATUS",
      previousStatus: previous,
      newStatus: status,
      timestamp: now(),
      actorRole: "Representative",
      representativeId: rep.id,
    });
    write(KEYS.orders, orders);
    saveActiveIds();
    audit("COURIER_STATUS", rep.id, {
      orderId: order.orderId,
      from: previous,
      to: status,
    });
    return order;
  }

  function ensureLocationWatch() {
    if (!activeOrderIds.size) {
      if (locationWatch != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatch);
        locationWatch = null;
      }
      setLocationStatus(
        "Location sharing starts only after you start a delivery.",
      );
      return;
    }
    if (locationWatch != null || locationPermissionBlocked) return;
    if (!navigator.geolocation) {
      setLocationStatus(
        "This device does not support the location required for delivery confirmation.",
        "error",
      );
      return;
    }
    setLocationStatus("Requesting precise location permission…", "loading");
    locationWatch = navigator.geolocation.watchPosition(
      (position) => {
        const rep = currentRep(),
          orders = read(KEYS.orders, []);
        let changed = false;
        orders.forEach((order) => {
          if (
            activeOrderIds.has(order.id) &&
            (String(order.representativeId) === String(rep?.id) ||
              String(order.representativeId) === String(rep?.repId))
          ) {
            order.courierLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              updatedAt: now(),
            };
            changed = true;
          }
        });
        if (changed) {
          write(KEYS.orders, orders);
          setLocationStatus(
            "Live location is being shared for the active delivery.",
            "success",
          );
          renderOrders();
        }
      },
      (error) => {
        locationWatch = null;
        locationPermissionBlocked = error.code === 1;
        setLocationStatus(
          `Live location unavailable: ${error.message}`,
          "error",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  function bindEvents() {
    const loginForm = document.getElementById("repLoginForm"),
      registerForm = document.getElementById("repRegisterForm"),
      changeForm = document.getElementById("repChangePasswordForm");
    bindImagePreviews(registerForm);
    document.getElementById("repLoginTab").onclick = () => showAuth("login");
    document.getElementById("repRegisterTab").onclick = () =>
      showAuth("register");
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!loginForm.checkValidity()) return loginForm.reportValidity();
      try {
        const rep = await login(
          loginForm.elements.identifier.value,
          loginForm.elements.password.value,
        );
        setStatus(loginForm, "Login successful.");
        rep.mustChangePassword ? showAuth("change") : renderOrders();
      } catch (error) {
        setStatus(loginForm, error.message, true);
      }
    });
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!registerForm.checkValidity()) return registerForm.reportValidity();
      try {
        const rep = await register(registerForm);
        registerForm.reset();
        registerForm
          .querySelectorAll("[data-preview]")
          .forEach((image) => (image.hidden = true));
        setStatus(
          registerForm,
          `Application ${rep.repId} submitted. Wait for dashboard approval.`,
        );
        setTimeout(() => showAuth("login"), 1600);
      } catch (error) {
        setStatus(registerForm, error.message, true);
      }
    });
    changeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!changeForm.checkValidity()) return changeForm.reportValidity();
      const password = changeForm.elements.password.value;
      if (password !== changeForm.elements.confirmPassword.value)
        return setStatus(changeForm, "Passwords do not match.", true);
      const rep = currentRep();
      if (!rep) return showAuth("login");
      const reps = read(KEYS.reps, []),
        stored = reps.find((row) => row.id === rep.id);
      stored.passwordHash = await hashPassword(password);
      stored.mustChangePassword = false;
      stored.passwordUpdatedAt = now();
      write(KEYS.reps, reps);
      audit("REP_PASSWORD_CHANGED", rep.id);
      changeForm.reset();
      renderOrders();
    });
    document.getElementById("repForgotPassword").onclick = () => {
      const identifier = prompt(
        "Enter your phone, email, Rep ID or National ID:",
      );
      if (!identifier) return;
      const reps = read(KEYS.reps, []),
        rep = reps.find(
          (row) =>
            normalizeEmail(row.email) === normalizeEmail(identifier) ||
            phoneDigits(row.phone1) === phoneDigits(identifier) ||
            String(row.repId).toLowerCase() ===
              String(identifier).toLowerCase() ||
            String(row.nationalId) === String(identifier),
        );
      const requests = read(KEYS.passwordRequests, []);
      if (
        rep &&
        !requests.some(
          (row) => row.status === "Pending" && row.accountId === rep.id,
        )
      ) {
        requests.unshift({
          id: uid("PWR"),
          accountType: "Representative",
          accountId: rep.id,
          identifier,
          displayName: rep.name,
          status: "Pending",
          createdAt: now(),
          source: "Representative Portal",
        });
        write(KEYS.passwordRequests, requests);
        notify(
          "password_reset",
          "Representative password reset request",
          `${rep.repId} requested a temporary password.`,
          rep.id,
        );
      }
      alert(
        "If the account exists, a reset request is now waiting for dashboard review.",
      );
    };
    document.getElementById("repLogout").onclick = () => {
      const rep = currentRep();
      if (rep) audit("REP_LOGOUT", rep.id);
      localStorage.removeItem(KEYS.session);
      activeOrderIds.clear();
      saveActiveIds();
      ensureLocationWatch();
      showAuth("login");
    };
    document
      .getElementById("repOrdersList")
      .addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const card = button.closest("[data-order-id]"),
          orderId = card?.dataset.orderId,
          orders = read(KEYS.orders, []),
          order = orders.find((row) => String(row.id) === String(orderId));
        try {
          if (!order) throw new Error("The assigned order could not be found.");
          if (button.dataset.action === "start") {
            if (
              ![
                "Out With Representative",
                "Representative On The Way",
              ].includes(order.status)
            )
              throw new Error(
                "Dashboard must move the order to Out With Representative first.",
              );
            window.open(googleMapsRoute(order), "_blank", "noopener");
            locationPermissionBlocked = false;
            activeOrderIds.add(order.id);
            updateOrderStatus(order.id, "Representative On The Way");
            ensureLocationWatch();
            renderOrders();
          }
          if (button.dataset.action === "complete") {
            const freshOrder = read(KEYS.orders, []).find(
              (row) => String(row.id) === String(orderId),
            );
            const proximity = deliveryProximity(freshOrder);
            if (
              !activeOrderIds.has(freshOrder.id) ||
              !freshOrder.deliveryStartedAt
            )
              throw new Error("Start delivery before confirming it.");
            if (!proximity.ok) throw new Error(proximity.reason);
            if (!confirm(`Mark ${freshOrder.orderId} as delivered and paid?`))
              return;
            updateOrderStatus(freshOrder.id, "Delivered");
            renderOrders();
          }
          if (button.dataset.action === "cancel") {
            activeOrderIds.delete(order.id);
            updateOrderStatus(order.id, "Out With Representative");
            ensureLocationWatch();
            renderOrders();
          }
        } catch (error) {
          alert(error.message);
        }
      });
  }

  window.DartRepPortal = {
    login,
    currentRep,
    repOrders,
    orderTotal,
    distanceKm,
    deliveryProximity,
    googleMapsRoute,
  };

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    const rep = currentRep();
    if (rep?.status === "Active")
      rep.mustChangePassword ? showAuth("change") : renderOrders();
    else showAuth("login");
    setInterval(() => {
      if (currentRep() && !document.hidden) renderOrders();
    }, 5000);
  });
  window.addEventListener("storage", (event) => {
    if ([KEYS.orders, KEYS.reps].includes(event.key) && currentRep())
      renderOrders();
  });
})();
