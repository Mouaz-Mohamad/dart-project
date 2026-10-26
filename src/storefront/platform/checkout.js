  let cartQuoteCache = null;
  let cartQuotePending = null;
  let reviewedQuote = null;
  function cartQuoteSignature() {
    const cart = typeof cartData !== "undefined" ? cartData : read("dart_cart", []);
    return JSON.stringify([currentUser()?.id, CART_RESERVATION_ID, window.dartAppliedPromotion?.type === "Promotion" ? window.dartAppliedPromotion.code : "",
      cart.map((line) => [line.id, line.color, line.size, line.quantity, line.dartSetKey || ""])]);
  }
  function currentCartQuote() {
    return cartQuoteCache?.signature === cartQuoteSignature() ? cartQuoteCache.quote : null;
  }
  function invalidateCartQuote() { cartQuoteCache = null; reviewedQuote = null; }
  async function quoteCart(options = {}) {
    if (!API_BASE || !currentUser()) return null;
    const signature = cartQuoteSignature();
    if (!options.force && cartQuoteCache?.signature === signature && Date.now() - cartQuoteCache.at < 2000) return cartQuoteCache.quote;
    if (cartQuotePending?.signature === signature) return cartQuotePending.task;
    const code = window.dartAppliedPromotion?.type === "Promotion" ? window.dartAppliedPromotion.code : "";
    const task = (async () => {
      const quote = await apiRequest(`/api/v1/me/cart/quote?reservationId=${encodeURIComponent(CART_RESERVATION_ID)}${code ? `&promotionCode=${encodeURIComponent(code)}` : ""}`);
      if (signature !== cartQuoteSignature()) throw new Error("Cart changed while pricing. Review it and retry.");
      cartQuoteCache = { signature, quote, at: Date.now() };
      return quote;
    })();
    cartQuotePending = { signature, task };
    try { return await task; } finally { if (cartQuotePending?.task === task) cartQuotePending = null; }
  }
  function cartPriceReview(previous, quote, previousTotal) {
    reviewedQuote = { signature: cartQuoteSignature(), fingerprint: quote.fingerprint };
    window.applyCartQuote?.(quote);
    return Object.assign(new Error("Cart prices changed. Review the current total before confirming."), {
      code: "PRICE_CHANGED", details: { changes: [{ modelId: "Cart total", color: "", size: "",
        previousUnitPrice: Number(previous?.totalMinor ?? previousTotal ?? quote.totalMinor) / 100, currentUnitPrice: quote.totalMinor / 100 }] },
    });
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

  async function checkout(form, options = {}) {
    cleanupCartReservations();
    const cart =
      typeof cartData !== "undefined" ? cartData : read("dart_cart", []);
    if (!cart.length) throw new Error("السلة فارغة.");
    const logged = currentUser();
    if (!logged)
      throw new Error("يجب إنشاء حساب أو تسجيل الدخول قبل إتمام الطلب.");
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

    if (API_BASE) {
      const previousQuote = currentCartQuote();
      const previousTotal = window.dartDisplayedTotalMinor;
      const quote = await quoteCart({ force: true });
      if (!quote.completedOrder && (
        (previousQuote?.fingerprint && previousQuote.fingerprint !== quote.fingerprint) ||
        (Number.isFinite(previousTotal) && previousTotal !== quote.totalMinor)
      ) && !(options.acceptPriceChanges && reviewedQuote?.signature === cartQuoteSignature() && reviewedQuote.fingerprint === quote.fingerprint)) {
        throw cartPriceReview(previousQuote, quote, previousTotal);
      }
      // Acceptance is bound to the reviewed quote, including its discount sources.
      if (!quote.completedOrder && options.acceptPriceChanges && reviewedQuote &&
          (reviewedQuote.signature !== cartQuoteSignature() || reviewedQuote.fingerprint !== quote.fingerprint)) {
        throw cartPriceReview(previousQuote, quote, previousTotal);
      }
      window.applyCartQuote?.(quote);
      let response;
      try {
        response = quote.completedOrder ? { order: quote.completedOrder } : await apiRequest("/api/v1/orders", {
        method: "POST",
        headers: { "Idempotency-Key": `checkout-${CART_RESERVATION_ID}` },
        body: {
          reservationId: CART_RESERVATION_ID,
          quoteFingerprint: quote.fingerprint,
          expectedTotalMinor: quote.totalMinor,
          contact: {
            name: details.name,
            phone1: details.phone1,
            ...(details.phone2 && details.phone2 !== "-" ? { phone2: details.phone2 } : {}),
            email: details.email,
          },
          address: {
            country: details.country,
            governorate: details.governorate,
            area: details.area,
            street: details.street,
            building: details.building,
            floor: details.floor,
            latitude: String(details.latitude),
            longitude: String(details.longitude),
            ...(details.fullAddress ? { fullAddress: details.fullAddress } : {}),
            addressSource:
              addressValidation?.source || form.dataset.dartAddressSource || "map",
          },
          deliveryNotes: details.deliveryNotes || "",
          ...(options.acceptPriceChanges ? { acceptPriceChanges: true } : {}),
          ...(window.dartAppliedPromotion?.type === "Promotion" &&
          window.dartAppliedPromotion?.code
            ? { promotionCode: String(window.dartAppliedPromotion.code) }
            : {}),
        },
      });
      } catch (error) {
        if (error.code === "PRICE_CHANGED") {
          const fresh = await quoteCart({ force: true });
          reviewedQuote = { signature: cartQuoteSignature(), fingerprint: fresh.fingerprint };
          window.applyCartQuote?.(fresh);
        }
        throw error;
      }
      invalidateCartQuote();
      if (typeof cartData !== "undefined") cartData = [];
      write("dart_cart", []);
      setCartReservationId(uid("CART"));
      window.dartAppliedPromotion = null;
      // The committed order is the success boundary. Projection/preference refresh
      // cannot turn it into a failed checkout or hold up its confirmation.
      sessionStorage.setItem("dart_last_order_id", response.order.orderId);
      void Promise.allSettled([
        Promise.resolve().then(() => saveCustomerAddress({
          address: details.fullAddress || [details.building, details.street, details.area, details.governorate, details.country].filter(Boolean).join(", "),
          lat: Number(details.latitude),
          lng: Number(details.longitude),
          country: details.country,
          governorate: details.governorate,
          area: details.area,
          street: details.street,
          building: details.building,
          floor: details.floor,
        })),
        Promise.resolve().then(() => window.DartCatalog?.checkForServerChanges?.()),
        Promise.resolve().then(hydrateCustomerCommerce),
      ]);
      return response.order;
    }

    const customer = syncCustomer(logged);
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
    let subtotal = snapshots.reduce(
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
        1,
        typeof appliedDiscountRate !== "undefined"
          ? Number(appliedDiscountRate) || 0
          : 0,
      ),
    );
    const requestedCardId = window.dartAppliedPromotion?.cardId;
    let appliedCard =
      logged && logged.customerId === customer.clientId
        ? activeDartCard(logged, allocations.length)
        : null;
    if (!appliedCard && requestedCardId) discountRate = 0;
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
      } else {
        discountRate = Math.max(
          0,
          Math.min(1, Number(appliedCard.discountPercent ?? window.DartSiteSettings?.get?.().dartCardDiscountPercent ?? 40) / 100),
        );
      }
    }
    const campaign = discountRate > 0 ? window.dartAppliedPromotion : null;
    const fallbackPromotion = campaign || birthdayReward || appliedCard || null;
    const fallbackRate = campaign
      ? discountRate
      : birthdayReward
        ? Math.max(0, Math.min(1, Number(birthdayReward.discountPercent ?? 30) / 100))
        : appliedCard
          ? Math.max(0, Math.min(1, Number(appliedCard.discountPercent ?? 40) / 100))
          : 0;
    let cardRemaining = appliedCard
      ? Math.max(0, Number(appliedCard.itemLimit || appliedCard.purchasedLimit || 10) - Number(appliedCard.purchasedItems || 0))
      : 0;
    snapshots.forEach((line) => {
      const original = Number(line.originalUnitPrice || line.finalUnitPrice || 0);
      const modelRate = Math.max(0, Math.min(1, Number(line.discountPercent || 0) / 100));
      let rate = modelRate;
      let source = modelRate ? "Model" : "None";
      if (!modelRate && fallbackPromotion && (!appliedCard || cardRemaining > 0)) {
        rate = fallbackRate;
        source = campaign ? "Campaign" : birthdayReward ? "Birthday" : "Dart Card";
        if (source === "Dart Card") cardRemaining -= 1;
      }
      line.discountPercent = rate * 100;
      line.discountSource = source;
      line.discountAmount = original * rate;
      line.finalUnitPrice = Math.max(0, original - line.discountAmount);
    });
    subtotal = snapshots.reduce((sum, line) => sum + Number(line.originalUnitPrice || 0), 0);
    const finalAmount = snapshots.reduce((sum, line) => sum + Number(line.finalUnitPrice || 0), 0);
    const discountAmount = Math.max(0, subtotal - finalAmount);
    const orderLevelPromotion = fallbackPromotion;
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
        : campaign
          ? "Promotion campaign"
        : appliedCard
          ? "Dart Card"
        : discountRate
          ? "Verified promotion"
          : "-",
      dartCardId: appliedCard?.cardId || "",
      birthdayRewardId: birthdayReward?.id || "",
      promotionType: birthdayReward
        ? "Birthday"
        : campaign
          ? "Promotion"
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

