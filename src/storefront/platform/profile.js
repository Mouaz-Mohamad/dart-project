  document.addEventListener?.("click", (event) => {
    if (!event.target.closest?.("[data-profile-commerce-retry]")) return;
    void (async () => {
      if (!currentUser()) await hydrateApiSession();
      await hydrateCustomerCommerce();
      renderProfile();
    })().catch(() => { renderProfile(); });
  });

  function renderProfile() {
    if (!document.querySelector(".account")) return;
    const user = currentUser();
    if (!user) {
      if (typeof apiSessionUnavailable !== "undefined" && apiSessionUnavailable) {
        const host = document.getElementById("profileOrdersList");
        if (host) host.innerHTML = '<div class="empty-state" role="status">Your session could not be verified. <button type="button" data-profile-commerce-retry>Retry</button></div>';
        return;
      }
      location.replace("Sign Up modern.html?next=profile");
      return;
    }
    const commerceState = typeof customerCommerceStatus === "string" ? customerCommerceStatus : "ready";
    const unavailable = '<div class="empty-state" role="status">Account records could not be refreshed. <button type="button" data-profile-commerce-retry>Retry</button></div>';
    const emptyRecords = (message) => commerceState === "error" ? unavailable :
      ["loading", "idle"].includes(commerceState) ? '<div class="empty-state" role="status">Loading account records...</div>' : `<div class="empty-state">${message}</div>`;
    const profileEdit = document.querySelector(".profile-details .edit");
    const preserveDraft = profileEdit?.dataset.mode === "edit" && profileEdit.dataset.customerId === String(user.id);
    const customer = syncCustomer(user),
      orders = read(KEYS.orders, []).filter(
        (o) => o.clientId === user.customerId && !o.isDeleted,
      ),
      returns = read(KEYS.returns, []).filter(
        (r) => r.clientId === user.customerId && !r.isDeleted,
      );
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el && !(preserveDraft && el.querySelector?.(".profile-edit-input"))) el.textContent = value ?? "-";
    };
    set(".hello .user-name", user.name.split(/\s+/)[0]);
    set(".hello .e-mail", user.email);
    const refundedSales = new Set(
      returns
        .filter((record) => {
          const status = String(record.status || "");
          const completed =
            Boolean(record.completedAt) ||
            ["Completed", "Good", "Damaged", "Bad"].includes(status);
          return (
            (returnRules()?.isRefund?.(record) || record.requestType === "Refund") &&
            completed
          );
        })
        .map((record) => JSON.stringify([String(record.orderId || ""), String(record.itemCode || "")]))
        .filter(Boolean),
    );
    const deliveredOrders = orders.filter((order) => order.status === "Delivered");
    const netPiecesForOrders = (rows) =>
      rows.reduce(
        (sum, order) =>
          sum +
          (Array.isArray(order.items) ? order.items : []).filter(
            (itemCode) => !refundedSales.has(JSON.stringify([String(order.orderId), String(itemCode)])),
          ).length,
        0,
      );
    const today = cairoParts(new Date());
    const localStats = {
      totalPieces: netPiecesForOrders(deliveredOrders),
      monthlyPieces: netPiecesForOrders(
        deliveredOrders.filter((order) => {
          const date = new Date(
            order.deliveredAt || order.updatedAt || order.createdAt || 0,
          );
          if (Number.isNaN(date.getTime())) return false;
          const parts = cairoParts(date);
          return parts.month === today.month && parts.year === today.year;
        }),
      ),
    };
    const purchaseStats = serverPurchaseStats || localStats;
    set(".number-total-order", purchaseStats.totalPieces);
    set(".number-monthly-order", purchaseStats.monthlyPieces);
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
      orderList.innerHTML = (commerceState === "error" && orders.length ? unavailable : "") + (
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
          .join("") || emptyRecords("No orders yet"));
    }
    renderProfileWaiting();
    const returnList = document.getElementById("profileReturnsList");
    if (returnList) {
      returnList.innerHTML = (commerceState === "error" && returns.length ? unavailable : "") + (
        returns
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((r) => {
            const order = orders.find((o) => o.orderId === r.orderId),
              line =
                returnRules()?.lineForItem(order, r.itemCode, r) ||
                {},
              address =
                r.fullAddress ||
                [
                  r.building,
                  r.street,
                  r.area,
                  r.governorate,
                  r.country,
                ]
                  .filter(Boolean)
                  .join(", ") ||
                order?.fullAddress ||
                "-",
              publicStatus = returnRules()?.publicStatus(r) || r.status,
              replacement = r.replacementItemCode
                ? `${r.replacementItemCode} · ${r.requestedColor || "-"} · ${r.requestedSize || "-"}`
                : r.requestType === "Exchange"
                  ? `${r.requestedColor || "-"} · ${r.requestedSize || "-"}`
                  : "-",
              fee = Number(r.customerCourierFee) > 0
                ? `${money(r.customerCourierFee)} payable directly to representative`
                : Number(r.brandCourierFee) > 0
                  ? `${money(r.brandCourierFee)} paid by Dart`
                  : "No customer fee";
            return `<article class="profile-record-card"><div class="profile-record-head"><strong>${escapeHtml(r.returnId)}</strong><span class="profile-status">${escapeHtml(publicStatus)}</span></div><div class="profile-record-grid">${profileField("Request type", r.requestType || "Return / Exchange")}${profileField("Order ID", r.orderId || "-")}${profileField("Request date", r.date || formatDateTime(r.createdAt))}${profileField("Reason", r.reason || "-")}${profileField("Rejection reason", r.rejectionReason || "-")}${profileField("Model", r.modelId || line.modelCode || "-")}${profileField("Original Item", r.itemCode || "-")}${profileField("Original Size / Color", `${line.size || "-"} / ${line.color || "-"}`)}${profileField("Replacement", replacement)}${profileField("Original net item price", money(Number(r.originalNetAmount) || 0))}${profileField("Refund", money(Number(r.refundAmount) || 0))}${profileField("Courier fee", fee)}${profileField("Pickup address", address)}${profileField("Representative", r.representativeName || "-")}${profileField("Internal progress", r.status || "-")}${profileField("Inspection", returnRules()?.inspectionStatus(r) || r.inspectionStatus || "Pending")}${profileField("Created", formatDateTime(r.createdAt))}${profileField("Completed", formatDateTime(r.completedAt))}${profileField("Inspected", formatDateTime(r.inspectedAt))}${profileField("Notes", r.notes || "-")}</div></article>`;
          })
          .join("") ||
        emptyRecords("No returns or exchanges yet"));
    }
    const cancel = document.querySelector(".profile-details .cancel-edit");
    if (cancel && !preserveDraft) cancel.remove();
    const edit = document.querySelector(".profile-details .edit");
    if (edit && !preserveDraft) {
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
      logoutBtn.onclick = async () => {
        await logout();
        location.replace("index.html");
      };
    }
  }

  async function toggleProfileEdit(user, button) {
    const editing = button.dataset.mode === "edit";
    if (!editing) {
      button.dataset.mode = "edit";
      button.dataset.customerId = String(user.id);
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
        cancel.onclick = () => { button.dataset.mode = ""; renderProfile(); };
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
      window.DartDialog.alert("الاسم مطلوب.");
      return;
    }
    const conflict = identityConflict({ email, phone1, phone2 }, user.id);
    if (conflict) {
      window.DartDialog.alert(conflict);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\+201[0125]\d{8}$/.test(phone1)) {
      window.DartDialog.alert("راجع البريد ورقم الهاتف.");
      return;
    }
    if (API_BASE) {
      try {
        const result = await apiRequest("/api/v1/me", {
          method: "PATCH",
          body: {
            name: values.name,
            email,
            phone1,
            ...(phone2 ? { phone2 } : {}),
            ...(values.birthday ? { birthday: values.birthday } : {}),
          },
        });
        button.dataset.mode = "";
        cacheApiUser(result.user);
        if (result.verification) {
          sessionStorage.setItem(
            "dart_pending_email_verification",
            JSON.stringify(result.verification),
          );
          location.assign("Sign Up modern.html?verify=email&next=profile");
          return;
        }
        renderProfile();
      } catch (error) {
        window.DartDialog.alert(error.message);
      }
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
    button.dataset.mode = "";
    renderProfile();
  }

