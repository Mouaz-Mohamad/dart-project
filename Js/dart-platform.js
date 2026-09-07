(function () {
  "use strict";

  const KEYS = Object.freeze({
    users: "dart_users",
    session: "dart_session",
    customers: "dart_customers",
    models: "dart_models",
    items: "dart_items",
    orders: "dart_orders",
    returns: "dart_returns",
    reviews: "dart_reviews",
    contacts: "dart_contact_messages",
    audit: "dart_audit",
    notifications: "dart_notifications",
    counters: "dart_platform_counters",
    catalogSeed: "dart_catalog_seed_v4",
    resetMarker: "dart_demo_reset_2026_09_05",
    passwordResets: "dart_password_reset_requests",
    representatives: "dart_representatives",
    repSession: "dart_rep_session",
  });
  const API_BASE = String(window.DART_API_BASE_URL || "").replace(/\/$/, "");
  const CART_RESERVATION_MS = 15 * 60 * 1000;

  const read = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    if ([KEYS.items, KEYS.models].includes(key))
      window.dispatchEvent(
        new CustomEvent("dart:data-changed", { detail: { key } }),
      );
  };
  const now = () => new Date().toISOString();
  const uid = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const CART_RESERVATION_ID =
    sessionStorage.getItem("dart_cart_reservation_id") || uid("CART");
  sessionStorage.setItem("dart_cart_reservation_id", CART_RESERVATION_ID);
  sessionStorage.removeItem("dart_internal_navigation");
  const normalizeEmail = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const normalizePhone = (value) => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("0020")) digits = digits.slice(2);
    if (digits.startsWith("20")) return `+${digits}`;
    if (digits.startsWith("0")) return `+20${digits.slice(1)}`;
    return digits ? `+20${digits}` : "";
  };
  const displayPhone = (value) => normalizePhone(value).replace(/^\+20/, "0");
  const escapeHtml = (value) =>
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
  const dateGB = (value) =>
    new Date(value || Date.now()).toLocaleDateString("en-GB");
  const money = (value) => `${Math.trunc(Number(value) || 0)} EGP`;
  const orderNet = (order) =>
    Number.isFinite(Number(order?.finalAmount))
      ? Math.max(0, Number(order.finalAmount))
      : Math.max(
          0,
          Number(order?.totalPrice || 0) -
            (Number(order?.orderLevelDiscountAmount) ||
              (Number(order?.totalPrice || 0) * Number(order?.discount || 0)) /
                100),
        );
  const getProducts = () => DartCatalog.products();

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }

  async function apiRequest(path, options = {}) {
    if (!API_BASE)
      throw Object.assign(new Error("API_NOT_CONFIGURED"), {
        code: "API_NOT_CONFIGURED",
      });
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      body:
        options.body && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(new Error(payload.message || "Request failed"), {
        status: response.status,
        payload,
      });
    return payload;
  }

  function nextCode(prefix, collection, field) {
    const counters = read(KEYS.counters, {});
    const existing = collection.reduce((max, row) => {
      const match = String(row[field] || "").match(
        new RegExp(`^${prefix}-(\\d+)$`, "i"),
      );
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0);
    counters[prefix] = Math.max(Number(counters[prefix]) || 0, existing) + 1;
    write(KEYS.counters, counters);
    return `${prefix}-${counters[prefix]}`;
  }

  function audit(action, entityType, entityId, details = {}) {
    const rows = read(KEYS.audit, []);
    const session = currentSession();
    rows.unshift({
      id: uid("AUD"),
      action,
      entityType,
      entityId: String(entityId),
      details,
      timestamp: now(),
      actorId: session?.userId || null,
      actorRole: session ? "Customer" : "Guest",
    });
    write(KEYS.audit, rows.slice(0, 2000));
  }

  function notify(type, title, message, entityType, entityId) {
    const rows = read(KEYS.notifications, []);
    rows.unshift({
      id: uid("NOT"),
      type,
      title,
      message,
      timestamp: now(),
      relatedEntityType: entityType,
      relatedEntityId: String(entityId),
      read: false,
      resolved: false,
    });
    write(KEYS.notifications, rows.slice(0, 500));
  }

  function currentSession() {
    const session = read(KEYS.session, null);
    if (
      !session ||
      !session.userId ||
      new Date(session.expiresAt) <= new Date()
    ) {
      localStorage.removeItem(KEYS.session);
      return null;
    }
    return session;
  }

  function currentUser() {
    const session = currentSession();
    return session
      ? read(KEYS.users, []).find(
          (user) => user.id === session.userId && !user.isArchived,
        ) || null
      : null;
  }

  function identityConflict({ email, phone1, phone2 }, excludeUserId = null) {
    const normalized = [
      normalizeEmail(email),
      normalizePhone(phone1),
      normalizePhone(phone2),
    ].filter(Boolean);
    if (new Set(normalized).size !== normalized.length)
      return "لا يمكن استخدام الرقم نفسه في خانتي الهاتف.";
    const users = read(KEYS.users, []).filter(
      (user) => user.id !== excludeUserId && !user.isArchived,
    );
    const customers = read(KEYS.customers, []).filter(
      (customer) =>
        customer.userId !== excludeUserId &&
        !customer.isArchived &&
        !customer.isDeleted,
    );
    for (const user of users) {
      const identities = [
        normalizeEmail(user.email),
        normalizePhone(user.phone1),
        normalizePhone(user.phone2),
      ].filter(Boolean);
      if (normalized.some((value) => identities.includes(value)))
        return "البريد الإلكتروني أو رقم الهاتف مستخدم في حساب آخر.";
    }
    for (const customer of customers) {
      const identities = [
        normalizeEmail(customer.email),
        normalizePhone(customer.phone1),
        normalizePhone(customer.phone2),
      ].filter(Boolean);
      if (normalized.some((value) => identities.includes(value)))
        return "البريد الإلكتروني أو رقم الهاتف مسجل بالفعل لعميل آخر.";
    }
    return "";
  }

  function syncCustomer(user) {
    const customers = read(KEYS.customers, []);
    let customer = customers.find(
      (row) => row.userId === user.id || row.clientId === user.customerId,
    );
    const payload = {
      userId: user.id,
      clientId: user.customerId,
      clientName: user.name,
      birthday: user.birthday || "-",
      phone1: displayPhone(user.phone1),
      phone2: user.phone2 ? displayPhone(user.phone2) : "-",
      email: user.email,
      country: user.country || "Egypt",
      governorate: user.governorate || "",
      dartCard: user.dartCard || "no",
      isArchived: false,
      isDeleted: false,
      isChecked: false,
    };
    if (customer) Object.assign(customer, payload);
    else {
      customer = { id: uid("CDB"), registeredAt: now(), ...payload };
      customers.push(customer);
    }
    write(KEYS.customers, customers);
    return customer;
  }

  async function register(payload) {
    const users = read(KEYS.users, []);
    const email = normalizeEmail(payload.email),
      phone1 = normalizePhone(payload.phone1),
      phone2 = normalizePhone(payload.phone2);
    if (!payload.name || payload.name.trim().length < 3)
      throw new Error("اكتب الاسم الكامل بصورة صحيحة.");
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new Error("البريد الإلكتروني غير صحيح.");
    if (!/^\+201[0125]\d{8}$/.test(phone1))
      throw new Error("رقم الهاتف المصري غير صحيح.");
    if (phone2 && !/^\+201[0125]\d{8}$/.test(phone2))
      throw new Error("رقم الهاتف الثاني غير صحيح.");
    if (String(payload.password || "").length < 8)
      throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    const conflict = identityConflict({ email, phone1, phone2 });
    if (conflict) throw new Error(conflict);
    const customerId = nextCode("DA", read(KEYS.customers, []), "clientId");
    const user = {
      id: uid("USR"),
      customerId,
      name: payload.name.trim(),
      email,
      phone1,
      phone2,
      birthday: payload.birthday || "",
      passwordHash: await sha256(payload.password),
      createdAt: now(),
      emailVerified: false,
      phoneVerified: false,
      dartCard: "no",
      role: "Customer",
      isArchived: false,
    };
    users.push(user);
    write(KEYS.users, users);
    syncCustomer(user);
    const session = {
      userId: user.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    };
    write(KEYS.session, session);
    audit("REGISTER", "customers", user.customerId);
    return user;
  }

  async function login(identifier, password) {
    const keyEmail = normalizeEmail(identifier),
      keyPhone = normalizePhone(identifier),
      keyName = String(identifier || "")
        .trim()
        .toLowerCase();
    const hash = await sha256(password);
    const user = read(KEYS.users, []).find(
      (row) =>
        !row.isArchived &&
        (normalizeEmail(row.email) === keyEmail ||
          normalizePhone(row.phone1) === keyPhone ||
          normalizePhone(row.phone2) === keyPhone ||
          String(row.name).trim().toLowerCase() === keyName),
    );
    if (!user || user.passwordHash !== hash)
      throw new Error("بيانات الدخول غير صحيحة.");
    write(KEYS.session, {
      userId: user.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    audit("LOGIN", "customers", user.customerId);
    return user;
  }

  function requestPasswordReset(identifier) {
    const input = String(identifier || "").trim(),
      email = normalizeEmail(input),
      phone = normalizePhone(input);
    const user = read(KEYS.users, []).find(
      (row) =>
        !row.isArchived &&
        (normalizeEmail(row.email) === email ||
          normalizePhone(row.phone1) === phone ||
          normalizePhone(row.phone2) === phone ||
          String(row.customerId).toLowerCase() === input.toLowerCase()),
    );
    if (user) {
      const requests = read(KEYS.passwordResets, []);
      if (
        !requests.some(
          (row) =>
            row.status === "Pending" &&
            row.accountType === "Customer" &&
            row.accountId === user.id,
        )
      ) {
        requests.unshift({
          id: uid("PWR"),
          accountType: "Customer",
          accountId: user.id,
          identifier: input,
          displayName: user.name,
          status: "Pending",
          createdAt: now(),
          source: "Customer Login",
        });
        write(KEYS.passwordResets, requests);
        notify(
          "password_reset",
          "Customer password reset request",
          `${user.customerId} requested a temporary password.`,
          "customers",
          user.customerId,
        );
      }
    }
    return true;
  }

  async function replaceTemporaryPassword(password, confirmation) {
    const user = currentUser();
    if (!user) throw new Error("Your login session has expired.");
    if (String(password || "").length < 8)
      throw new Error("Password must be at least 8 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    const users = read(KEYS.users, []),
      stored = users.find((row) => row.id === user.id);
    stored.passwordHash = await sha256(password);
    stored.mustChangePassword = false;
    stored.passwordUpdatedAt = now();
    write(KEYS.users, users);
    audit("PASSWORD_CHANGED", "customers", stored.customerId);
    return stored;
  }

  function logout() {
    const user = currentUser();
    if (user) audit("LOGOUT", "customers", user.customerId);
    localStorage.removeItem(KEYS.session);
  }

  function resetLocalDemoDataOnce() {
    /* No demo seeding: owner requested an empty dashboard. */
  }

  function ensureCatalogInventory() {
    /* Inventory is created only through Add Item. */
  }

  function getCheckoutField(form, name) {
    return form.elements.namedItem(name)?.value?.trim() || "";
  }

  function deliveryGovernorate(value) {
    const normalized = String(value || "")
      .trim()
      .toLocaleLowerCase();
    if (
      [
        "cairo",
        "cairo governorate",
        "al qahirah",
        "القاهرة",
        "محافظة القاهرة",
      ].includes(normalized)
    )
      return "Cairo";
    if (
      [
        "giza",
        "giza governorate",
        "al jizah",
        "الجيزة",
        "محافظة الجيزة",
      ].includes(normalized)
    )
      return "Giza";
    return "";
  }

  async function checkout(form) {
    cleanupCartReservations();
    const cart =
      typeof cartData !== "undefined" ? cartData : read("dart_cart", []);
    if (!cart.length) throw new Error("السلة فارغة.");
    const logged = currentUser();
    const details = {
      name: getCheckoutField(form, "customer_name") || logged?.name || "",
      phone1: getCheckoutField(form, "phone1") || displayPhone(logged?.phone1),
      phone2: getCheckoutField(form, "phone2") || displayPhone(logged?.phone2),
      email: getCheckoutField(form, "email") || logged?.email || "",
      country: getCheckoutField(form, "country") || "Egypt",
      governorate: getCheckoutField(form, "governorate"),
      area: getCheckoutField(form, "area"),
      street: getCheckoutField(form, "street"),
      building: getCheckoutField(form, "building"),
      floor: getCheckoutField(form, "floor"),
      deliveryNotes: getCheckoutField(form, "delivery_notes"),
      latitude: getCheckoutField(form, "latitude"),
      longitude: getCheckoutField(form, "longitude"),
      fullAddress:
        getCheckoutField(form, "full_address") ||
        getCheckoutField(form, "address_search"),
    };
    if (!details.name || !details.phone1)
      throw new Error("Complete your name and phone number.");
    const addressValidation = window.dartCheckoutAddress?.validate?.();
    if (addressValidation && !addressValidation.ok)
      throw new Error(addressValidation.message);
    if (
      !details.country ||
      !details.governorate ||
      !details.area ||
      !details.street ||
      !details.building ||
      !details.floor
    ) {
      throw new Error(
        "Complete country, governorate, area, street, building number/name and floor.",
      );
    }
    if (!details.latitude || !details.longitude)
      throw new Error(
        "Select the location on the map or locate the manually entered address.",
      );
    const acceptedGovernorate = deliveryGovernorate(details.governorate);
    if (!acceptedGovernorate || addressValidation?.zone !== "cairo-giza")
      throw new Error(
        "Delivery is currently available in Cairo and Giza only. Verify the address on the map.",
      );
    details.country = "Egypt";
    details.governorate = acceptedGovernorate;
    let customer;
    if (logged) customer = syncCustomer(logged);
    else {
      const customers = read(KEYS.customers, []),
        email = normalizeEmail(details.email),
        phone = normalizePhone(details.phone1);
      const emailCustomer =
        email && customers.find((row) => normalizeEmail(row.email) === email);
      const phoneCustomer =
        phone &&
        customers.find((row) =>
          [normalizePhone(row.phone1), normalizePhone(row.phone2)].includes(
            phone,
          ),
        );
      if (
        emailCustomer &&
        phoneCustomer &&
        emailCustomer.id !== phoneCustomer.id
      )
        throw new Error(
          "البريد والهاتف مرتبطان بعميلين مختلفين. راجع خدمة العملاء.",
        );
      customer = emailCustomer || phoneCustomer;
      if (!customer) {
        customer = {
          id: uid("CDB"),
          clientId: nextCode("DA", customers, "clientId"),
          clientName: details.name,
          phone1: displayPhone(phone),
          phone2: details.phone2 || "-",
          email,
          birthday: "-",
          country: details.country,
          governorate: details.governorate,
          dartCard: "no",
          registeredAt: now(),
          isArchived: false,
          isDeleted: false,
          isChecked: false,
        };
        customers.push(customer);
        write(KEYS.customers, customers);
      }
    }
    const items = read(KEYS.items, []),
      allocations = [],
      snapshots = [];
    for (const line of cart) {
      const product = getProducts().find(
        (row) => String(row.id) === String(line.id),
      );
      if (!product) throw new Error(`المنتج ${line.title} لم يعد متاحًا.`);
      if (Number(line.price) !== Number(product.price)) {
        line.price = product.price;
        write("dart_cart", cart);
        if (typeof renderCart === "function") renderCart();
        throw new Error(
          "تغيّر سعر المنتج. راجع إجمالي السلة ثم أكّد الطلب مجددًا.",
        );
      }
      if (
        !DartCatalog.colors(DartCatalog.model(product.code)).some(
          (c) => DartCatalog.active(c) && c.name === line.color,
        ) ||
        !DartCatalog.sizes(DartCatalog.model(product.code)).some(
          (s) => DartCatalog.active(s) && s.name === String(line.size),
        )
      )
        throw new Error("هذا اللون أو المقاس لم يعد متاحًا.");
      const available = items.filter(
        (item) =>
          item.modelId === product.code &&
          String(item.size) === String(line.size) &&
          item.color === line.color &&
          (String(item.status).toLowerCase() === "in stock" ||
            (String(item.status).toLowerCase() === "cart reserved" &&
              item.cartReservationId === CART_RESERVATION_ID)) &&
          !item.isArchived &&
          !item.isDeleted &&
          !allocations.includes(item),
      );
      if (available.length < Number(line.quantity))
        throw new Error(`الكمية المتاحة من ${line.title} أقل من المطلوبة.`);
      for (let i = 0; i < Number(line.quantity); i += 1) {
        allocations.push(available[i]);
        snapshots.push(
          DartCatalog.snapshot(DartCatalog.model(product.code), available[i]),
        );
      }
    }
    const orders = read(KEYS.orders, []),
      orderId = nextCode("K", orders, "orderId");
    const subtotal = snapshots.reduce(
      (sum, line) => sum + line.finalUnitPrice,
      0,
    );
    let discountRate = Math.max(
      0,
      Math.min(
        0.4,
        typeof appliedDiscountRate !== "undefined"
          ? Number(appliedDiscountRate) || 0
          : 0,
      ),
    );
    let appliedCard = window.dartAppliedPromotion?.cardId
      ? read("dart_cards", []).find(
          (card) => card.cardId === window.dartAppliedPromotion.cardId,
        )
      : null;
    if (appliedCard) {
      const parts = String(appliedCard.expDate || "")
          .split(/[-/]/)
          .map(Number),
        expiry =
          parts.length === 3
            ? parts[0] > 999
              ? new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59)
              : new Date(parts[2], parts[1] - 1, parts[0], 23, 59, 59)
            : null,
        remaining =
          Number(appliedCard.itemLimit || appliedCard.purchasedLimit || 10) -
          Number(appliedCard.purchasedItems || 0);
      if (
        appliedCard.status !== "Active" ||
        appliedCard.clientId !== customer.clientId ||
        remaining < allocations.length ||
        (expiry && expiry < Date.now())
      ) {
        appliedCard = null;
        discountRate = 0;
      }
    }
    const discountAmount = subtotal * discountRate;
    const finalAmount = Math.max(0, subtotal - discountAmount);
    const order = {
      id: uid("ODB"),
      orderId,
      date: dateGB(),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "New",
      createdAt: now(),
      orderCreatedAt: now(),
      clientId: customer.clientId,
      clientName: details.name,
      phone1: displayPhone(details.phone1),
      phone2: details.phone2 || "-",
      email: normalizeEmail(details.email),
      items: allocations.map((item) => item.itemCode),
      totalProducts: allocations.length,
      priceSnapshot: snapshots,
      totalPrice: subtotal,
      discount: discountRate * 100,
      orderLevelDiscountAmount: discountAmount,
      finalAmount,
      reasonDeduction: discountRate ? "Verified promotion" : "-",
      dartCardId: appliedCard?.cardId || "",
      paymentMethod: "Cash on Delivery",
      paymentStatus: "Unpaid",
      amountPaid: 0,
      amountRefunded: 0,
      orderSource: "Website",
      deliveryNotes: details.deliveryNotes,
      country: details.country,
      governorate: details.governorate,
      area: details.area,
      street: details.street,
      building: details.building,
      floor: details.floor,
      latitude: details.latitude,
      longitude: details.longitude,
      fullAddress: details.fullAddress,
      addressSource:
        addressValidation?.source || form.dataset.dartAddressSource || "map",
      activityLog: [
        {
          id: uid("EVT"),
          action: "ORDER_CREATED",
          fromStatus: null,
          toStatus: "New",
          timestamp: now(),
          actorRole: "Customer",
        },
      ],
      isArchived: false,
      isDeleted: false,
      isChecked: false,
    };
    allocations.forEach((item) => {
      item.status = "Processing/Held";
      item.orderId = orderId;
      item.clientId = customer.clientId;
      item.clientName = details.name;
      item.phone1 = order.phone1;
      item.phone2 = order.phone2;
      item.email = order.email;
      delete item.cartReservationId;
      delete item.reservationUntil;
    });
    orders.push(order);
    write(KEYS.items, items);
    write(KEYS.orders, orders);
    audit("CREATE", "orders", order.id, { source: "Website" });
    notify(
      "new_order",
      `New order ${orderId}`,
      `${details.name} — ${allocations.length} item(s)`,
      "orders",
      order.id,
    );
    if (typeof cartData !== "undefined") cartData = [];
    write("dart_cart", []);
    window.dartAppliedPromotion = null;
    return order;
  }

  function setStatus(element, message, error = false) {
    let status = element.querySelector(".form-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "form-status";
      status.setAttribute("role", "status");
      element.appendChild(status);
    }
    status.textContent = message;
    status.classList.toggle("is-error", error);
    status.classList.toggle("is-success", !error);
  }

  function releaseCartReservation(clearCart = true) {
    const items = read(KEYS.items, []);
    let changed = false;
    items.forEach((item) => {
      if (
        item.cartReservationId === CART_RESERVATION_ID &&
        String(item.status).toLowerCase() === "cart reserved"
      ) {
        item.status = "In stock";
        delete item.cartReservationId;
        delete item.reservationUntil;
        changed = true;
      }
    });
    if (changed) write(KEYS.items, items);
    if (clearCart) {
      write("dart_cart", []);
      if (typeof cartData !== "undefined") cartData = [];
    }
  }

  function cleanupCartReservations() {
    const items = read(KEYS.items, []),
      time = Date.now();
    let changed = false;
    items.forEach((item) => {
      if (
        String(item.status).toLowerCase() === "cart reserved" &&
        new Date(item.reservationUntil || 0).getTime() <= time
      ) {
        item.status = "In stock";
        delete item.cartReservationId;
        delete item.reservationUntil;
        changed = true;
      }
    });
    if (changed) write(KEYS.items, items);
    const cart = read("dart_cart", []),
      expires = Math.max(
        0,
        ...cart.map((line) => new Date(line.reservationUntil || 0).getTime()),
      );
    if (cart.length && expires <= time) {
      write("dart_cart", []);
      if (typeof cartData !== "undefined") cartData = [];
      if (typeof renderCart === "function") renderCart();
      if (typeof updateCartCount === "function") updateCartCount();
      window.dispatchEvent(
        new CustomEvent("dart:cart-reservation-expired", {
          detail: { releasedItems: cart.length },
        }),
      );
    }
  }

  function updateCartReservationTimer() {
    const timer = document.getElementById("cartReservationTimer");
    if (!timer) return;
    const cart = read("dart_cart", []);
    const expires = Math.max(
      0,
      ...cart.map((line) => new Date(line.reservationUntil || 0).getTime()),
    );
    const remaining = expires - Date.now();
    if (!cart.length || remaining <= 0) {
      timer.hidden = true;
      if (cart.length) cleanupCartReservations();
      return;
    }
    const minutes = Math.floor(remaining / 60000),
      seconds = Math.floor((remaining % 60000) / 1000);
    timer.hidden = false;
    timer.textContent = `القطع محجوزة لمدة ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function reserveCart(cart) {
    cleanupCartReservations();
    const items = read(KEYS.items, []),
      expiresAt = new Date(Date.now() + CART_RESERVATION_MS).toISOString(),
      selected = [];
    items.forEach((item) => {
      if (
        item.cartReservationId === CART_RESERVATION_ID &&
        String(item.status).toLowerCase() === "cart reserved"
      ) {
        item.status = "In stock";
        delete item.cartReservationId;
        delete item.reservationUntil;
      }
    });
    for (const line of cart) {
      if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1)
        throw new Error("Invalid quantity.");
      const product = getProducts().find(
        (row) => String(row.id) === String(line.id),
      );
      if (!product) throw new Error("أحد المنتجات لم يعد متاحًا.");
      if (
        !DartCatalog.colors(DartCatalog.model(product.code)).some(
          (c) => DartCatalog.active(c) && c.name === line.color,
        ) ||
        !DartCatalog.sizes(DartCatalog.model(product.code)).some(
          (s) => DartCatalog.active(s) && s.name === String(line.size),
        )
      )
        throw new Error("اللون أو المقاس غير متاح.");
      const available = items.filter(
        (item) =>
          item.modelId === product.code &&
          String(item.size) === String(line.size) &&
          item.color === line.color &&
          String(item.status).toLowerCase() === "in stock" &&
          !item.isArchived &&
          !item.isDeleted &&
          !selected.includes(item),
      );
      if (available.length < Number(line.quantity))
        throw new Error(`المتاح من ${line.title} أقل من الكمية المطلوبة.`);
      selected.push(...available.slice(0, Number(line.quantity)));
    }
    selected.forEach((item) => {
      item.status = "Cart Reserved";
      item.cartReservationId = CART_RESERVATION_ID;
      item.reservationUntil = expiresAt;
    });
    cart.forEach((line) => {
      line.reservationId = CART_RESERVATION_ID;
      line.reservationUntil = expiresAt;
    });
    write(KEYS.items, items);
    write("dart_cart", cart);
    return { expiresAt };
  }

  function renderFeedbackEligibility() {
    const section = document.querySelector(".feedback-section");
    if (!section || section.dataset.eligibilityRendered) return;
    const user = currentUser(),
      eligible =
        user &&
        read(KEYS.orders, []).some(
          (order) =>
            order.clientId === user.customerId && order.status === "Delivered",
        );
    if (eligible) {
      section.dataset.eligibilityRendered = "1";
      const form = section.querySelector("#reviewForm");
      if (form) {
        form.elements.full_name.value = user.name;
        form.elements.phone1.value = displayPhone(user.phone1);
        form.elements.phone2.value = displayPhone(user.phone2);
        form.elements.email.value = user.email;
        ["full_name", "phone1", "phone2", "email"].forEach((name) => {
          const field = form.elements[name];
          if (field) field.readOnly = true;
        });
      }
      return;
    }
    section.dataset.eligibilityRendered = "1";
    const form = section.querySelector("#reviewForm");
    if (form) form.hidden = true;
    section.insertAdjacentHTML(
      "beforeend",
      '<div class="feedback-access-message"><i class="fa-solid fa-bag-shopping"></i><h2>شارك تجربتك بعد استلام طلبك الأول</h2><p>قم بطلب قطعة من Dart، وبعد تسليم الطلب ستتمكن من إرسال تقييمك.</p><a href="products.html" class="submit-btn-form">عرض المنتجات</a></div>',
    );
  }

  function renderLeaderboard() {
    const list = document.querySelector(".leaderboard-list");
    if (
      !list ||
      list.dataset.dartRenderedAt === new Date().toISOString().slice(0, 13)
    )
      return;
    const customers = read(KEYS.customers, []).filter(
      (customer) => !customer.isArchived && !customer.isDeleted,
    );
    const orders = read(KEYS.orders, []),
      cards = read("dart_cards", []),
      today = new Date();
    const excluded = new Set(
      cards
        .filter((card) => card.status === "Active")
        .map((card) => String(card.clientId)),
    );
    const candidates = customers
      .filter((customer) => !excluded.has(String(customer.clientId)))
      .map((customer) => {
        const delivered = orders
          .filter(
            (order) =>
              order.clientId === customer.clientId &&
              order.status === "Delivered",
          )
          .filter((order) => {
            const date = new Date(order.deliveredAt || order.createdAt || 0);
            return (
              date.getFullYear() === today.getFullYear() &&
              date.getMonth() === today.getMonth()
            );
          });
        return {
          customer,
          orders: delivered.length,
          items: delivered.reduce(
            (sum, order) =>
              sum + Number(order.totalProducts || order.items?.length || 0),
            0,
          ),
          spent: delivered.reduce((sum, order) => sum + orderNet(order), 0),
        };
      })
      .filter((row) => row.orders > 0)
      .sort(
        (a, b) => b.orders - a.orders || b.items - a.items || b.spent - a.spent,
      );
    const rows = candidates.slice(0, 3);
    if (!rows.length) {
      list.dataset.dartRenderedAt = new Date().toISOString().slice(0, 13);
      return;
    }
    const heading =
      list.querySelector("h1")?.outerHTML ||
      "<h1>Contenders for the DART card</h1>";
    list.innerHTML =
      heading +
      rows
        .map(
          (row, index) =>
            `<li class="leaderboard-item djasb ${index === 0 ? "top-rank" : ""}"><div class="rank-badge"><h2 class="rank-num">${index + 1}</h2></div><h3 class="user-name">${escapeHtml(publicCustomerName(row.customer.clientName))}</h3><h3 class="score">${row.items} PIC</h3></li>`,
        )
        .join("");
    list.dataset.dartRenderedAt = new Date().toISOString().slice(0, 13);
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString("en-GB");
  }
  function profileField(label, value) {
    return `<div class="profile-record-field"><small>${escapeHtml(label)}</small><span>${escapeHtml(value ?? "-")}</span></div>`;
  }

  function recordDartCardUsage(order) {
    if (!order.dartCardId || order.dartCardUsageRecorded) return;
    const cards = read("dart_cards", []),
      card = cards.find(
        (row) => row.cardId === order.dartCardId && row.status === "Active",
      );
    if (!card) return;
    card.purchasedItems = String(
      Number(card.purchasedItems || 0) +
        Number(order.totalProducts || order.items?.length || 0),
    );
    card.requestedProducts = [
      ...new Set([...(card.requestedProducts || []), ...(order.items || [])]),
    ];
    if (
      Number(card.purchasedItems) >=
      Number(card.itemLimit || card.purchasedLimit || 10)
    )
      card.status = "Expired";
    order.dartCardUsageRecorded = true;
    write("dart_cards", cards);
  }

  function publicCustomerName(value) {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "Not disclosed";
    return parts.length === 1
      ? parts[0]
      : `${parts[0]} ${parts[1].charAt(0)}***`;
  }

  function renderSerialResult(form) {
    const result = document.getElementById("serialSearchResult");
    if (!result) return;
    const content = result.querySelector(".serial-result-content");
    if (!content) return;
    const code = String(form.elements.serial_number?.value || "")
      .trim()
      .toLowerCase();
    const items = read(KEYS.items, []),
      item = items.find(
        (row) =>
          String(row.itemCode || "")
            .trim()
            .toLowerCase() === code &&
          !row.isDeleted &&
          String(row.status || "").toLowerCase() === "sold" &&
          (row.clientId || row.clientName),
      );
    result.hidden = false;
    result.classList.toggle("is-authentic", Boolean(item));
    result.classList.toggle("is-missing", !item);
    if (!item) {
      content.innerHTML =
        '<div class="serial-result-icon"><i class="fa-solid fa-xmark"></i></div><h2 id="serialResultTitle">Item Not Found</h2><p>This code does not match a sold item in the official Dart registry.</p>';
      return;
    }
    const owner =
      item.clientName ||
      read(KEYS.customers, []).find(
        (row) => String(row.clientId) === String(item.clientId),
      )?.clientName;
    content.innerHTML = `<div class="serial-result-icon"><i class="fa-solid fa-check"></i></div><h2 id="serialResultTitle">Authentic Dart Item</h2><p>This sold item is verified in the official Dart registry.</p><div class="serial-owner">Registered owner: ${escapeHtml(publicCustomerName(owner))}</div>`;
  }

  function bindAuth() {
    document.addEventListener(
      "submit",
      async (event) => {
        const form = event.target;
        if (form.id === "serialSearchForm") {
          event.preventDefault();
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }
          renderSerialResult(form);
          return;
        }
        if (
          [
            "registerForm",
            "loginForm",
            "checkoutForm",
            "contactForm",
            "reviewForm",
            "returnRequestForm",
          ].includes(form.id) &&
          !form.checkValidity()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          form.reportValidity();
          return;
        }
        if (form.id === "registerForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await register(Object.fromEntries(new FormData(form)));
            setStatus(form, "تم إنشاء الحساب بنجاح.");
            setTimeout(() => location.assign("profile.html"), 450);
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "loginForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            const user = await login(
              form.elements.identifier.value,
              form.elements.password.value,
            );
            setStatus(form, "تم تسجيل الدخول بنجاح.");
            if (user.mustChangePassword) {
              const dialog = document.getElementById("customerPasswordChange");
              if (dialog) dialog.hidden = false;
            } else setTimeout(() => location.assign("profile.html"), 350);
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "customerChangePasswordForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await replaceTemporaryPassword(
              form.elements.password.value,
              form.elements.confirmPassword.value,
            );
            setStatus(form, "Password changed successfully.");
            setTimeout(() => location.assign("profile.html"), 400);
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "checkoutForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            const order = await checkout(form);
            if (typeof showToast === "function")
              showToast(`تم إنشاء الطلب ${order.orderId} بنجاح.`);
            setTimeout(() => location.assign("index.html"), 700);
          } catch (error) {
            if (typeof showToast === "function") showToast(error.message);
            else setStatus(form, error.message, true);
          }
        } else if (form.id === "contactForm") {
          event.preventDefault();
          // BEGIN Contact Us -> dashboard Review inbox.
          // BACKEND: create this record through one authenticated/admin-readable inbox endpoint.
          const values = Object.fromEntries(new FormData(form));
          const customers = read(KEYS.customers, []);
          const customer = customers.find(
            (row) =>
              normalizeEmail(row.email) === normalizeEmail(values.email) ||
              normalizePhone(row.phone1) === normalizePhone(values.phone1) ||
              normalizePhone(row.phone2) === normalizePhone(values.phone1),
          );
          const rows = read(KEYS.reviews, []);
          const message = {
            id: uid("MSG"),
            source: "Contact Us",
            recordType: "contact",
            clientId: customer?.clientId || "-",
            clientName: values.full_name || customer?.clientName || "-",
            rating: "-",
            title: "-",
            review: values.message || "-",
            phone1: displayPhone(values.phone1) || "-",
            phone2: displayPhone(values.phone2) || "-",
            email: normalizeEmail(values.email) || "-",
            status: "-",
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          };
          rows.unshift(message);
          write(KEYS.reviews, rows);
          audit("CREATE", "contact", message.id, { source: "Contact Us" });
          form.reset();
          setStatus(form, "تم استلام رسالتك وسنتواصل معك.");
          // END Contact Us -> dashboard Review inbox.
        } else if (form.id === "reviewForm") {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(form)),
            user = currentUser(),
            orders = read(KEYS.orders, []);
          const eligible =
            user &&
            orders.some(
              (o) => o.clientId === user.customerId && o.status === "Delivered",
            );
          if (!eligible) {
            setStatus(form, "يمكنك إرسال تقييم بعد استلام طلبك الأول.", true);
            return;
          }
          const rows = read(KEYS.reviews, []);
          rows.unshift({
            id: uid("REV"),
            source: "Review",
            recordType: "review",
            clientId: user.customerId,
            clientName: user.name,
            rating: Number(values.rating),
            title: values.title,
            review: values.review,
            phone1: displayPhone(user.phone1),
            phone2: displayPhone(user.phone2) || "-",
            email: user.email,
            status: "Pending",
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          });
          write(KEYS.reviews, rows);
          form.reset();
          form.elements.full_name.value = user.name;
          form.elements.phone1.value = displayPhone(user.phone1);
          form.elements.phone2.value = displayPhone(user.phone2);
          form.elements.email.value = user.email;
          setStatus(form, "تم إرسال التقييم للمراجعة.");
        } else if (form.id === "returnRequestForm") {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(form)),
            orders = read(KEYS.orders, []);
          const order = orders.find(
            (o) =>
              o.status === "Delivered" &&
              (o.items || []).includes(values.item_code),
          );
          const identityOk =
            order &&
            (normalizeEmail(order.email) === normalizeEmail(values.email) ||
              normalizePhone(order.phone1) === normalizePhone(values.phone1));
          const deliveredAt =
            order &&
            new Date(order.deliveredAt || order.updatedAt || order.createdAt);
          const within =
            deliveredAt &&
            !Number.isNaN(deliveredAt.getTime()) &&
            Date.now() - deliveredAt.getTime() <= 14 * 864e5;
          if (!order || !identityOk || !within) {
            setStatus(
              form,
              "القطعة غير مؤهلة: يلزم طلب مستلم لنفس العميل وخلال 14 يومًا.",
              true,
            );
            return;
          }
          const rows = read(KEYS.returns, []);
          if (
            rows.some(
              (r) =>
                r.itemCode === values.item_code &&
                !["Rejected", "Closed"].includes(r.status),
            )
          ) {
            setStatus(form, "يوجد طلب قائم لهذه القطعة بالفعل.", true);
            return;
          }
          const row = {
            id: uid("RETDB"),
            returnId: nextCode("R", rows, "returnId"),
            orderId: order.orderId,
            clientId: order.clientId,
            clientName: values.full_name,
            itemCode: values.item_code,
            modelId: values.model_code,
            phone1: values.phone1,
            phone2: values.phone2 || "-",
            email: normalizeEmail(values.email),
            requestType: values.request_type,
            reason: values.reason,
            status: "Pending Request",
            notes: values.notes || "",
            isPostDeliveryReturn: true,
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          };
          rows.push(row);
          write(KEYS.returns, rows);
          notify(
            "return_created",
            `Return ${row.returnId}`,
            `${row.itemCode} requested by customer.`,
            "returns",
            row.id,
          );
          form.reset();
          setStatus(form, `تم إنشاء الطلب ${row.returnId}.`);
        }
      },
      true,
    );

    document.addEventListener("click", (event) => {
      const forgot = event.target.closest("[data-forgot-password]");
      if (forgot) {
        event.preventDefault();
        const identifier = prompt(
          "Enter your email, phone number or customer ID:",
        );
        if (!identifier) return;
        if (API_BASE) {
          apiRequest("/api/v1/auth/forgot-password", {
            method: "POST",
            body: { identifier },
          })
            .then(() =>
              alert(
                "If the account exists, reset instructions have been created.",
              ),
            )
            .catch((error) => alert(error.message));
        } else {
          requestPasswordReset(identifier);
          alert(
            "If the account exists, a reset request is now waiting for dashboard review.",
          );
        }
      }
      const social = event.target.closest("[data-social-login]");
      if (social) {
        event.preventDefault();
        alert("تسجيل الدخول الاجتماعي غير مفعّل حاليًا.");
      }
      const serialClose = event.target.closest(".serial-result-close");
      if (serialClose) {
        document.getElementById("serialSearchResult").hidden = true;
      }
      if (event.target.id === "serialSearchResult") event.target.hidden = true;
    });
  }

  function renderProfile() {
    if (!document.querySelector(".account")) return;
    const user = currentUser();
    if (!user) {
      location.replace("Sign Up modern.html?next=profile");
      return;
    }
    const customer = syncCustomer(user),
      orders = read(KEYS.orders, []).filter(
        (o) => o.clientId === user.customerId && !o.isDeleted,
      ),
      returns = read(KEYS.returns, []).filter(
        (r) => r.clientId === user.customerId && !r.isDeleted,
      );
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el) el.textContent = value ?? "-";
    };
    set(".hello .user-name", user.name.split(/\s+/)[0]);
    set(".hello .e-mail", user.email);
    set(".number-total-order", orders.length);
    const today = new Date();
    set(
      ".number-monthly-order",
      orders.filter((o) => {
        const d = new Date(o.createdAt);
        return (
          d.getMonth() === today.getMonth() &&
          d.getFullYear() === today.getFullYear()
        );
      }).length,
    );
    const fields = {
      "#user-name": user.name,
      "#user-id": user.customerId,
      "#user-email": user.email,
      "#user-numder-1": displayPhone(user.phone1),
      "#user-numder-2": user.phone2 ? displayPhone(user.phone2) : "-",
      "#user-birthday": user.birthday || "-",
    };
    Object.entries(fields).forEach(([s, v]) => set(s, v));
    set(".dart-card-acount .name", user.name);
    set(".dart-card-acount .id", `ID- ${user.customerId}`);
    set(".dart-card-acount .limit h6", "10 PIC");
    const card = read("dart_cards", []).find(
      (c) => c.clientId === user.customerId && c.status === "Active",
    );
    set(
      ".dart-card-acount .items h6",
      `${Number(card?.purchasedItems || 0)} PIC`,
    );
    set(".dart-card-acount .issue h6", card?.issueDate || "-");
    set(".dart-card-acount .exp h6", card?.expDate || "-");
    const orderList = document.getElementById("profileOrdersList");
    if (orderList) {
      orderList.innerHTML =
        orders
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((o) => {
            const net = orderNet(o),
              address =
                o.fullAddress ||
                [o.building, o.street, o.area, o.governorate, o.country]
                  .filter(Boolean)
                  .join(", ");
            return `<article class="profile-record-card"><div class="profile-record-head"><strong>${escapeHtml(o.orderId)}</strong><span class="profile-status">${escapeHtml(o.status)}</span></div><div class="profile-record-grid">${profileField("Order date", `${o.date || "-"} ${o.time || ""}`)}${profileField("Subtotal", money(o.totalPrice))}${profileField("Discount", `${Number(o.discount) || 0}% · ${money(o.orderLevelDiscountAmount || 0)}`)}${profileField("Final total", money(net))}${profileField("Payment", `${o.paymentMethod || "Cash on Delivery"} · ${o.paymentStatus || "Unpaid"}`)}${profileField("Address", address || "-")}${profileField("Created", formatDateTime(o.createdAt))}${profileField("Accepted", formatDateTime(o.acceptedAt))}${profileField("Out for delivery", formatDateTime(o.outWithRepresentativeAt || o.representativeOnWayAt))}${profileField("Delivered", formatDateTime(o.deliveredAt))}</div><div class="profile-record-items">${(o.priceSnapshot || []).map((line, index) => `<div class="profile-record-item"><span>${escapeHtml(line.name || line.modelCode || "Item")}</span><span>Model: ${escapeHtml(line.modelCode || "-")}</span><span>Item: ${escapeHtml(line.itemCode || o.items?.[index] || "-")}</span><span>Size: ${escapeHtml(line.size || "-")}</span><span>Color: ${escapeHtml(line.color || "-")}</span><span>Price: ${escapeHtml(money(line.finalUnitPrice))}</span></div>`).join("") || '<div class="empty-state">No item details</div>'}</div></article>`;
          })
          .join("") || '<div class="empty-state">No orders yet</div>';
    }
    const returnList = document.getElementById("profileReturnsList");
    if (returnList) {
      returnList.innerHTML =
        returns
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((r) => {
            const order = orders.find((o) => o.orderId === r.orderId),
              line =
                order?.priceSnapshot?.find((x) => x.itemCode === r.itemCode) ||
                {},
              address =
                order?.fullAddress ||
                [
                  order?.building,
                  order?.street,
                  order?.area,
                  order?.governorate,
                  order?.country,
                ]
                  .filter(Boolean)
                  .join(", ");
            return `<article class="profile-record-card"><div class="profile-record-head"><strong>${escapeHtml(r.returnId)}</strong><span class="profile-status">${escapeHtml(r.status)}</span></div><div class="profile-record-grid">${profileField("Request type", r.requestType || "Return / Exchange")}${profileField("Order ID", r.orderId || "-")}${profileField("Request date", r.date || formatDateTime(r.createdAt))}${profileField("Reason", r.reason || "-")}${profileField("Model", r.modelId || line.modelCode || "-")}${profileField("Item Code", r.itemCode || "-")}${profileField("Size", line.size || "-")}${profileField("Color", line.color || "-")}${profileField("Original item price", money((Number(line.finalUnitPrice) || 0) * (Number(line.qty) || 1)))}${profileField("Refund", money(Number(r.refundAmount) || 0))}${profileField("Delivery address", address || "-")}${profileField("Created", formatDateTime(r.createdAt))}${profileField("Inspected", formatDateTime(r.inspectedAt))}${profileField("Updated", formatDateTime(r.updatedAt))}${profileField("Closed", formatDateTime(r.closedAt))}${profileField("Notes", r.notes || "-")}</div></article>`;
          })
          .join("") ||
        '<div class="empty-state">No returns or exchanges yet</div>';
    }
    const cancel = document.querySelector(".profile-details .cancel-edit");
    if (cancel) cancel.remove();
    const edit = document.querySelector(".profile-details .edit");
    if (edit) {
      edit.dataset.mode = "";
      edit.textContent = "Edit";
      if (!edit.dataset.bound) {
        edit.dataset.bound = "1";
        edit.addEventListener("click", () =>
          toggleProfileEdit(currentUser(), edit),
        );
      }
    }
    const logoutBtn = document.querySelector(".btn-accont-log-out");
    if (logoutBtn) {
      logoutBtn.type = "button";
      logoutBtn.textContent = "Log Out";
      logoutBtn.onclick = () => {
        logout();
        location.replace("index.html");
      };
    }
  }

  function toggleProfileEdit(user, button) {
    const editing = button.dataset.mode === "edit";
    if (!editing) {
      button.dataset.mode = "edit";
      button.textContent = "Save";
      const mapping = {
        "#user-name": ["name", "text"],
        "#user-email": ["email", "email"],
        "#user-numder-1": ["phone1", "tel"],
        "#user-numder-2": ["phone2", "tel"],
        "#user-birthday": ["birthday", "date"],
      };
      for (const [selector, [name, type]] of Object.entries(mapping)) {
        const span = document.querySelector(selector),
          input = document.createElement("input");
        input.className = "profile-edit-input";
        input.type = type;
        input.name = name;
        input.value = name.startsWith("phone")
          ? displayPhone(user[name])
          : user[name] || "";
        span.replaceChildren(input);
      }
      const wrap = button.parentElement;
      if (!wrap.querySelector(".cancel-edit")) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "edit cancel-edit";
        cancel.textContent = "Cancel";
        cancel.onclick = renderProfile;
        wrap.appendChild(cancel);
      }
      return;
    }
    const values = {};
    document
      .querySelectorAll(".profile-edit-input")
      .forEach((input) => (values[input.name] = input.value.trim()));
    const email = normalizeEmail(values.email),
      phone1 = normalizePhone(values.phone1),
      phone2 = normalizePhone(values.phone2);
    if (!values.name) {
      alert("الاسم مطلوب.");
      return;
    }
    const conflict = identityConflict({ email, phone1, phone2 }, user.id);
    if (conflict) {
      alert(conflict);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\+201[0125]\d{8}$/.test(phone1)) {
      alert("راجع البريد ورقم الهاتف.");
      return;
    }
    const users = read(KEYS.users, []),
      stored = users.find((x) => x.id === user.id),
      old = {
        name: stored.name,
        email: stored.email,
        phone1: stored.phone1,
        phone2: stored.phone2,
        birthday: stored.birthday,
      };
    Object.assign(stored, {
      name: values.name,
      email,
      phone1,
      phone2,
      birthday: values.birthday,
      updatedAt: now(),
    });
    write(KEYS.users, users);
    syncCustomer(stored);
    audit("EDIT", "customers", stored.customerId, {
      old,
      new: {
        name: stored.name,
        email,
        phone1,
        phone2,
        birthday: stored.birthday,
      },
    });
    renderProfile();
  }

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
      orders = read(KEYS.orders, []),
      order = orders.find((o) => o.orderId === id);
    if (!order) {
      card.innerHTML =
        '<div class="empty-state">اكتب رقم طلب صحيح في رابط التتبع.</div>';
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
        window.trackingMap = L.map("tracking-map").setView([lat, lng], 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
        }).addTo(window.trackingMap);
        L.marker([lat, lng]).addTo(window.trackingMap);
      } catch (error) {
        console.warn("Tracking map unavailable", error);
      }
    }
  }

  function bindRep() {
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
        alert("The order must be Out With Representative first.");
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

  bindAuth();
  document.addEventListener("DOMContentLoaded", () => {
    ensureCatalogInventory();
    cleanupCartReservations();
    updateCartReservationTimer();
    prefillCheckout();
    renderProfile();
    renderTracking();
    bindRep();
    renderFeedbackEligibility();
    renderLeaderboard();
    new MutationObserver(() => {
      renderFeedbackEligibility();
      renderLeaderboard();
    }).observe(document.body, { childList: true, subtree: true });
    document
      .querySelectorAll("img:not([alt])")
      .forEach((img) => (img.alt = "Decorative Dart visual"));
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    try {
      const url = new URL(link.href, location.href),
        current = new URL(location.href);
      if (
        url.origin === current.origin &&
        (url.pathname !== current.pathname || url.search !== current.search)
      )
        sessionStorage.setItem("dart_internal_navigation", "1");
    } catch {}
  });
  setInterval(() => {
    cleanupCartReservations();
    updateCartReservationTimer();
  }, 1000);
  window.addEventListener("storage", (event) => {
    if (event.key === KEYS.orders && document.querySelector(".tracking-card"))
      renderTracking();
  });
  window.DartPlatform = {
    read,
    write,
    register,
    login,
    logout,
    currentUser,
    checkout,
    apiRequest,
    normalizeEmail,
    normalizePhone,
    identityConflict,
    ensureCatalogInventory,
    renderProfile,
    renderTracking,
    renderLeaderboard,
    reserveCart,
    releaseCartReservation,
    cleanupCartReservations,
    renderFeedbackEligibility,
    updateCartReservationTimer,
    requestPasswordReset,
    replaceTemporaryPassword,
    orderNet,
    money,
    cartReservationId: CART_RESERVATION_ID,
  };
  window.DartApi = {
    baseUrl: API_BASE,
    request: apiRequest,
    isConfigured: Boolean(API_BASE),
  };
})();
