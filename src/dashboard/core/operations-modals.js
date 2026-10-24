function dartActiveReps() {
  return representativeData.filter(
    (r) => dartIsActive(r) && r.status === "Active",
  );
}
async function dartRequestOrderTransition(orders, target) {
  if (!orders.length) return;
  if (orders.some((order) => window.DartOrdersApi?.isBusy?.(order.orderId || order.id))) return;
  if (orders.length === 1 && !dartCanTransition(orders[0], target)) {
    window.DartDialog.alert(
      `الانتقال غير منطقي للأوردر: ${orders[0].orderId}`,
    );
    return;
  }
  if (orders.length > 1 && new Set(orders.map((order) => order.status)).size !== 1) {
    window.DartDialog.alert("حدد أوردرات من نفس الحالة الحالية.");
    return;
  }
  if (target === "Out With Representative") {
    dartPendingOrderAction = { orders, target };
    const sel = document.getElementById("rep-assignment-select");
    sel.innerHTML = dartActiveReps()
      .map(
        (r) =>
          `<option value="${dartEsc(r.id)}">${dartEsc(r.name)} — ${dartEsc(r.repId)}</option>`,
      )
      .join("");
    if (!sel.options.length) {
      window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
      return;
    }
    openModal(document.getElementById("rep-assignment-modal"));
    return;
  }
  if (target === "Refused" || target === "Cancelled") {
    dartPendingOrderAction = { orders, target };
    const title = document.getElementById("order-reason-title"),
      sel = document.getElementById("order-reason-select");
    title.textContent =
      target === "Refused" ? "Refusal Reason" : "Cancellation Reason";
    const reasons =
      target === "Refused"
        ? [
            "Customer changed mind",
            "Price",
            "Size",
            "Color",
            "Product different from expectation",
            "Customer unavailable / did not answer",
            "Product issue",
            "Delivery issue",
            "Other",
          ]
        : [
            "Customer request",
            "Admin decision",
            "Inventory issue",
            "Duplicate order",
            "Address/Delivery issue",
            "Other",
          ];
    sel.innerHTML = reasons
      .map((r) => `<option value="${dartEsc(r)}">${dartEsc(r)}</option>`)
      .join("");
    document.getElementById("order-reason-notes").value = "";
    openModal(document.getElementById("order-reason-modal"));
    return;
  }
  const result =
    orders.length === 1
      ? await dartApplyTransition(orders[0], target)
      : await dartBatchTransition(orders, target);
  if (!result.ok) window.DartDialog.alert(result.message || "Order status update failed.");
}
function dartSetupOperationalModals() {
  document
    .getElementById("confirm-return-approval")
    ?.addEventListener("click", async () => {
      const record = dartPendingReturnAction?.record;
      if (!record || dartPendingReturnAction?.decision !== "accept") return;
      const result = await dartApproveReturn(
        record,
        document.getElementById("return-replacement-select")?.value || "",
      );
      if (!result.ok) {
        window.DartDialog.alert(result.message || "Operation failed");
        return;
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-approval-modal"));
    });
  document
    .getElementById("confirm-return-rejection")
    ?.addEventListener("click", async () => {
      const record = dartPendingReturnAction?.record;
      if (!record || dartPendingReturnAction?.decision !== "reject") return;
      const reason = document.getElementById("return-rejection-reason")?.value;
      const result = await dartRejectReturn(record, reason);
      if (!result.ok) {
        window.DartDialog.alert(result.message || "Operation failed");
        return;
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-rejection-modal"));
    });
  document
    .getElementById("confirm-return-rep-assignment")
    ?.addEventListener("click", async () => {
      const records = dartPendingReturnAction?.records || (dartPendingReturnAction?.record ? [dartPendingReturnAction.record] : []);
      if (!records.length || dartPendingReturnAction?.decision !== "assign") return;
      const representativeId = document.getElementById("return-rep-assignment-select")?.value;
      if (records.length > 1 && !window.DartGroups?.sameRoute?.(records)) {
        window.DartDialog.alert("لا يمكن جمع إلا طلبات نفس العميل ونفس الدولة والمحافظة والمنطقة والشارع.");
        return;
      }
      const pickupGroupId = window.DartGroups?.newId?.("RPG") || `RPG-${Date.now()}`;
      for (const record of records) {
        const result = await dartAssignReturnRepresentative(record, representativeId, pickupGroupId);
        if (!result.ok) { window.DartDialog.alert(result.message || "Operation failed"); return; }
      }
      dartPendingReturnAction = null;
      closeModal(document.getElementById("return-rep-assignment-modal"));
    });

  document.getElementById("assign-selected-returns")?.addEventListener("click", () => {
    const visibleIds = new Set(dartApplyFilters("returns", returnsData).map((row) => String(row.id)));
    const records = returnsData.filter((row) => row.isChecked && visibleIds.has(String(row.id)));
    if (!records.length) return window.DartDialog.alert("حدد طلب استبدال أو استرجاع واحدًا على الأقل.");
    if (records.some((row) => row.status !== "Approved - Awaiting Representative"))
      return window.DartDialog.alert("كل الطلبات المحددة يجب أن تكون Approved وتنتظر تعيين المندوب.");
    if (!window.DartGroups?.sameRoute?.(records))
      return window.DartDialog.alert("حدد طلبات نفس العميل ونفس الدولة والمحافظة والمنطقة والشارع فقط.");
    const select = document.getElementById("return-rep-assignment-select");
    select?.replaceChildren();
    dartActiveReps().forEach((representative) => {
      const option = document.createElement("option");
      option.value = representative.id;
      option.textContent = `${representative.name} — ${representative.repId}`;
      select?.appendChild(option);
    });
    if (!select?.options.length) return window.DartDialog.alert("لا يوجد مندوب Active وغير مشطوب.");
    dartPendingReturnAction = { records, decision: "assign" };
    const summary = document.getElementById("return-rep-assignment-summary");
    if (summary) summary.textContent = `${records.length} selected request(s) · one pickup route · independent records`;
    openModal(document.getElementById("return-rep-assignment-modal"));
  });
  document
    .getElementById("confirm-rep-assignment")
    ?.addEventListener("click", async (event) => {
      if (!dartPendingOrderAction) return;
      const button = event.currentTarget;
      button.disabled = true;
      const rep = document.getElementById("rep-assignment-select").value;
      const { orders, target } = dartPendingOrderAction;
      try {
        const res =
          orders.length === 1
            ? await dartApplyTransition(orders[0], target, { representativeId: rep })
            : await dartBatchTransition(orders, target, { representativeId: rep });
        if (!res.ok) {
          window.DartDialog.alert(res.message || "Operation failed");
          return;
        }
        dartPendingOrderAction = null;
        closeModal(document.getElementById("rep-assignment-modal"));
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("confirm-order-reason")
    ?.addEventListener("click", async (event) => {
      if (!dartPendingOrderAction) return;
      const button = event.currentTarget;
      button.disabled = true;
      const reason = document.getElementById("order-reason-select").value,
        notes = document.getElementById("order-reason-notes").value;
      const { orders, target } = dartPendingOrderAction,
        meta = { reason, notes, actorRole: "Admin" };
      try {
        const res =
          orders.length === 1
            ? await dartApplyTransition(orders[0], target, meta)
            : await dartBatchTransition(orders, target, meta);
        if (!res.ok) {
          window.DartDialog.alert(res.message || "Operation failed");
          return;
        }
        dartPendingOrderAction = null;
        closeModal(document.getElementById("order-reason-modal"));
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("order-bulk-actions")
    ?.addEventListener("click", async (e) => {
      const actionButton = e.target.closest("[data-bulk-order-status]");
      const target = actionButton?.dataset.bulkOrderStatus;
      if (!target) return;
      const visibleIds = new Set(
        dartApplyFilters("orders", ordersData).map((x) => String(x.id)),
      );
      const selected = ordersData.filter(
        (o) => o.isChecked && visibleIds.has(String(o.id)),
      );
      if (!selected.length) {
        window.DartDialog.alert("حدد أوردر واحد على الأقل من الصفوف الظاهرة.");
        return;
      }
      const buttons = [...document.querySelectorAll("#order-bulk-actions [data-bulk-order-status]")];
      buttons.forEach((button) => { button.disabled = true; });
      try {
        await dartRequestOrderTransition(selected, target);
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
}

function dartAutoAllocate(modelCode, color, size, qty, exclude = []) {
  const model = dartFindModelByCode(modelCode);
  if (!model || dartIsArchived(model))
    return { ok: false, message: "Model غير موجود أو مشطوب." };
  const excluded = new Set(exclude);
  const candidates = itemsData.filter(
    (i) =>
      dartIsActive(i) &&
      String(i.status).toLowerCase() === "in stock" &&
      String(i.modelId) === String(modelCode) &&
      String(i.color).toLowerCase() === String(color).toLowerCase() &&
      String(i.size).toLowerCase() === String(size).toLowerCase() &&
      !excluded.has(i.itemCode),
  );
  if (candidates.length < qty)
    return {
      ok: false,
      message: `المتاح ${candidates.length} فقط من ${modelCode} / ${color} / ${size}.`,
    };
  return { ok: true, codes: candidates.slice(0, qty).map((i) => i.itemCode) };
}

function setupItemModal() {
  return DartInventory.setupItemModal();
}
function dartRevalidateAllocatedItem(item, old) {
  const order = ordersData.find(
    (o) =>
      o.orderId === item.orderId && !DART_FINAL_ORDER_STATES.includes(o.status),
  );
  if (!order) return;
  const expected = (order.priceSnapshot || []).find(
    (l) => l.itemCode === old.itemCode,
  ) || { modelCode: old.modelId, color: old.color, size: old.size };
  const matches =
    item.modelId === expected.modelCode &&
    String(item.color).toLowerCase() === String(expected.color).toLowerCase() &&
    String(item.size).toLowerCase() === String(expected.size).toLowerCase();
  if (matches) return;
  const r = dartAutoAllocate(
    expected.modelCode,
    expected.color,
    expected.size,
    1,
    [item.itemCode],
  );
  if (r.ok) {
    const replacement = dartFindItemByCode(r.codes[0]),
      idx = order.items.indexOf(item.itemCode);
    replacement.status = "Processing/Held";
    replacement.orderId = order.orderId;
    replacement.clientId = order.clientId;
    replacement.clientName = order.clientName;
    if (idx >= 0) order.items[idx] = replacement.itemCode;
    item.status = "In stock";
    item.orderId = "";
    order.priceSnapshot = dartPriceSnapshotForCodes(order.items);
    dartLogOrder(order, "ITEM_REALLOCATED", order.status, order.status, {
      notes: `${old.itemCode} → ${replacement.itemCode}`,
    });
    dartNotify(
      "item_allocation_changed",
      `${order.orderId}: item allocation changed`,
      `${old.itemCode} → ${replacement.itemCode}`,
      "orders",
      order.id,
    );
  } else {
    const prev = order.status;
    order.previousOperationalStatus = prev;
    order.status = "Needs Attention";
    order.needsAttentionAt = dartNowISO();
    order.needsAttentionReason = `No ${expected.modelCode} / ${expected.color} / ${expected.size} available after ${item.itemCode} edit.`;
    dartLogOrder(order, "INVENTORY_CONFLICT", prev, "Needs Attention", {
      notes: order.needsAttentionReason,
    });
    dartNotify(
      "needs_attention",
      `${order.orderId} needs attention`,
      order.needsAttentionReason,
      "orders",
      order.id,
      "warning",
    );
  }
}

function dartSetupDamageModal() {
  const modal = document.getElementById("damage-modal"),
    form = document.getElementById("damage-form");
  document.getElementById("add-damage-btn")?.addEventListener("click", () => {
    form.reset();
    document.getElementById("damage-edit-id").value = "";
    openModal(modal);
  });
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("damage-edit-id").value,
      code = document.getElementById("damage-item-code").value.trim(),
      it = dartFindItemByCode(code);
    if (!it) {
      window.DartDialog.alert("Item Code غير موجود.");
      return;
    }
    const p = {
      itemCode: code,
      modelId: it.modelId,
      img: it.img || "",
      color: it.color,
      size: it.size,
      reason: document.getElementById("damage-reason").value,
      notes: document.getElementById("damage-notes").value,
      status: document.getElementById("damage-status").value,
      date: new Date().toLocaleDateString("en-GB"),
    };
    if (id) {
      const d = damageData.find((x) => String(x.id) === String(id)),
        old = { ...d };
      Object.assign(d, p);
      dartAudit("EDIT", "damage", d.id, old, p);
      dartSetDamageStatus(d, p.status);
    } else {
      const d = {
        id: dartUid("DMGDB"),
        damageId: dartUid("DMG"),
        createdAt: dartNowISO(),
        isArchived: false,
        isDeleted: false,
        isChecked: false,
        ...p,
      };
      damageData.push(d);
      it.status = p.status === "Repaired" ? "In stock" : p.status;
      dartAudit("CREATE", "damage", d.id, {}, d);
      dartNotify(
        "item_damaged",
        `${code}: ${p.status}`,
        p.reason,
        "damage",
        d.id,
        "warning",
      );
      dartSaveAll();
      dartRefreshAll();
    }
    closeModal(modal);
  });
}

function dartShowOrderHistory(o) {
  const modal = document.getElementById("history-modal"),
    body = document.getElementById("history-modal-body");
  document.getElementById("history-modal-title").textContent =
    `Activity — ${o.orderId}`;
  body.innerHTML = `<div><b>Status:</b> ${dartEsc(o.status)} · <b>Payment:</b> ${dartEsc(o.paymentStatus)} · <b>Source:</b> ${dartEsc(o.orderSource)}</div><div class="dart-timeline">${
    (o.activityLog || [])
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="dart-timeline-item"><b>${dartEsc(e.type)}</b> ${dartEsc(e.previousStatus || "")} ${e.previousStatus ? "→" : ""} ${dartEsc(e.newStatus || "")}<div>${dartEsc(e.reason || e.notes || "")}</div><small>${dartEsc(new Date(e.timestamp).toLocaleString())} · ${dartEsc(e.actorRole || "")}</small></div>`,
      )
      .join("") || '<div class="dart-empty-state">No activity yet</div>'
  }</div>`;
  openModal(modal);
}

function dartShowClientProfile(c) {
  const st = dartCustomerStats(c.clientId),
    os = ordersData
      .filter((o) => o.clientId === c.clientId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  document.getElementById("history-modal-title").textContent =
    `Client — ${c.clientName}`;
  const trend = dartClientPurchaseTrend(c.clientId);
  document.getElementById("history-modal-body").innerHTML =
    `<div><b>${dartEsc(c.clientId)}</b> · ${dartEsc(c.phone1)} · ${dartEsc(c.email || "-")}</div><p>Orders: <b>${st.orders}</b> · Delivered: <b>${st.delivered}</b> · Items: <b>${st.purchased}</b> · Spent: <b>${dartMoney(st.spent)}</b></p><p class="dart-purchase-trend ${trend.direction}"><b>Purchase trend:</b> Orders ${dartEsc(trend.orders)} · Spending ${dartEsc(trend.spending)} <small>(last complete month vs previous month)</small></p><div class="dart-timeline">${os.map((o) => `<div class="dart-timeline-item"><b>${dartEsc(o.orderId)}</b> — ${dartEsc(o.status)}<div>${(o.items || []).map(dartEsc).join(", ")}</div><small>${dartEsc(o.date || "")} · ${dartMoney(dartOrderNet(o))}</small></div>`).join("") || '<div class="dart-empty-state">No orders</div>'}</div>`;
  openModal(document.getElementById("history-modal"));
}

function updateOrderCards() {
  const sec = document.getElementById("orders");
  if (!sec) return;
  const cards = sec.querySelectorAll(".cont-card-info .card-inf .numebr");
  if (cards.length >= 4) {
    cards[0].textContent = ordersData.filter(
      (o) => !DART_FINAL_ORDER_STATES.includes(o.status),
    ).length;
    cards[1].textContent = ordersData.filter(
      (o) => o.status === "Delivered",
    ).length;
    cards[2].textContent = ordersData.filter((o) => o.status === "New").length;
    cards[3].textContent = dartMoney(
      ordersData
        .filter((o) => o.status === "Delivered")
        .reduce(
          (a, o) =>
            a + Math.max(0, dartOrderNet(o) - (Number(o.amountRefunded) || 0)),
          0,
        ),
    );
  }
}

function dartDeadStockItems() {
  const now = Date.now(),
    ms = DART_DEAD_STOCK_DAYS * 864e5;
  return itemsData
    .filter(
      (i) => dartIsActive(i) && String(i.status).toLowerCase() === "in stock",
    )
    .filter((i) => {
      const d = dartDateValue(i.regDate);
      return d && now - d.getTime() >= ms;
    });
}

function setupGlobalModalTriggers() {
  if (document.documentElement.dataset.dartModalReady) return;
  document.documentElement.dataset.dartModalReady = "1";
  document.addEventListener("click", (e) => {
    // Finance owns its pending-save guard and focus restoration.
    if (e.target.closest("#dart-finance-modal")) return;
    if (e.target.closest(".close-modal")) {
      closeModal(e.target.closest(".modal"));
      return;
    }
    if (e.target.classList.contains("modal")) closeModal(e.target);
  });
}

