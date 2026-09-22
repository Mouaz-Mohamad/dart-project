// DART CODE GUIDE | Js/dart-rep.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-rep.js
// Representative portal auth, assignments, delivery, return pickup, and live-location UI.
// BEGIN MODULE

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
    returns: "dart_returns",
  };
  const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
  const MAX_SAVED_BYTES = 650 * 1024;
  const DELIVERY_RADIUS_KM = 1;
  const LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
  const API_ENABLED = Boolean(window.DartApi?.isConfigured);
  const API_REQUIRED =
    location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname);
  const API_REP_CACHE_KEY = "dart_api_representative_cache";
  let apiRepresentative = null;
  try {
    apiRepresentative = JSON.parse(sessionStorage.getItem(API_REP_CACHE_KEY) || "null");
  } catch {
    sessionStorage.removeItem(API_REP_CACHE_KEY);
  }
  const activeOrderIds = new Set(
    JSON.parse(sessionStorage.getItem("dart_rep_active_orders") || "[]"),
  );
  const activeReturnIds = new Set(
    JSON.parse(sessionStorage.getItem("dart_rep_active_returns") || "[]"),
  );
  let locationWatch = null;
  let locationPermissionBlocked = false;
  let apiWork = { orders: [], returns: [] };
  let latestApiLocation = null;
  let lastLocationSyncAt = 0;
  const deliveryMaps = new Map();

  const read = (key, fallback = []) => window.DartState?.read?.(key, fallback) ?? fallback;
  const write = (key, value) => {
    if (API_REQUIRED) throw new Error(`Representative business-state writes require the secure API (${key}).`);
    window.DartState?.write?.(key, value, { source: "rep-dev" });
  };
  const now = () => new Date().toISOString();
  const uid = (prefix) => {
    const randomPart =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint32Array(4)))
            .map((value) => value.toString(36))
            .join("-");
    return `${prefix}-${randomPart}`;
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
    if (API_ENABLED && API_REQUIRED) {
      throw new Error("Representative business IDs are generated by PostgreSQL in production.");
    }
    const max = reps.reduce(
      (current, rep) => {
        const match = String(rep.repId || "").match(/^Rep-(\d+)$/i);
        return Math.max(current, match ? Number(match[1]) : 0);
      },
      0,
    );
    const next = max + 1;
    return `Rep-${next}`;
  }

  function currentSession() {
    if (API_ENABLED) return apiRepresentative ? { repId: apiRepresentative.id, api: true } : null;
    const session = read(KEYS.session, null);
    if (
      !session ||
      !session.repId ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      window.DartState?.remove?.(KEYS.session, { source: "rep" });
      return null;
    }
    return session;
  }

  function currentRep() {
    if (API_ENABLED) return apiRepresentative;
    const session = currentSession();
    return session
      ? read(KEYS.reps, []).find(
          (rep) =>
            rep.id === session.repId && !rep.isArchived && !rep.isDeleted,
        ) || null
      : null;
  }

  function saveSession(rep) {
    if (API_ENABLED) {
      apiRepresentative = {
        id: rep.id,
        repId: rep.code,
        name: rep.name,
        email: rep.email,
        phone1: rep.phones?.[0] || "",
        phone2: rep.phones?.[1] || "",
        status: rep.status === "active" ? "Active" : rep.status,
        mustChangePassword: rep.mustChangePassword,
        serverAuthoritative: true,
      };
      sessionStorage.setItem(API_REP_CACHE_KEY, JSON.stringify(apiRepresentative));
      return;
    }
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
    const reps = read(KEYS.reps, []);
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
    return "";
  }

  async function register(form) {
    if (!API_ENABLED && API_REQUIRED)
      throw new Error("Representative registration requires the secure account API.");
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
    if (data.password.length < 12)
      throw new Error("Password must be at least 12 characters.");
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

    if (API_ENABLED) {
      const result = await window.DartApi.request("/api/v1/representatives/register", {
        method: "POST",
        body: {
          name: data.name,
          nationalId: data.nationalId,
          email: data.email,
          phone1: data.phone1,
          ...(data.phone2 ? { phone2: data.phone2 } : {}),
          address: data.address,
          password: data.password,
          ...images,
        },
      });
      return {
        id: result.userId,
        repId: result.representativeCode,
        name: data.name,
        email: data.email,
        phone1: data.phone1,
        phone2: data.phone2 || "-",
        address: data.address,
        status: "Pending Approval",
        serverAuthoritative: true,
      };
    }

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
    if (API_ENABLED) {
      const payload = await window.DartApi.request("/api/v1/representatives/login", {
        method: "POST",
        body: { identifier, password },
      });
      saveSession(payload.user);
      return apiRepresentative;
    }
    if (API_REQUIRED)
      throw new Error("Representative login requires the secure account API.");
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
    if (API_ENABLED) return apiWork.orders || [];
    return read(KEYS.orders, []).filter(
      (order) =>
        (String(order.representativeId) === String(rep.id) ||
          String(order.representativeId) === String(rep.repId)) &&
        !order.isArchived &&
        !order.isDeleted &&
        !["Delivered", "Refused", "Cancelled"].includes(order.status),
    );
  }

  function repReturns(rep) {
    if (API_ENABLED) return apiWork.returns || [];
    return read(KEYS.returns, []).filter(
      (record) =>
        (String(record.representativeId) === String(rep.id) ||
          String(record.representativeId) === String(rep.repId)) &&
        !record.isArchived &&
        !record.isDeleted &&
        ["Representative Assigned", "Pickup On The Way"].includes(record.status),
    );
  }

  async function refreshApiWork() {
    if (!API_ENABLED || !currentRep()) return apiWork;
    const payload = await window.DartApi.request("/api/v1/representatives/work");
    apiWork = {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      returns: Array.isArray(payload.returns) ? payload.returns : [],
    };
    if (latestApiLocation) {
      [...apiWork.orders, ...apiWork.returns].forEach((record) => {
        if (record.deliveryStartedAt || record.pickupStartedAt || record.status === "Representative On The Way" || record.status === "Pickup On The Way") {
          record.courierLocation = latestApiLocation;
        }
      });
    }
    return apiWork;
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

  function wrapOperationalGroups(list, records, type) {
    const groups = type === "order"
      ? window.DartGroups?.groupOrders?.(records)
      : window.DartGroups?.groupReturns?.(records);
    (groups || []).filter((group) => group.records.length > 1).forEach((group) => {
      const attribute = type === "order" ? "data-order-id" : "data-return-id";
      const cards = group.records.map((record) => [...list.querySelectorAll(`[${attribute}]`)].find((card) => String(card.getAttribute(attribute)) === String(record.id))).filter(Boolean);
      if (cards.length < 2) return;
      const template = document.getElementById("rep-operational-group-template");
      if (!template) return;
      const fragment = template.content.cloneNode(true), wrapper = fragment.querySelector("[data-rep-operational-group]");
      wrapper.querySelector('[data-rep-group-field="title"]').textContent = type === "order" ? `${cards.length} orders · one delivery route` : `${cards.length} returns · one pickup route`;
      cards[0].before(fragment);
      cards.forEach((card) => wrapper.appendChild(card));
    });
  }

  function renderReturns(rep) {
    const list = document.getElementById("repReturnsList"),
      template = document.getElementById("rep-return-card-template");
    if (!list || !template) return;
    const records = repReturns(rep);
    activeReturnIds.clear();
    records
      .filter((record) => record.pickupStartedAt && record.status === "Pickup On The Way")
      .forEach((record) => activeReturnIds.add(record.id));
    saveActiveIds();
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No active return pickups are assigned to you.";
      list.appendChild(empty);
      return;
    }
    records.forEach((record) => {
      const fragment = template.content.cloneNode(true),
        card = fragment.querySelector("[data-return-id]"),
        started = activeReturnIds.has(record.id) && Boolean(record.pickupStartedAt),
        proximity = started
          ? deliveryProximity(record)
          : { ok: false, reason: "Start pickup to open Google Maps and begin secure location sharing." },
        customerFee = Number(record.customerCourierFee) || 0,
        brandFee = Number(record.brandCourierFee) || 0,
        isExchange = window.DartReturns?.isExchange(record) || record.requestType === "Exchange";
      card.dataset.returnId = record.id;
      const values = {
        title: `${record.requestType || "Return"} #${record.returnId || record.id}`,
        date: `${record.date || ""}`,
        status: record.status || "-",
        customer: record.clientName || record.clientId || "Customer",
        phones: [record.phone1, record.phone2].filter((phone) => phone && phone !== "-").join(" · ") || "-",
        address: fullAddress(record) || "Address missing",
        reason: record.reason || "No reason entered",
        originalItem: `Original: ${record.itemCode || "-"}`,
        requestType: record.requestType || "Return",
        replacementItem: record.replacementItemCode || `${record.requestedColor || "-"} / ${record.requestedSize || "-"}`,
        feeLabel: customerFee > 0 ? "Collect from customer" : brandFee > 0 ? "Dart owes representative" : "Courier fee",
        feeAmount: money(customerFee || brandFee),
        proximity: proximity.reason,
      };
      Object.entries(values).forEach(([field, value]) => {
        const element = card.querySelector(`[data-return-field="${field}"]`);
        if (element) element.textContent = value;
      });
      card.querySelector("[data-return-replacement-row]").hidden = !isExchange;
      const call = card.querySelector("[data-return-call]");
      call.href = record.phone1 ? `tel:${record.phone1}` : "#";
      call.hidden = !record.phone1;
      card.querySelector('[data-return-action="start"]').hidden = started;
      card.querySelector('[data-return-action="cancel"]').hidden = !started;
      card.querySelector('[data-return-action="complete"]').hidden = !started || !proximity.ok;
      card.querySelector('[data-return-field="proximity"]').classList.toggle("is-ready", proximity.ok);
      list.appendChild(fragment);
    });
    wrapOperationalGroups(list, records, "return");
  }


  function clearDeliveryMaps() {
    for (const entry of deliveryMaps.values()) {
      try { entry.map.remove(); } catch {}
    }
    deliveryMaps.clear();
  }

  function renderDeliveryMaps(orders) {
    if (typeof window.L === "undefined") return;
    document.querySelectorAll("[data-rep-live-map]").forEach((element) => {
      const order = orders.find(
        (row) => String(row.id) === String(element.dataset.orderId),
      );
      if (!order) return;
      const destinationLat = Number(order.latitude);
      const destinationLng = Number(order.longitude);
      if (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLng)) {
        element.replaceChildren();
        element.textContent = "Customer map location is unavailable.";
        return;
      }
      const courier = order.courierLocation || latestApiLocation;
      const courierLat = Number(courier?.lat);
      const courierLng = Number(courier?.lng);
      const map = window.L.map(element, {
        attributionControl: false,
        zoomControl: false,
      }).setView([destinationLat, destinationLng], 15);
      window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);
      const destinationMarker = window.L.marker([destinationLat, destinationLng])
        .addTo(map)
        .bindPopup("Customer");
      let courierMarker = null;
      let route = null;
      if (Number.isFinite(courierLat) && Number.isFinite(courierLng)) {
        courierMarker = window.L.marker([courierLat, courierLng])
          .addTo(map)
          .bindPopup("You");
        route = window.L.polyline(
          [[courierLat, courierLng], [destinationLat, destinationLng]],
          { weight: 4, opacity: 0.7 },
        ).addTo(map);
        map.fitBounds(route.getBounds(), { padding: [28, 28], maxZoom: 16 });
      } else {
        destinationMarker.openPopup();
      }
      deliveryMaps.set(String(order.id), {
        map,
        destinationMarker,
        courierMarker,
        route,
      });
      window.setTimeout(() => map.invalidateSize(), 80);
    });
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
    clearDeliveryMaps();
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
        ${started ? `<div class="dart-rep-live-map" data-rep-live-map data-order-id="${esc(order.id)}" aria-label="Live delivery route"></div>` : ""}
        <div class="dart-rep-order-actions">
          <a href="tel:${esc(order.phone1)}" class="rep-btn rep-btn-call"><i class="fa-solid fa-phone"></i> Call customer</a>
          ${!started ? '<button type="button" class="rep-btn rep-btn-go" data-action="start"><i class="fa-solid fa-diamond-turn-right"></i> Start delivery</button>' : ""}
          ${started ? `<a class="rep-btn rep-btn-go" href="${esc(googleMapsRoute(order))}" target="_blank" rel="noopener"><i class="fa-solid fa-map-location-dot"></i> Open navigation</a>` : ""}
          ${started ? '<button type="button" class="rep-btn rep-btn-cancel" data-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel delivery</button>' : ""}
          ${started && proximity.ok ? '<button type="button" class="rep-btn rep-btn-complete" data-action="complete"><i class="fa-solid fa-circle-check"></i> Delivered</button>' : ""}
        </div>
      </article>`;
        })
        .join("") ||
      '<div class="empty-state">No active orders are assigned to you.</div>';
    wrapOperationalGroups(list, orders, "order");
    renderDeliveryMaps(orders);
    renderReturns(rep);
    ensureLocationWatch();
  }

  function saveActiveIds() {
    sessionStorage.setItem(
      "dart_rep_active_orders",
      JSON.stringify([...activeOrderIds]),
    );
    sessionStorage.setItem(
      "dart_rep_active_returns",
      JSON.stringify([...activeReturnIds]),
    );
  }

  async function updateOrderStatus(orderId, status) {
    if (API_ENABLED) {
      const order = (apiWork.orders || []).find(
        (row) => String(row.id) === String(orderId),
      );
      if (!order) throw new Error("The assigned order could not be found.");
      const action =
        status === "Representative On The Way"
          ? "start"
          : status === "Delivered"
            ? "delivered"
            : status === "Out With Representative"
              ? "cancel"
              : "";
      if (!action) throw new Error("Unsupported delivery action.");
      await window.DartApi.request(
        `/api/v1/representatives/orders/${encodeURIComponent(order.orderId)}/action`,
        { method: "POST", body: { action } },
      );
      await refreshApiWork();
      if (status === "Delivered") activeOrderIds.delete(order.id);
      if (status === "Representative On The Way") activeOrderIds.add(order.id);
      if (status === "Out With Representative") activeOrderIds.delete(order.id);
      saveActiveIds();
      return (apiWork.orders || []).find(
        (row) => String(row.orderId) === String(order.orderId),
      ) || { ...order, status };
    }


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

  function assignedReturn(recordId) {
    const rep = currentRep(),
      records = read(KEYS.returns, []),
      record = records.find((row) => String(row.id) === String(recordId));
    if (
      !rep ||
      !record ||
      (String(record.representativeId) !== String(rep.id) &&
        String(record.representativeId) !== String(rep.repId))
    )
      throw new Error("This return pickup is not assigned to your account.");
    return { rep, records, record };
  }

  function addReturnActivity(record, previousStatus, newStatus, action, rep) {
    record.activityLog = record.activityLog || [];
    record.activityLog.push({
      id: uid("EVT"),
      action,
      previousStatus,
      newStatus,
      timestamp: now(),
      actorRole: "Representative",
      representativeId: rep.id,
    });
  }

  async function startReturnPickup(recordId) {
    if (API_ENABLED) {
      const record = (apiWork.returns || []).find(
        (row) => String(row.id) === String(recordId),
      );
      if (!record) throw new Error("The assigned return could not be found.");
      await window.DartApi.request(
        `/api/v1/representatives/returns/${encodeURIComponent(record.returnId || record.id)}/action`,
        { method: "POST", body: { action: "start" } },
      );
      activeReturnIds.add(record.id);
      saveActiveIds();
      await refreshApiWork();
      return (apiWork.returns || []).find((row) => String(row.id) === String(record.id)) || {
        ...record,
        status: "Pickup On The Way",
      };
    }
    const { rep, records, record } = assignedReturn(recordId);
    if (!["Representative Assigned", "Pickup On The Way"].includes(record.status))
      throw new Error("This pickup cannot be started in its current status.");
    const previous = record.status;
    if (record.status === "Representative Assigned")
      record.pickupSnapshot = window.DartReturns?.captureWorkflowSnapshot?.(
        record,
        ["pickupStartedAt", "courierLocation", "updatedAt"],
        now(),
      ) || null;
    record.status = "Pickup On The Way";
    record.pickupStartedAt = record.pickupStartedAt || now();
    record.updatedAt = now();
    activeReturnIds.add(record.id);
    addReturnActivity(record, previous, record.status, "RETURN_PICKUP_STARTED", rep);
    write(KEYS.returns, records);
    saveActiveIds();
    audit("RETURN_PICKUP_STARTED", rep.id, { returnId: record.returnId });
    notify("return_pickup_started", `${record.returnId}: Pickup started`, rep.name, record.id);
    return record;
  }

  async function cancelReturnPickup(recordId) {
    if (API_ENABLED) {
      const record = (apiWork.returns || []).find(
        (row) => String(row.id) === String(recordId),
      );
      if (!record) throw new Error("The assigned return could not be found.");
      await window.DartApi.request(
        `/api/v1/representatives/returns/${encodeURIComponent(record.returnId || record.id)}/action`,
        { method: "POST", body: { action: "cancel" } },
      );
      activeReturnIds.delete(record.id);
      saveActiveIds();
      await refreshApiWork();
      return (apiWork.returns || []).find((row) => String(row.id) === String(record.id)) || {
        ...record,
        status: "Representative Assigned",
      };
    }
    const { rep, records, record } = assignedReturn(recordId);
    if (record.status !== "Pickup On The Way")
      throw new Error("This pickup is not currently active.");
    const previous = record.status;
    record.status = "Representative Assigned";
    record.pickupStartedAt = null;
    record.courierLocation = null;
    record.lastFailedPickupAt = now();
    record.failedPickupAttempts = Number(record.failedPickupAttempts || 0) + 1;
    record.updatedAt = record.lastFailedPickupAt;
    activeReturnIds.delete(record.id);
    addReturnActivity(record, previous, record.status, "RETURN_PICKUP_FAILED", rep);
    write(KEYS.returns, records);
    saveActiveIds();
    audit("RETURN_PICKUP_FAILED", rep.id, { returnId: record.returnId });
    notify("return_pickup_failed", `${record.returnId}: Pickup attempt failed`, rep.name, record.id);
    return record;
  }

  async function completeReturnPickup(recordId) {
    if (API_ENABLED) {
      const record = (apiWork.returns || []).find(
        (row) => String(row.id) === String(recordId),
      );
      if (!record) throw new Error("The assigned return could not be found.");
      await window.DartApi.request(
        `/api/v1/representatives/returns/${encodeURIComponent(record.returnId || record.id)}/action`,
        { method: "POST", body: { action: "complete" } },
      );
      activeReturnIds.delete(record.id);
      saveActiveIds();
      await refreshApiWork();
      return { ...record, status: "Completed", completedAt: now() };
    }
    const { rep, records, record } = assignedReturn(recordId),
      proximity = deliveryProximity(record);
    if (record.status !== "Pickup On The Way" || !record.pickupStartedAt)
      throw new Error("Start pickup before confirming it.");
    if (!proximity.ok) throw new Error(proximity.reason);
    const items = read(KEYS.items, []),
      orders = read(KEYS.orders, []),
      originalItem = items.find((item) => String(item.itemCode) === String(record.itemCode)),
      order = orders.find((row) => String(row.orderId) === String(record.orderId)),
      completedAt = now(),
      isExchange = window.DartReturns?.isExchange(record) || record.requestType === "Exchange",
      isRefund = window.DartReturns?.isRefund(record) || record.requestType === "Refund";
    if (!originalItem) throw new Error("The original physical item could not be found.");
    if (!order) throw new Error("The original delivered order could not be found.");

    const replacement = isExchange
      ? items.find((item) => String(item.itemCode) === String(record.replacementItemCode))
      : null;
    if (isExchange && !record.exchangeCompletionApplied &&
        (!replacement || String(replacement.status).toLowerCase() !== "processing/held"))
      throw new Error("The held replacement item is no longer available.");
    const cards = isRefund && order.dartCardId ? read(KEYS.cards, []) : [];
    const card = order.dartCardId
      ? cards.find((row) => String(row.cardId) === String(order.dartCardId))
      : null;
    record.completionSnapshot = window.DartReturns?.captureCompletionSnapshot?.(
      record,
      originalItem,
      replacement,
      order,
      card,
      completedAt,
    ) || null;

    originalItem.status = "Return Inspection";
    originalItem.returnRequestId = record.id;
    originalItem.exchangeChainId = record.exchangeChainId || originalItem.exchangeChainId || originalItem.itemCode;
    originalItem.updatedAt = completedAt;

    if (isRefund && !record.financialCompletionApplied) {
      const refundAmount = Math.max(0, Number(record.originalNetAmount ?? record.refundAmount) || 0);
      order.amountRefunded = Math.min(orderTotal(order), Number(order.amountRefunded || 0) + refundAmount);
      order.refundedAt = completedAt;
      order.paymentStatus = order.amountRefunded >= orderTotal(order) ? "Refunded" : "Partially Refunded";
      record.refundAmount = refundAmount;
      record.financialCompletionApplied = true;
      if (order.dartCardId && order.dartCardUsageRecorded && !record.dartCardUsageReversed) {
        if (card) {
          card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - 1));
          card.requestedProducts = (card.requestedProducts || []).filter(
            (code) => String(code) !== String(record.itemCode),
          );
          const expiry = Date.parse(card.expDate || 0);
          if (
            card.status === "Expired" &&
            Number(card.purchasedItems) < Number(card.itemLimit || card.purchasedLimit || 10) &&
            (!expiry || expiry >= Date.now())
          )
            card.status = "Active";
          record.dartCardUsageReversed = true;
          write(KEYS.cards, cards);
        }
      }
    }

    if (isExchange && !record.exchangeCompletionApplied) {
      replacement.status = "Sold";
      replacement.orderId = order.orderId;
      replacement.clientId = order.clientId;
      replacement.clientName = order.clientName;
      replacement.phone1 = order.phone1;
      replacement.phone2 = order.phone2;
      replacement.email = order.email;
      replacement.purchaseDate = new Date().toLocaleDateString("en-GB");
      replacement.exchangeChainId = record.exchangeChainId || record.itemCode;
      replacement.exchangedFromItemCode = record.itemCode;
      replacement.updatedAt = completedAt;
      const itemIndex = (order.items || []).findIndex(
        (code) => String(code) === String(record.itemCode),
      );
      if (itemIndex >= 0) order.items[itemIndex] = replacement.itemCode;
      const lineIndex = (order.priceSnapshot || []).findIndex(
        (line) => String(line.itemCode) === String(record.itemCode),
      );
      const replacementLine = {
        ...(record.replacementLineSnapshot || record.originalLineSnapshot || {}),
        itemId: replacement.id,
        itemCode: replacement.itemCode,
        modelCode: replacement.modelId,
        color: replacement.color,
        size: String(replacement.size),
        exchangedFromItemCode: record.itemCode,
        exchangeChainId: record.exchangeChainId || record.itemCode,
      };
      if (lineIndex >= 0) order.priceSnapshot[lineIndex] = replacementLine;
      else order.priceSnapshot = [...(order.priceSnapshot || []), replacementLine];
      order.exchangeHistory = order.exchangeHistory || [];
      order.exchangeHistory.push({
        returnId: record.returnId,
        fromItemCode: record.itemCode,
        toItemCode: replacement.itemCode,
        originalNetAmount: Number(record.originalNetAmount) || 0,
        completedAt,
      });
      record.exchangeCompletionApplied = true;
    }

    const previous = record.status;
    record.status = "Completed";
    record.completedAt = completedAt;
    record.updatedAt = completedAt;
    record.inspectionStatus = record.inspectionStatus || "Pending";
    record.customerCourierFeeStatus = Number(record.customerCourierFee) > 0
      ? "Collected by Representative"
      : "Not Applicable";
    record.brandCourierFeeStatus = Number(record.brandCourierFee) > 0
      ? "Paid by Dart"
      : "Not Applicable";
    activeReturnIds.delete(record.id);
    addReturnActivity(record, previous, record.status, "RETURN_PICKUP_COMPLETED", rep);
    order.activityLog = order.activityLog || [];
    order.activityLog.push({
      id: uid("EVT"),
      action: isExchange ? "EXCHANGE_COMPLETED" : "REFUND_PICKUP_COMPLETED",
      returnId: record.returnId,
      itemCode: record.itemCode,
      replacementItemCode: record.replacementItemCode || "",
      timestamp: completedAt,
      actorRole: "Representative",
      representativeId: rep.id,
    });
    write(KEYS.items, items);
    write(KEYS.orders, orders);
    write(KEYS.returns, records);
    saveActiveIds();
    audit("RETURN_PICKUP_COMPLETED", rep.id, {
      returnId: record.returnId,
      requestType: record.requestType,
      customerCourierFee: Number(record.customerCourierFee) || 0,
      brandCourierFee: Number(record.brandCourierFee) || 0,
    });
    notify("return_pickup_completed", `${record.returnId}: Pickup completed`, "Waiting for Dart item inspection.", record.id);
    return record;
  }

  function ensureLocationWatch() {
    if (!activeOrderIds.size && !activeReturnIds.size) {
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
      async (position) => {
        const rep = currentRep();
        if (API_ENABLED) {
          const currentTime = Date.now();
          if (currentTime - lastLocationSyncAt < 4000) return;
          lastLocationSyncAt = currentTime;
          try {
            const payload = await window.DartApi.request("/api/v1/representatives/location", {
              method: "PUT",
              body: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracyMeters: Number.isFinite(position.coords.accuracy)
                  ? position.coords.accuracy
                  : null,
              },
            });
            latestApiLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              updatedAt: payload.updatedAt || now(),
            };
            [...apiWork.orders, ...apiWork.returns].forEach((record) => {
              if (
                activeOrderIds.has(record.id) ||
                activeReturnIds.has(record.id) ||
                record.status === "Representative On The Way" ||
                record.status === "Pickup On The Way"
              ) record.courierLocation = latestApiLocation;
            });
            setLocationStatus(
              "Live location is being shared securely with Dart.",
              "success",
            );
            renderOrders();
          } catch (error) {
            setLocationStatus(error.message || "Could not update live location.", "error");
          }
          return;
        }
        const orders = read(KEYS.orders, []),
          records = read(KEYS.returns, []);
        let ordersChanged = false,
          returnsChanged = false;
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
            ordersChanged = true;
          }
        });
        records.forEach((record) => {
          if (
            activeReturnIds.has(record.id) &&
            (String(record.representativeId) === String(rep?.id) ||
              String(record.representativeId) === String(rep?.repId))
          ) {
            record.courierLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              updatedAt: now(),
            };
            returnsChanged = true;
          }
        });
        if (ordersChanged) write(KEYS.orders, orders);
        if (returnsChanged) write(KEYS.returns, records);
        if (ordersChanged || returnsChanged) {
          setLocationStatus(
            "Live location is being shared for the active delivery or pickup.",
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
        if (rep.mustChangePassword) {
          showAuth("change");
        } else {
          if (API_ENABLED) await refreshApiWork();
          renderOrders();
        }
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
      if (API_ENABLED) {
        try {
          const payload = await window.DartApi.request(
            "/api/v1/auth/change-temporary-password",
            { method: "POST", body: { password, confirmation: password } },
          );
          saveSession(payload.user);
          changeForm.reset();
          renderOrders();
        } catch (error) {
          setStatus(changeForm, error.message, true);
        }
        return;
      }
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
    document.getElementById("repForgotPassword").onclick = async () => {
      const identifier = prompt(
        "Enter your phone, email, Rep ID or National ID:",
      );
      if (!identifier) return;
      if (API_ENABLED) {
        await window.DartApi.request("/api/v1/auth/forgot-password", {
          method: "POST",
          body: { identifier, accountType: "representative" },
        });
        alert(
          "If the account exists, a reset request is now waiting for dashboard review.",
        );
        return;
      }
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
    document.getElementById("repLogout").onclick = async () => {
      const rep = currentRep();
      if (API_ENABLED) {
        try {
          await window.DartApi.request("/api/v1/auth/logout", { method: "POST" });
        } finally {
          apiRepresentative = null;
          sessionStorage.removeItem(API_REP_CACHE_KEY);
        }
      } else {
        if (rep) audit("REP_LOGOUT", rep.id);
        window.DartState?.remove?.(KEYS.session, { source: "rep" });
      }
      activeOrderIds.clear();
      activeReturnIds.clear();
      saveActiveIds();
      ensureLocationWatch();
      showAuth("login");
    };
    document
      .getElementById("repOrdersList")
      .addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const card = button.closest("[data-order-id]"),
          orderId = card?.dataset.orderId,
          orders = API_ENABLED ? apiWork.orders : read(KEYS.orders, []),
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
            locationPermissionBlocked = false;
            activeOrderIds.add(order.id);
            await updateOrderStatus(order.id, "Representative On The Way");
            ensureLocationWatch();
            renderOrders();
          }
          if (button.dataset.action === "complete") {
            const freshOrder = (API_ENABLED ? apiWork.orders : read(KEYS.orders, [])).find(
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
            await updateOrderStatus(freshOrder.id, "Delivered");
            renderOrders();
          }
          if (button.dataset.action === "cancel") {
            activeOrderIds.delete(order.id);
            await updateOrderStatus(order.id, "Out With Representative");
            ensureLocationWatch();
            renderOrders();
          }
        } catch (error) {
          alert(error.message);
        }
      });
    document
      .getElementById("repReturnsList")
      .addEventListener("click", async (event) => {
        const button = event.target.closest("[data-return-action]");
        if (!button) return;
        const card = button.closest("[data-return-id]"),
          recordId = card?.dataset.returnId,
          records = API_ENABLED ? apiWork.returns : read(KEYS.returns, []),
          record = records.find((row) => String(row.id) === String(recordId));
        try {
          if (!record) throw new Error("The assigned return could not be found.");
          if (button.dataset.returnAction === "start") {
            window.open(googleMapsRoute(record), "_blank", "noopener");
            locationPermissionBlocked = false;
            await startReturnPickup(record.id);
            ensureLocationWatch();
            renderOrders();
          }
          if (button.dataset.returnAction === "complete") {
            const fresh = (API_ENABLED ? apiWork.returns : read(KEYS.returns, [])).find(
              (row) => String(row.id) === String(record.id),
            );
            const proximity = deliveryProximity(fresh);
            if (!activeReturnIds.has(fresh.id) || !fresh.pickupStartedAt)
              throw new Error("Start pickup before confirming it.");
            if (!proximity.ok) throw new Error(proximity.reason);
            const fee = Number(fresh.customerCourierFee) || 0;
            const promptText = fee > 0
              ? `Confirm pickup and that ${money(fee)} was collected directly from the customer?`
              : `Confirm pickup for ${fresh.returnId}?`;
            if (!confirm(promptText)) return;
            await completeReturnPickup(fresh.id);
            renderOrders();
          }
          if (button.dataset.returnAction === "cancel") {
            if (!confirm("Record this pickup attempt as failed/cancelled?")) return;
            await cancelReturnPickup(record.id);
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
    repReturns,
    orderTotal,
    distanceKm,
    deliveryProximity,
    googleMapsRoute,
    startReturnPickup,
    cancelReturnPickup,
    completeReturnPickup,
  };

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    if (API_ENABLED) {
      try {
        const payload = await window.DartApi.request("/api/v1/representatives/me");
        saveSession(payload.user);
      } catch (error) {
        if (error.status === 401) {
          apiRepresentative = null;
          sessionStorage.removeItem(API_REP_CACHE_KEY);
        } else {
          setLocationStatus("Representative account service is temporarily unavailable.", "error");
        }
      }
    }
    const rep = currentRep();
    if (rep?.status === "Active") {
      if (rep.mustChangePassword) {
        showAuth("change");
      } else {
        if (API_ENABLED) await refreshApiWork();
        renderOrders();
      }
    } else {
      showAuth("login");
    }
    setInterval(async () => {
      if (currentRep() && !document.hidden) {
        if (API_ENABLED) {
          try {
            await refreshApiWork();
          } catch (error) {
            setLocationStatus(error.message || "Could not refresh assigned work.", "error");
          }
        }
        renderOrders();
      }
    }, 5000);
  });
  window.addEventListener("storage", (event) => {
    if ([KEYS.orders, KEYS.returns, KEYS.reps, KEYS.items].includes(event.key) && currentRep())
      renderOrders();
  });
})();


// END MODULE
