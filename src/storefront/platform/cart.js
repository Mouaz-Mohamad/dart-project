  function readCartReturnChoice(search = "") {
    try {
      const raw = new URLSearchParams(search).get("cartChoice") || "";
      if (raw.length > 4000) return null;
      const intent = JSON.parse(raw);
      if (!Number.isFinite(intent.at) || intent.at > Date.now() || Date.now() - intent.at > 30 * 60 * 1000 ||
          !Array.isArray(intent.choices) || !intent.choices.length || intent.choices.length > 20) return null;
      if (intent.choices.some(choice => ![choice.modelId, choice.color, choice.size].every(value =>
        typeof value === "string" && value.length > 0 && value.length <= 120) ||
        !Number.isInteger(choice.quantity || 1) || (choice.quantity || 1) < 1 || (choice.quantity || 1) > 20)) return null;
      return intent.choices;
    } catch { return null; }
  }

  function restoreCartReturnChoice(modal, choices) {
    if (!modal || !choices?.length) return;
    if (modal.id === "SectionModel") {
      const choice = choices[0];
      if (typeof activeProduct === "undefined" || String(activeProduct?.id) !== choice.modelId) return;
      for (const [selector, field] of [[".color-btn", "color"], [".size-btn", "size"]]) {
        [...modal.querySelectorAll(selector)].find(button => button.dataset[field] === choice[field] && !button.disabled)?.click();
      }
      const increase = modal.querySelector("#modalQtyIncrease");
      for (let i = 1; i < (choice.quantity || 1) && increase && !increase.disabled; i++) increase.click();
      return;
    }
    const components = [...modal.querySelectorAll(".dart-set-component")];
    if (components.length !== choices.length) return;
    components.forEach((block, index) => {
      const choice = choices[index];
      if (block.dataset.modelId !== choice.modelId) return;
      for (const field of ["color", "size"]) {
        const select = block.querySelector(`[data-set-${field}]`);
        if (select && [...select.options].some(option => option.value === choice[field])) {
          select.value = choice[field]; select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
  }

  async function requireCartAccount(productPath = "", choices = []) {
    if (API_BASE && !currentUser()) await hydrateApiSession();
    if (currentUser()) {
      if (API_BASE && hydratedCartOwnerId !== currentUser().id) await hydrateCustomerCart();
      return true;
    }
    sessionStorage.setItem("dart_internal_navigation", "1");
    const params = new URLSearchParams({ next: productPath ? "product" : "products" });
    if (/^(?:\/products\/[a-z0-9\u0600-\u06ff-]+|\/sets\/[a-z0-9_-]{1,120})$/i.test(productPath)) params.set("productPath", productPath);
    // Only UI choices travel with navigation. No cart, prices or reservation are persisted.
    const intent = JSON.stringify({ at: Date.now(), choices });
    if (intent.length <= 4000 && readCartReturnChoice(new URLSearchParams({ cartChoice: intent }).toString())) params.set("cartChoice", intent);
    location.assign(`Sign%20Up%20modern.html?${params}`);
    return false;
  }

  function showGuestCartConflict(guestId, accountId, cartVersion) {
    document.getElementById("dart-cart-conflict")?.remove();
    const ownerId = currentUser()?.id;
    const notice = document.createElement("aside");
    notice.id = "dart-cart-conflict";
    notice.className = "dart-cart-conflict";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Choose your cart");
    const text = document.createElement("p");
    text.textContent = "عندك سلة سابقة وسلة على حسابك. اختر السلة التي تريد الاحتفاظ بها؛ سيتم إلغاء حجز السلة الأخرى.";
    const result = document.createElement("p");
    result.setAttribute("role", "status");
    notice.append(text);
    let committed = false;
    for (const [label, keepGuest] of [["Use previous cart", true], ["Keep account cart", false]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        if (!ownerId || currentUser()?.id !== ownerId) return notice.remove();
        const buttons = notice.querySelectorAll("button");
        buttons.forEach((control) => { control.disabled = true; });
        try {
          if (!committed) {
          await enqueueCartMutation(async () => {
          if (keepGuest) {
            await apiRequest("/api/v1/me/cart/claim", { method: "POST",
              body: { reservationId: guestId, replaceReservationId: accountId, replaceCartVersion: cartVersion } });
          } else {
            await apiRequest(`/api/v1/cart/reservation/${encodeURIComponent(guestId)}`, { method: "DELETE" });
          }
          });
          committed = true;
          cartHydrationPromise = null;
          invalidateCartQuote();
          hydratedCartOwnerId = null;
          buttons.forEach((control) => { if (control !== button) control.remove(); });
          button.textContent = "Retry Cart Refresh";
          }
          await hydrateCustomerCart({ claimLocal: false });
          notice.remove();
        } catch (error) {
          result.textContent = error?.code === "CART_CONFLICT"
            ? "السلة تغيرت. أعد تحميل الصفحة لمراجعة السلتين قبل الاختيار."
            : "تعذر تحديث السلة. حاول مرة أخرى؛ لم يتم مسحها من المتصفح.";
        } finally { buttons.forEach((control) => { control.disabled = false; }); }
      });
      notice.append(button);
    }
    notice.append(result);
    document.body.prepend(notice);
  }

  let guestCartClaimPromise = null;
  async function claimGuestCartAfterAuth() {
    if (!API_BASE || !currentUser()) return null;
    if (guestCartClaimPromise) return guestCartClaimPromise;
    const ownerId = currentUser().id;
    const task = (async () => {
      const recovered = await apiRequest("/api/v1/cart/reservation");
      const guestId = recovered?.cart?.reservationId;
      if (!guestId || currentUser()?.id !== ownerId) return null;
      try {
      const result = await apiRequest("/api/v1/me/cart/claim", {
        method: "POST",
        body: { reservationId: guestId },
      });
      if (currentUser()?.id === ownerId && result?.reservationId) setCartReservationId(result.reservationId);
      return result;
    } catch (error) {
      if (error?.code === "CART_CONFLICT") {
        if (currentUser()?.id === ownerId) showGuestCartConflict(guestId, error.details?.reservationId, error.details?.cartVersion);
        return null;
      }
      if (error?.code === "CART_RESERVATION_EXPIRED") {
        return null;
      }
      throw error;
    }
    })();
    guestCartClaimPromise = task;
    try { return await task; }
    finally { if (guestCartClaimPromise === task) guestCartClaimPromise = null; }
  }

  let cartHydrationPromise = null;
  let hydratedCartOwnerId = null;
  async function hydrateCustomerCart(options = {}) {
    const ownerId = currentUser()?.id || null;
    if (cartHydrationPromise?.ownerId === ownerId) return cartHydrationPromise.task;
    const task = hydrateCustomerCartNow(options);
    cartHydrationPromise = { ownerId, task };
    try { return await task; }
    finally { if (cartHydrationPromise?.task === task) cartHydrationPromise = null; }
  }
  async function hydrateCustomerCartNow({ claimLocal = true } = {}) {
    if (!API_BASE) return read("dart_cart", []);
    await settleCartMutations();
    const mutationSequence = cartMutationSequence;
    const ownerId = currentUser()?.id || null;
    let payload;
    if (currentUser()) {
      if (claimLocal) await claimGuestCartAfterAuth();
      payload = await apiRequest("/api/v1/me/cart");
    } else {
      payload = await apiRequest("/api/v1/cart/reservation").catch((error) => {
        if ([404, 409].includes(error.status)) return { cart: null };
        throw error;
      });
    }
    if ((currentUser()?.id || null) !== ownerId || mutationSequence !== cartMutationSequence) return read("dart_cart", []);
    const remote = payload?.cart || null;
    if (!remote) {
      // Checkout consumes the reservation. Recover its committed reply before
      // a reload can present that consumed cart as an unexplained empty cart.
      const completedOrder = await recoverCompletedCheckout();
      if ((currentUser()?.id || null) !== ownerId || mutationSequence !== cartMutationSequence) return read("dart_cart", []);
      if (completedOrder) {
        if (typeof showToast === "function") showToast(`تم تأكيد الطلب ${completedOrder.orderId}. يمكنك متابعته من حسابك.`);
      }
      if (typeof cartData !== "undefined") cartData = [];
      write("dart_cart", []);
      if (typeof renderCart === "function") renderCart();
      if (typeof updateCartCount === "function") updateCartCount();
      hydratedCartOwnerId = ownerId;
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
    hydratedCartOwnerId = ownerId;
    return hydrated;
  }

  let cartMutationQueue = Promise.resolve();
  let latestCartMutation = null;
  let cartMutationSequence = 0;
  function enqueueCartMutation(operation) {
    const sequence = ++cartMutationSequence;
    const pending = cartMutationQueue.then(() => operation(sequence));
    latestCartMutation = pending;
    cartMutationQueue = pending.catch(() => undefined);
    return pending;
  }
  async function settleCartMutations() {
    let pending;
    // Callers already report/roll back failed edits. A failed edit must not
    // poison every later quote; checkout also compares the confirmed contents.
    do { pending = latestCartMutation; await pending?.catch(() => undefined); } while (pending !== latestCartMutation);
  }
  function releaseCartReservation(clearCart = true) {
    return API_BASE ? enqueueCartMutation(sequence => releaseCartReservationNow(clearCart, sequence)) : releaseCartReservationNow(clearCart);
  }
  async function releaseCartReservationNow(clearCart = true, sequence) {
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
      if (clearCart && (sequence === undefined || sequence === cartMutationSequence)) {
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

  function reserveCart(cart, { afterReservation } = {}) {
    const snapshot = cart.map(line => ({ ...line }));
    const operation = async (sequence) => {
      const payload = await reserveCartSnapshot(snapshot, sequence);
      // Set attachment and its rollback belong to the same queued intent.
      if (typeof afterReservation === "function") {
        await afterReservation(payload, previous => reserveCartSnapshot(previous.map(line => ({ ...line })), sequence));
      }
      return payload;
    };
    return API_BASE ? enqueueCartMutation(operation) : operation();
  }
  async function reserveCartSnapshot(cart, sequence) {
    invalidateCartQuote();
    if (API_BASE) {
      if (!currentUser()) throw Object.assign(new Error("سجل الدخول أولًا لإضافة قطعة للسلة."), { code: "AUTH_REQUIRED", status: 401 });
      if (!cart.length) {
        await releaseCartReservationNow(false);
        if (sequence === cartMutationSequence) { write("dart_cart", []); if (typeof cartData !== "undefined") cartData = []; }
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
      if (sequence === cartMutationSequence) {
        write("dart_cart", cart);
        if (typeof cartData !== "undefined") cartData = cart;
      }
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

