  async function claimGuestCartAfterAuth() {
    if (!API_BASE || !currentUser()) return null;
    const localCart = read("dart_cart", []);
    if (!Array.isArray(localCart) || !localCart.length) return null;
    try {
      const result = await apiRequest("/api/v1/me/cart/claim", {
        method: "POST",
        body: { reservationId: CART_RESERVATION_ID },
      });
      if (result?.reservationId) setCartReservationId(result.reservationId);
      return result;
    } catch (error) {
      if (error?.code === "CART_RESERVATION_EXPIRED") {
        write("dart_cart", []);
        if (typeof cartData !== "undefined") cartData = [];
        return null;
      }
      throw error;
    }
  }

  async function hydrateCustomerCart({ claimLocal = true } = {}) {
    if (!API_BASE) return read("dart_cart", []);
    let payload;
    if (currentUser()) {
      const localCart = read("dart_cart", []);
      if (claimLocal && Array.isArray(localCart) && localCart.length) {
        await claimGuestCartAfterAuth();
      }
      payload = await apiRequest("/api/v1/me/cart");
    } else {
      payload = await apiRequest(`/api/v1/cart/reservation/${encodeURIComponent(CART_RESERVATION_ID)}`).catch((error) => {
        if ([404, 409].includes(error.status)) return { cart: null };
        throw error;
      });
    }
    const remote = payload?.cart || null;
    if (!remote) {
      if (typeof cartData !== "undefined") cartData = [];
      write("dart_cart", []);
      if (typeof renderCart === "function") renderCart();
      if (typeof updateCartCount === "function") updateCartCount();
      return [];
    }
    setCartReservationId(remote.reservationId);
    const products = getProducts();
    const hydrated = (remote.lines || []).map((line) => {
      const product = products.find((row) => String(row.code || row.id) === String(line.modelId));
      const model = DartCatalog.model(String(line.modelId));
      const setId = String(line.setId || "").trim();
      const setUnitIndex = Number(line.setUnitIndex || 0);
      const setGroupId = String(line.setGroupId || "").trim();
      return {
        id: String(line.modelId),
        title: product?.title || model?.name || String(line.modelId),
        price: Number(product?.price ?? DartCatalog.price(model) ?? 0),
        size: String(line.size), color: String(line.color),
        quantity: Number(line.quantity) || 1,
        image: DartCatalog.cover(model, String(line.color)),
        reservationId: CART_RESERVATION_ID, reservationUntil: remote.expiresAt,
        ...(setGroupId && setId && setUnitIndex > 0
          ? {
              setGroupId,
              setId,
              dartSetKey: `${setId}:${setUnitIndex}`,
              dartSetUnitIndex: setUnitIndex,
              ...(line.setCartComponentId ? { dartSetCartComponentId: String(line.setCartComponentId) } : {}),
              ...(line.setComponentId ? { dartSetComponentId: String(line.setComponentId) } : {}),
              ...(Number(line.setComponentUnitIndex) > 0
                ? { dartSetComponentUnitIndex: Number(line.setComponentUnitIndex) }
                : {}),
            }
          : {}),
      };
    });
    if (typeof cartData !== "undefined") cartData = hydrated;
    write("dart_cart", hydrated);
    if (typeof renderCart === "function") renderCart();
    if (typeof updateCartCount === "function") updateCartCount();
    updateCartReservationTimer();
    return hydrated;
  }

  async function releaseCartReservation(clearCart = true) {
    if (API_BASE) {
      try {
        await apiRequest(
          currentUser()
            ? "/api/v1/me/cart/reservation"
            : `/api/v1/cart/reservation/${encodeURIComponent(CART_RESERVATION_ID)}`,
          { method: "DELETE" },
        );
      } catch (error) {
        if (![404, 409].includes(error.status)) throw error;
      }
      if (clearCart) {
        write("dart_cart", []);
        if (typeof cartData !== "undefined") cartData = [];
      }
      await window.DartCatalog?.checkForServerChanges?.();
      return;
    }

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

  async function cleanupCartReservations() {
    const cart = read("dart_cart", []);
    const expires = Math.max(
      0,
      ...cart.map((line) => new Date(line.reservationUntil || 0).getTime()),
    );
    if (cart.length && expires <= Date.now()) {
      if (API_BASE) {
        await releaseCartReservation(true).catch(() => {
          write("dart_cart", []);
          if (typeof cartData !== "undefined") cartData = [];
        });
      } else {
        const items = read(KEYS.items, []);
        let changed = false;
        items.forEach((item) => {
          if (
            String(item.status).toLowerCase() === "cart reserved" &&
            new Date(item.reservationUntil || 0).getTime() <= Date.now()
          ) {
            item.status = "In stock";
            delete item.cartReservationId;
            delete item.reservationUntil;
            changed = true;
          }
        });
        if (changed) write(KEYS.items, items);
        write("dart_cart", []);
        if (typeof cartData !== "undefined") cartData = [];
      }
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
      if (cart.length) void cleanupCartReservations();
      return;
    }
    const minutes = Math.floor(remaining / 60000),
      seconds = Math.floor((remaining % 60000) / 1000);
    timer.hidden = false;
    timer.textContent = `القطع محجوزة لمدة ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  async function reserveCart(cart) {
    if (API_BASE) {
      if (!cart.length) {
        await releaseCartReservation(false);
        write("dart_cart", []);
        return { expiresAt: null };
      }
      const lines = cart.map((line) => ({
        modelId: String(line.id),
        color: String(line.color),
        size: String(line.size),
        quantity: Number(line.quantity),
      }));
      const payload = await apiRequest(
        currentUser() ? "/api/v1/me/cart/reservation" : "/api/v1/cart/reservation",
        {
          method: "PUT",
          body: {
            reservationId: CART_RESERVATION_ID,
            lines,
          },
        },
      );
      setCartReservationId(payload.reservationId || CART_RESERVATION_ID);
      cart.forEach((line) => {
        line.reservationId = CART_RESERVATION_ID;
        line.reservationUntil = payload.expiresAt;
      });
      write("dart_cart", cart);
      await window.DartCatalog?.checkForServerChanges?.();
      return payload;
    }

    await cleanupCartReservations();
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

