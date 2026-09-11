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
    birthdayRewards: "dart_birthday_rewards",
    birthdayMessages: "dart_birthday_messages",
  });
  const API_BASE = String(window.DART_API_BASE_URL || "").replace(/\/$/, "");
  const CART_RESERVATION_MS = 15 * 60 * 1000;
  const BIRTHDAY_DISCOUNT_PERCENT = 30;
  const BIRTHDAY_REWARD_DAYS = 7;
  const CAIRO_TIME_ZONE = "Africa/Cairo";

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

  // BEGIN Birthday reward clock — frontend prototype; backend remains authoritative.
  function cairoParts(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: CAIRO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    return Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  }

  function cairoOffsetMs(value) {
    const parts = cairoParts(value);
    return (
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - Math.floor(value.getTime() / 1000) * 1000
    );
  }

  function cairoMoment(year, month, day, hour = 0, minute = 0, second = 0) {
    const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const target = {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: normalized.getUTCHours(),
      minute: normalized.getUTCMinutes(),
      second: normalized.getUTCSeconds(),
    };
    let timestamp = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second,
    );
    for (let index = 0; index < 3; index += 1) {
      const adjusted =
        Date.UTC(
          target.year,
          target.month - 1,
          target.day,
          target.hour,
          target.minute,
          target.second,
        ) - cairoOffsetMs(new Date(timestamp));
      if (adjusted === timestamp) break;
      timestamp = adjusted;
    }
    return new Date(timestamp);
  }

  function birthdayParts(value) {
    const text = String(value || "").trim(),
      yearFirst = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/),
      dayFirst = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (yearFirst)
      return { month: Number(yearFirst[2]), day: Number(yearFirst[3]) };
    if (dayFirst)
      return { month: Number(dayFirst[2]), day: Number(dayFirst[1]) };
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : { month: parsed.getMonth() + 1, day: parsed.getDate() };
  }

  function birthdayWindow(birthday, reference = new Date()) {
    const birth = birthdayParts(birthday);
    if (!birth) return null;
    const cairoNow = cairoParts(reference);
    for (const year of [cairoNow.year, cairoNow.year - 1]) {
      const startsAt = cairoMoment(year, birth.month, birth.day);
      const expiresAt = cairoMoment(
        year,
        birth.month,
        birth.day + BIRTHDAY_REWARD_DAYS,
      );
      if (reference >= startsAt && reference < expiresAt)
        return { year, startsAt, expiresAt };
    }
    return null;
  }

  function birthdayRewardId(customerId, year) {
    return `BDAY-${String(customerId || "CUSTOMER")}-${year}`;
  }

  function syncBirthdayRewards(user = currentUser(), reference = new Date()) {
    if (!user?.customerId) return null;
    const rewards = read(KEYS.birthdayRewards, []);
    let changed = false;
    rewards.forEach((reward) => {
      if (reward.customerId !== user.customerId) return;
      if (["Active", "Reserved"].includes(reward.status)) {
        const order = reward.orderId
          ? read(KEYS.orders, []).find(
              (row) => String(row.orderId) === String(reward.orderId),
            )
          : null;
        if (order?.status === "Delivered") {
          reward.status = "Used";
          reward.usedCount = 1;
          reward.usedAt = order.deliveredAt || order.updatedAt || now();
          changed = true;
        } else if (["Cancelled", "Refused"].includes(order?.status)) {
          reward.status = reference < new Date(reward.expiresAt) ? "Active" : "Expired";
          reward.orderId = "";
          reward.reservedAt = null;
          changed = true;
        } else if (reference >= new Date(reward.expiresAt)) {
          reward.status = "Expired";
          changed = true;
        }
      }
    });
    const windowData = birthdayWindow(user.birthday, reference);
    if (windowData) {
      const id = birthdayRewardId(user.customerId, windowData.year);
      let reward = rewards.find((row) => row.id === id);
      if (!reward) {
        reward = {
          id,
          customerId: user.customerId,
          customerName: user.name,
          type: "Birthday",
          discountPercent: BIRTHDAY_DISCOUNT_PERCENT,
          usageLimit: 1,
          usedCount: 0,
          startsAt: windowData.startsAt.toISOString(),
          expiresAt: windowData.expiresAt.toISOString(),
          status: "Active",
          orderId: "",
          createdAt: now(),
        };
        rewards.push(reward);
        changed = true;
      } else if (reward.status === "Scheduled") {
        reward.status = "Active";
        changed = true;
      }
    }
    if (changed) write(KEYS.birthdayRewards, rewards);
    if (!windowData) return null;
    return (
      rewards.find(
        (row) =>
          row.id === birthdayRewardId(user.customerId, windowData.year) &&
          ["Active", "Reserved"].includes(row.status),
      ) || null
    );
  }

  function activeBirthdayReward(user = currentUser()) {
    const reward = syncBirthdayRewards(user);
    return reward?.status === "Active" ? reward : null;
  }

  function visibleBirthdayReward(user = currentUser()) {
    return syncBirthdayRewards(user);
  }

  function updateBirthdayRewardForOrder(order, targetStatus) {
    if (!order?.birthdayRewardId) return;
    const rewards = read(KEYS.birthdayRewards, []);
    const reward = rewards.find((row) => row.id === order.birthdayRewardId);
    if (!reward) return;
    if (targetStatus === "Delivered") {
      reward.status = "Used";
      reward.usedCount = 1;
      reward.usedAt = order.deliveredAt || now();
      order.birthdayRewardUsageRecorded = true;
    } else if (["Cancelled", "Refused"].includes(targetStatus)) {
      reward.status = new Date() < new Date(reward.expiresAt) ? "Active" : "Expired";
      reward.orderId = "";
      reward.reservedAt = null;
      order.birthdayRewardUsageRecorded = false;
    }
    write(KEYS.birthdayRewards, rewards);
  }
  // END Birthday reward clock.

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
    const birthdayReward =
      logged && logged.customerId === customer.clientId
        ? activeBirthdayReward(logged)
        : null;
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
    // Birthday always takes priority and never consumes Dart Card quota.
    if (birthdayReward) {
      appliedCard = null;
      discountRate = Math.max(
        0,
        Math.min(1, Number(birthdayReward.discountPercent || 30) / 100),
      );
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
      reasonDeduction: birthdayReward
        ? "Birthday gift"
        : discountRate
          ? "Verified promotion"
          : "-",
      dartCardId: appliedCard?.cardId || "",
      birthdayRewardId: birthdayReward?.id || "",
      promotionType: birthdayReward
        ? "Birthday"
        : appliedCard
          ? "Dart Card"
          : discountRate
            ? "Promotion"
            : "",
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
    if (birthdayReward) {
      const rewards = read(KEYS.birthdayRewards, []),
        storedReward = rewards.find((row) => row.id === birthdayReward.id);
      if (storedReward) {
        storedReward.status = "Reserved";
        storedReward.orderId = orderId;
        storedReward.reservedAt = now();
        write(KEYS.birthdayRewards, rewards);
      }
    }
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

  // BEGIN Leaderboard net items — completed customer returns no longer count as purchases.
  function isCompletedCustomerReturn(record) {
    const status = String(record?.status || "")
      .trim()
      .toLowerCase();
    return (
      record?.isPostDeliveryReturn === true &&
      !record?.isDeleted &&
      ["good", "damaged", "bad"].includes(status)
    );
  }

  function leaderboardDataSignature(customers, orders, returns, cards, today) {
    const source = JSON.stringify({
      month: `${today.getFullYear()}-${today.getMonth()}`,
      customers: customers.map((row) => [
        row.clientId,
        row.clientName,
        Boolean(row.isArchived),
        Boolean(row.isDeleted),
      ]),
      orders: orders.map((row) => [
        row.orderId,
        row.clientId,
        row.status,
        row.deliveredAt || row.createdAt,
        row.totalProducts,
        row.items,
        row.finalAmount,
      ]),
      returns: returns.map((row) => [
        row.returnId,
        row.orderId,
        row.clientId,
        row.itemCode,
        row.status,
        Boolean(row.isPostDeliveryReturn),
        Boolean(row.isDeleted),
      ]),
      cards: cards.map((row) => [row.cardId, row.clientId, row.status]),
    });
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${today.getFullYear()}-${today.getMonth()}-${hash >>> 0}`;
  }

  function renderLeaderboard() {
    const list = document.querySelector(".leaderboard-list");
    if (!list) return;
    const customers = read(KEYS.customers, []).filter(
      (customer) => !customer.isArchived && !customer.isDeleted,
    );
    const orders = read(KEYS.orders, []),
      returns = read(KEYS.returns, []),
      cards = read("dart_cards", []),
      today = new Date();
    const signature = leaderboardDataSignature(
      customers,
      orders,
      returns,
      cards,
      today,
    );
    if (list.dataset.dartLeaderboardSignature === signature) return;
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
        const deliveredItemCodes = delivered.flatMap((order) =>
          (order.items || []).map((code) => String(code)),
        );
        const deliveredOrderIds = new Set(
          delivered.map((order) => String(order.orderId || order.id || "")),
        );
        const returnedItemCodes = new Set(
          returns
            .filter(isCompletedCustomerReturn)
            .filter(
              (record) =>
                String(record.clientId || "") === String(customer.clientId) ||
                deliveredOrderIds.has(String(record.orderId || "")),
            )
            .map((record) => String(record.itemCode || ""))
            .filter(Boolean),
        );
        const grossItems = delivered.reduce(
          (sum, order) =>
            sum + Number(order.totalProducts || order.items?.length || 0),
          0,
        );
        const returnedItems = new Set(
          deliveredItemCodes.filter((code) => returnedItemCodes.has(code)),
        ).size;
        return {
          customer,
          orders: delivered.length,
          items: Math.max(0, grossItems - returnedItems),
          spent: delivered.reduce((sum, order) => sum + orderNet(order), 0),
        };
      })
      .filter((row) => row.orders > 0)
      .sort(
        (a, b) => b.orders - a.orders || b.items - a.items || b.spent - a.spent,
      );
    const rows = candidates.slice(0, 3);
    if (!rows.length) {
      const heading =
        list.querySelector("h1")?.outerHTML ||
        "<h1>Contenders for the DART card</h1>";
      list.innerHTML =
        heading +
        '<li class="leaderboard-empty">No eligible candidates this month yet.</li>';
      list.dataset.dartLeaderboardSignature = signature;
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
            `<li class="leaderboard-item rank-${index + 1} ${index === 0 ? "top-rank" : ""}"><div class="rank-badge"><h2 class="rank-num">${index + 1}</h2></div><div class="leaderboard-candidate"><small>${index === 0 ? "Leading contender" : "Dart Card contender"}</small><h3 class="user-name">${escapeHtml(customerNameParts(row.customer.clientName, 3))}</h3></div><h3 class="score" aria-label="${row.items} PIC"><strong>${row.items}</strong><span>PIC</span></h3></li>`,
        )
        .join("");
    list.dataset.dartLeaderboardSignature = signature;
  }
  // END Leaderboard net items.

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

  function customerNameParts(value, count = 2) {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "Not disclosed";
    return parts.slice(0, Math.max(1, count)).join(" ");
  }

  function publicCustomerName(value) {
    return customerNameParts(value, 2);
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
    const model = DartCatalog.model(item.modelId),
      productName = model?.name || item.modelName || "Dart item",
      image = DartCatalog.cover(model, item.color);
    content.innerHTML = `<div class="serial-result-icon"><i class="fa-solid fa-check"></i></div><h2 id="serialResultTitle">Authentic Dart Item</h2><p>This sold item is verified in the official Dart registry.</p><div class="serial-product"><img class="serial-product-image" src="${escapeHtml(image)}" alt="${escapeHtml(`${productName} in ${item.color || "its registered color"}`)}"><div class="serial-product-details"><div><small>Product</small><strong>${escapeHtml(productName)}</strong></div><div><small>Item Code</small><strong>${escapeHtml(item.itemCode)}</strong></div><div><small>Size</small><strong>${escapeHtml(item.size || "-")}</strong></div><div><small>Color</small><strong>${escapeHtml(item.color || "-")}</strong></div><div class="serial-owner"><small>Registered owner</small><strong>${escapeHtml(customerNameParts(owner, 2))}</strong></div></div></div>`;
  }

  // BEGIN Birthday celebration, countdown and vertical navbar ticker.
  function countdownValues(expiresAt) {
    const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    return {
      remaining,
      days: Math.floor(remaining / 864e5),
      hours: Math.floor((remaining % 864e5) / 36e5),
      minutes: Math.floor((remaining % 36e5) / 6e4),
    };
  }

  function renderBirthdayTicker() {
    const track = document.querySelector(".dart-nav-ticker-track");
    if (!track) return;
    const reward = visibleBirthdayReward(),
      messages = ["Welcome to Dart"];
    if (reward)
      messages.push(
        reward.status === "Reserved"
          ? "Your 30% birthday gift is reserved for your current order"
          : "Your birthday gift is ready — 30% OFF for 7 days",
      );
    const signature = `${reward?.id || "none"}:${reward?.status || ""}`;
    if (track.dataset.signature === signature) return;
    track.dataset.signature = signature;
    track.innerHTML = messages
      .map(
        (message, index) =>
          `<p class="dart-nav-ticker-message${index ? " is-birthday" : ""}">${escapeHtml(message)}</p>`,
      )
      .join("");
    clearInterval(window.dartNavTickerTimer);
    track.style.transform = "translateY(0)";
    if (messages.length > 1) {
      let index = 0;
      window.dartNavTickerTimer = setInterval(() => {
        index = (index + 1) % messages.length;
        track.style.transform = `translateY(-${index * 30}px)`;
      }, 4000);
    }
  }

  function wireSocialLinks() {
    document.querySelectorAll("[data-social-url]").forEach((link) => {
      const url = String(link.dataset.socialUrl || "").trim();
      if (url) {
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.removeAttribute("aria-disabled");
        link.removeAttribute("tabindex");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.tabIndex = -1;
      }
    });
  }

  function addPartyPieces(layer) {
    const confettiColors = ["#ab012b", "#f4c95d", "#ffffff", "#ef7b45"];
    for (let index = 0; index < 34; index += 1) {
      const piece = document.createElement("span");
      piece.className = "dart-confetti-piece";
      piece.style.left = `${(index * 29) % 100}%`;
      piece.style.background = confettiColors[index % confettiColors.length];
      piece.style.setProperty("--fall", `${5 + (index % 6)}s`);
      piece.style.setProperty("--delay", `${-(index % 9)}s`);
      piece.style.setProperty("--drift", `${(index % 2 ? 1 : -1) * (18 + (index % 5) * 9)}px`);
      layer.appendChild(piece);
    }
    for (let index = 0; index < 9; index += 1) {
      const balloon = document.createElement("span");
      balloon.className = "dart-balloon";
      balloon.textContent = ["🎈", "🎈", "🎉"][index % 3];
      balloon.style.left = `${3 + ((index * 13) % 91)}%`;
      balloon.style.setProperty("--rise", `${8 + (index % 5) * 1.4}s`);
      balloon.style.setProperty("--delay", `${-(index % 7) * 1.2}s`);
      balloon.style.setProperty("--drift", `${(index % 2 ? 1 : -1) * (15 + index * 2)}px`);
      layer.appendChild(balloon);
    }
  }

  function updateBirthdayCountdown(overlay, reward) {
    const values = countdownValues(reward.expiresAt);
    const fields = {
      days: values.days,
      hours: values.hours,
      minutes: values.minutes,
    };
    Object.entries(fields).forEach(([key, value]) => {
      const field = overlay.querySelector(`[data-birthday-time="${key}"]`);
      if (field) field.textContent = String(value).padStart(2, "0");
    });
    if (values.remaining > 0) return;
    overlay.remove();
    syncBirthdayRewards();
    renderBirthdayTicker();
    clearInterval(window.dartBirthdayCountdownTimer);
  }

  function renderBirthdayCelebration() {
    const reward = visibleBirthdayReward(),
      existing = document.querySelector(".dart-birthday-celebration");
    if (
      !reward ||
      sessionStorage.getItem(`dart_birthday_celebration_closed:${reward.id}`) ===
        "1"
    ) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.rewardId === reward.id) return;
    existing?.remove();
    const overlay = document.createElement("section");
    overlay.className = "dart-birthday-celebration";
    overlay.dataset.rewardId = reward.id;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your Dart birthday gift");
    overlay.innerHTML = `<div class="dart-party-layer" aria-hidden="true"></div><div class="dart-birthday-card"><div class="dart-birthday-countdown" aria-label="Time remaining on birthday discount"><div class="dart-birthday-time"><strong data-birthday-time="days">00</strong><span>Days</span></div><div class="dart-birthday-time"><strong data-birthday-time="hours">00</strong><span>Hours</span></div><div class="dart-birthday-time"><strong data-birthday-time="minutes">00</strong><span>Minutes</span></div></div></div><button type="button" class="dart-birthday-close">Close</button>`;
    addPartyPieces(overlay.querySelector(".dart-party-layer"));
    overlay.querySelector(".dart-birthday-close").addEventListener("click", () => {
      sessionStorage.setItem(
        `dart_birthday_celebration_closed:${reward.id}`,
        "1",
      );
      overlay.remove();
      clearInterval(window.dartBirthdayCountdownTimer);
    });
    document.body.appendChild(overlay);
    updateBirthdayCountdown(overlay, reward);
    clearInterval(window.dartBirthdayCountdownTimer);
    window.dartBirthdayCountdownTimer = setInterval(
      () => updateBirthdayCountdown(overlay, reward),
      1000,
    );
    overlay.querySelector(".dart-birthday-close")?.focus();
  }

  function renderBirthdayExperience() {
    renderBirthdayTicker();
    wireSocialLinks();
    renderBirthdayCelebration();
  }
  // END Birthday celebration, countdown and vertical navbar ticker.

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
          const orderLine = (order.priceSnapshot || []).find(
              (line) => String(line.itemCode) === String(values.item_code),
            ),
            inventoryItem = read(KEYS.items, []).find(
              (item) => String(item.itemCode) === String(values.item_code),
            ),
            modelCode = orderLine?.modelCode || inventoryItem?.modelId || "";
          if (!modelCode) {
            setStatus(
              form,
              "تعذر ربط رقم القطعة بالتصميم. راجع خدمة العملاء.",
              true,
            );
            return;
          }
          const row = {
            id: uid("RETDB"),
            returnId: nextCode("R", rows, "returnId"),
            orderId: order.orderId,
            clientId: order.clientId,
            clientName: values.full_name,
            itemCode: values.item_code,
            modelId: modelCode,
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
    set(".dart-card-acount .id", `Customer ID: ${user.customerId}`);
    const cardExpiry = (value) => {
        const parts = String(value || "")
          .split(/[-/]/)
          .map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        return parts[0] > 999
          ? new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59)
          : new Date(parts[2], parts[1] - 1, parts[0], 23, 59, 59);
      },
      userCards = read("dart_cards", [])
        .filter((row) => row.clientId === user.customerId && !row.isDeleted)
        .sort(
          (first, second) =>
            new Date(second.createdAt || 0) - new Date(first.createdAt || 0),
        ),
      activeCard = userCards.find((row) => {
        const limit = Number(row.itemLimit || row.purchasedLimit || 10),
          expiry = cardExpiry(row.expDate);
        return (
          row.status === "Active" &&
          Number(row.purchasedItems || 0) < limit &&
          (!expiry || expiry >= new Date())
        );
      }),
      card = activeCard || userCards[0] || null,
      limit = Number(card?.itemLimit || card?.purchasedLimit || 10),
      used = Math.max(0, Number(card?.purchasedItems || 0)),
      remaining = Math.max(0, limit - used),
      cardStatus = activeCard
        ? "Active"
        : card?.status === "Active"
          ? "Expired"
          : card?.status || "Inactive",
      cardElement = document.querySelector(".dart-card-acount");
    set(".dart-card-acount .items-used", `${used} / ${limit} pieces`);
    set(".dart-card-acount .items-remaining", remaining);
    set(".dart-card-acount .issue-date", card?.issueDate || "-");
    set(".dart-card-acount .expiry-date", card?.expDate || "-");
    set(".dart-card-acount .dart-card-account-status strong", cardStatus);
    cardElement?.classList.toggle("is-inactive", cardStatus !== "Active");
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
    renderBirthdayExperience();
    new MutationObserver(() => {
      renderFeedbackEligibility();
      renderLeaderboard();
      renderBirthdayTicker();
      wireSocialLinks();
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
    if (
      [KEYS.birthdayRewards, KEYS.session, KEYS.orders].includes(event.key)
    )
      renderBirthdayExperience();
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
    activeBirthdayReward,
    visibleBirthdayReward,
    syncBirthdayRewards,
    updateBirthdayRewardForOrder,
    renderBirthdayExperience,
    birthdayWindow,
    cairoParts,
    cairoMoment,
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
