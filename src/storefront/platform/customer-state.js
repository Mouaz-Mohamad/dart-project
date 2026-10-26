  function adaptApiUser(profile) {
    if (!profile || profile.accountType !== "customer") return null;
    return {
      id: profile.id,
      customerId: profile.code,
      name: profile.name,
      email: profile.email,
      phone1: profile.phones?.[0] || "",
      phone2: profile.phones?.[1] || "",
      role: "Customer",
      emailVerified: profile.emailVerified,
      mustChangePassword: profile.mustChangePassword,
      birthday: profile.birthday || "",
      status: profile.status,
      isArchived: false,
      serverAuthoritative: true,
    };
  }

  function cacheApiUser(profile) {
    const previousId = apiUserCache?.id || null;
    apiUserCache = adaptApiUser(profile);
    const nextId = apiUserCache?.id || null;
    if (previousId !== nextId) {
      if (typeof invalidateCartQuote === "function") invalidateCartQuote();
      customerCommerceGeneration += 1;
      customerCommercePromise = null;
      serverReviewEligible = null;
      serverPurchaseStats = null;
      // The server links this browser's guest history to the authenticated
      // account. The existing visit key makes this safe to repeat after login.
      if (nextId) void trackAnalyticsEvent("visit");
    }
    window.dispatchEvent?.(
      new CustomEvent("dart:customer-session-changed", { detail: { user: apiUserCache } }),
    );
    return apiUserCache;
  }

  async function hydrateCustomerCommerce() {
    if (!API_BASE || !apiUserCache) return null;
    if (customerCommercePromise) return customerCommercePromise;
    const generation = customerCommerceGeneration;
    const customerId = apiUserCache.id;
    const task = (async () => {
      const payload = await apiRequest("/api/v1/me/commerce");
      if (
        generation !== customerCommerceGeneration ||
        !apiUserCache ||
        apiUserCache.id !== customerId
      ) {
        return payload;
      }
      serverReviewEligible = payload.reviewEligible === true;
      serverPurchaseStats =
        payload.purchaseStats &&
        Number.isFinite(Number(payload.purchaseStats.totalPieces)) &&
        Number.isFinite(Number(payload.purchaseStats.monthlyPieces))
          ? {
              totalPieces: Math.max(0, Number(payload.purchaseStats.totalPieces) || 0),
              monthlyPieces: Math.max(0, Number(payload.purchaseStats.monthlyPieces) || 0),
            }
          : null;
      const snapshots = [
        [KEYS.orders, payload.orders || []],
        [KEYS.returns, payload.returns || []],
        [KEYS.cards, payload.cards || []],
        [KEYS.birthdayRewards, payload.birthdayRewards || []],
        [KEYS.birthdayMessages, payload.birthdayMessages || []],
      ];
      snapshots.forEach(([key, value]) => { if (JSON.stringify(read(key, [])) !== JSON.stringify(value)) write(key, value); });
      if (payload.savedAddress) write("user_last_address", payload.savedAddress);
      else window.DartState?.remove?.("user_last_address", { source: "platform" });
      window.dispatchEvent(
        new CustomEvent("dart:saved-address-hydrated", {
          detail: { address: payload.savedAddress || null },
        }),
      );
      return payload;
    })();
    customerCommercePromise = task;
    try {
      return await task;
    } finally {
      if (customerCommercePromise === task) customerCommercePromise = null;
    }
  }

  function refreshCustomerCommerceInBackground() {
    if (!API_BASE || !apiUserCache) return;
    void hydrateCustomerCommerce().catch((error) => {
      if (error?.status !== 401) {
        window.dispatchEvent(
          new CustomEvent("dart:customer-commerce-unavailable", {
            detail: { code: error?.code || "API_ERROR" },
          }),
        );
      }
    });
  }

  async function saveCustomerAddress(address) {
    const normalized = address && typeof address === "object"
      ? {
          address: String(address.address || "").trim(),
          lat: Number(address.lat),
          lng: Number(address.lng),
          governorate: deliveryGovernorate(address.governorate),
          ...(address.country ? { country: String(address.country) } : {}),
          ...(address.area ? { area: String(address.area) } : {}),
          ...(address.street ? { street: String(address.street) } : {}),
          ...(address.building ? { building: String(address.building) } : {}),
          ...(address.floor ? { floor: String(address.floor) } : {}),
        }
      : null;
    if (
      !normalized ||
      !normalized.address ||
      !Number.isFinite(normalized.lat) ||
      !Number.isFinite(normalized.lng) ||
      !normalized.governorate
    ) {
      throw new Error("Saved address is incomplete.");
    }

    if (API_BASE && currentUser()) {
      const payload = await apiRequest("/api/v1/me/preferences/address", {
        method: "PUT",
        body: normalized,
      });
      const saved = payload.savedAddress || normalized;
      write("user_last_address", saved);
      return saved;
    }

    if (API_REQUIRED) {
      throw new Error("Saved addresses require an authenticated Dart account.");
    }
    write("user_last_address", normalized);
    return normalized;
  }

  async function clearCustomerAddress() {
    if (API_BASE && currentUser()) {
      await apiRequest("/api/v1/me/preferences/address", {
        method: "DELETE",
      });
      window.DartState?.remove?.("user_last_address", { source: "platform" });
      return;
    }
    if (API_REQUIRED) {
      throw new Error("Saved addresses require an authenticated Dart account.");
    }
    window.DartState?.remove?.("user_last_address", { source: "platform" });
  }

  async function hydrateApiSession() {
    if (!API_BASE) return null;
    const hasSessionHint = document.cookie
      .split(";")
      .some((part) => part.trim().startsWith("dart_csrf="));
    if (!hasSessionHint) return cacheApiUser(null);
    try {
      const payload = await apiRequest("/api/v1/me");
      const user = cacheApiUser(payload.user);
      if (user) refreshCustomerCommerceInBackground();
      return user;
    } catch (error) {
      if (error.status === 401) return cacheApiUser(null);
      throw error;
    }
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
    if (API_BASE) return apiUserCache ? { userId: apiUserCache.id, api: true } : null;
    const session = read(KEYS.session, null);
    if (!session || !session.userId) {
      window.DartState?.remove?.(KEYS.session, { source: "platform" });
      return null;
    }
    return session;
  }

  function saveCustomerSession(user) {
    if (API_BASE) {
      cacheApiUser(user);
      return;
    }
    write(KEYS.session, {
      userId: user.id,
      createdAt: now(),
      rememberedUntilLogout: true,
    });
  }

  function currentUser() {
    if (API_BASE) return apiUserCache;
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

