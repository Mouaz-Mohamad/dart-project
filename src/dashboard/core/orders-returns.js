function dartPreviousStatus(status) {
  const i = DART_ORDER_FLOW.indexOf(status);
  return i > 0 ? DART_ORDER_FLOW[i - 1] : null;
}
async function dartRollbackOrderOneStep(order) {
  if (
    !order ||
    dartIsArchived(order) ||
    ["New", "Refused", "Cancelled", "Needs Attention"].includes(order.status)
  )
    return { ok: false, message: "لا يمكن الرجوع خطوة من هذه الحالة." };
  const prevStatus = order.status,
    target = dartPreviousStatus(prevStatus),
    serverAuthoritative = Boolean(window.DartOrdersApi);
  if (!target) return { ok: false, message: "لا توجد خطوة سابقة." };
  if (
    !await window.DartDialog.confirm(
      `رجوع ${order.orderId} من ${prevStatus} إلى ${target}؟ سيتم عكس أي تأثير مالي/مخزني مرتبط بهذه الخطوة.`,
    )
  )
    return { ok: false, message: "cancelled" };
  if (window.DartOrdersApi?.workflow) {
    try {
      await window.DartOrdersApi.workflow(order.orderId || order.id, {
        expectedStatus: prevStatus,
        target,
        reason: "Manual one-step rollback",
      });
      return { ok: true };
    } catch (error) {
      if (error?.code === "ORDER_STATE_STALE") {
        await window.DartOrdersApi.hydrate(true).catch(() => {});
      }
      return {
        ok: false,
        message: error?.message || "Order rollback was not committed to the server.",
      };
    }
  }
  if (prevStatus === "Delivered") {
    if (!serverAuthoritative) {
      (order.items || []).forEach((code) => {
        const it = dartFindItemByCode(code);
        if (it && it.status === "Sold") {
          it.status = "Processing/Held";
          it.purchaseDate = "";
        }
      });
    }
    order.deliveredAt = null;
    if (
      order.paymentMethod &&
      String(order.paymentMethod).toLowerCase().includes("cash") &&
      order.paidAt
    ) {
      order.paymentStatus = "Unpaid";
      order.amountPaid = 0;
      order.paidAt = null;
    }
    if (!serverAuthoritative && order.birthdayRewardId) {
      let rewards;
      try {
        rewards = window.DartState?.read?.("dart_birthday_rewards", []) || [];
      } catch {
        rewards = [];
      }
      const reward = rewards.find((row) => row.id === order.birthdayRewardId);
      if (reward) {
        reward.status =
          new Date() < new Date(reward.expiresAt) ? "Reserved" : "Expired";
        reward.usedCount = 0;
        reward.usedAt = null;
        reward.orderId = order.orderId;
        order.birthdayRewardUsageRecorded = false;
        if (window.DartDomainState?.write) {
          window.DartDomainState.write("dart_birthday_rewards", rewards);
        } else {
          window.DartState?.write?.("dart_birthday_rewards", rewards, { source: "dashboard" });
        }
      }
    }
  }
  if (prevStatus === "Representative On The Way")
    order.representativeOnWayAt = null;
  if (prevStatus === "Out With Representative") {
    order.outWithRepresentativeAt = null;
    order.representativeId = null;
    order.representativeName = "";
    order.deliveryGroupId = "";
  }
  if (prevStatus === "Preparing") order.preparingAt = null;
  if (prevStatus === "Accepted") order.acceptedAt = null;
  order.status = target;
  dartLogOrder(order, "STATUS_ROLLBACK", prevStatus, target, {
    notes: "Admin rolled order back one step",
  });
  dartAudit(
    "ORDER_STATUS_ROLLBACK",
    "orders",
    order.id,
    { status: prevStatus },
    { status: target },
    "Manual one-step rollback",
  );
  dartNotify(
    "order_rollback",
    `${order.orderId}: moved back one step`,
    `${prevStatus} → ${target}`,
    "orders",
    order.id,
    "warning",
  );
  dartPersistOrderWorkflow();
  dartRefreshAll();
  return { ok: true };
}

function renderOrders(dataArray) {
  const c = document.getElementById("orders-container");
  if (!c) return;
  c.innerHTML = "";
  const sorted = getSortedData(dataArray).sort((a, b) => {
    if (dartIsArchived(a) !== dartIsArchived(b))
      return Number(dartIsArchived(a)) - Number(dartIsArchived(b));
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const table = c.closest(".cont-titel");
  table?.classList.toggle("dart-orders-groups-view", dartOrdersView === "groups");
  if (dartOrdersView === "groups") {
    dartRenderOrderGroups(c, sorted);
    updateOrderCards();
    dartRefreshOrderBusyUi();
    return;
  }
  sorted.forEach((o) => {
    const next = dartNextStatus(o.status),
      net = dartOrderNet(o),
      verificationStatus = String(
        o.verificationStatus || o.codVerificationStatus || "Not Required",
      ),
      riskLevel = String(o.riskLevel || "Low"),
      customerRiskLevel = String(o.customerRiskLevel || riskLevel),
      isCashOrder = String(o.paymentMethod || "").toLowerCase().includes("cash"),
      codBlocked =
        isCashOrder && !["Not Required", "Verified"].includes(verificationStatus),
      refusalHistory = Array.isArray(o.refusalHistory) ? o.refusalHistory : [],
      refusalSummary = refusalHistory
        .slice(0, 10)
        .map(
          (row) =>
            `${row.orderId || "-"} · ${String(row.refusedAt || "-").slice(0, 10)} · ${row.reason || "Other"}`,
        )
        .join(" | "),
      riskMeta =
        `<small class="dart-kpi-inline" title="${dartEsc(refusalSummary || "No refusal history")}">Order risk ${dartEsc(riskLevel)} (${Number(o.riskScore) || 0}) · Customer ${dartEsc(customerRiskLevel)} · Verification ${dartEsc(verificationStatus)} · Refusals ${Number(o.refusalsInWindow) || 0}</small>`,
      rep =
        o.representativeName ||
        dartFindRepById(o.representativeId)?.name ||
        "-",
      chips =
        (o.items || [])
          .map((x) => `<div class="order-item-chip">${dartEsc(x)}</div>`)
          .join("") || "-";
    const nextBtn =
        next && dartCanTransition(o, next)
          ? `<button class="dart-status-btn" data-order-target="${dartEsc(next)}">${dartEsc(next)}</button>`
          : next === "Preparing" && codBlocked
            ? '<button class="dart-status-btn" disabled title="COD verification required">Verify first</button>'
            : "",
      codActions =
        codBlocked &&
        ["New", "Accepted"].includes(o.status) &&
        window.DartAdminAccess?.can?.("orders.verify_cod") === true
          ? '<button class="dart-status-btn" data-order-cod-decision="verify">Verify COD</button><button class="dart-cancel-btn" data-order-cod-decision="fail">Fail COD</button>'
          : "",
      back =
        dartPreviousStatus(o.status) &&
        !["Refused", "Cancelled", "Needs Attention"].includes(o.status)
          ? '<button class="dart-back-btn" title="Back one step"><i class="bx bx-undo"></i></button>'
          : "",
      refuse = [
        "Out With Representative",
        "Representative On The Way",
      ].includes(o.status)
        ? '<button class="dart-refuse-btn" data-order-target="Refused">Refuse</button>'
        : "",
      cancel = !DART_FINAL_ORDER_STATES.includes(o.status)
        ? '<button class="dart-cancel-btn" data-order-target="Cancelled">Cancel</button>'
        : "",
      pickup =
        o.status === "Out With Representative"
          ? '<button class="dart-pickup-cancel-btn">Cancel Pickup</button>'
          : "";
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(o)}" data-id="${dartEsc(o.id)}"><input type="checkbox" class="model-checkbox" ${o.isChecked ? "checked" : ""} ${dartIsArchived(o) ? "disabled" : ""}><div class="w500 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(o) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button><button class="dart-history-btn" data-order-history="1"><i class="bx bx-history"></i></button>${back}<span class="dart-status-actions">${nextBtn}${codActions}${refuse}${cancel}${pickup}</span></div><span class="text-item w150">${dartEsc(o.orderId)}</span><span class="text-item w150">${dartEsc(o.date || "-")}</span><span class="text-item w150">${dartEsc(o.time || "-")}</span><span class="text-item w200"><span class="status-pill ${dartStatusClass(o.status)}">${dartEsc(o.status)}</span>${riskMeta}</span><span class="text-item w150">${dartEsc(o.clientId || "-")}</span><span class="text-item w200">${dartEsc(o.clientName)}</span><span class="text-item w150">${dartEsc(o.phone1)}</span><span class="text-item w150">${dartEsc(o.phone2 || "-")}</span><span class="text-item w150">${dartEsc(o.email || "-")}</span><span class="text-item w150">${(o.items || []).length}</span><div class="text-item w500"><div class="order-items-grid">${chips}</div></div><span class="text-item w150">${dartMoney(o.totalPrice)}</span><span class="text-item w150">${Number(o.discount) || 0}%</span><span class="text-item w150">${dartEsc(o.reasonDeduction || "-")}</span><span class="text-item w150 order-final-amount">${dartMoney(net)}</span><span class="text-item w150"><span class="payment-cell"><i class="${dartPaymentIcon(o.paymentMethod)}"></i>${dartEsc(o.paymentMethod || "-")}</span></span><span class="text-item w150">${dartEsc(o.paymentStatus || "Unpaid")}</span><span class="text-item w150">${dartEsc(o.orderSource || "Manual")}</span><span class="text-item w150">${dartEsc(rep)}</span><span class="text-item w150">${dartEsc(o.deliveryNotes || "-")}</span><span class="text-item w150">${dartEsc(o.country || "Egypt")}</span><span class="text-item w150">${dartEsc(o.governorate || "-")}</span><span class="text-item w150">${dartEsc(o.area || "-")}</span><span class="text-item w150">${dartEsc(o.street || "-")}</span><span class="text-item w150">${dartEsc(o.building || "-")}</span><span class="text-item w150">${dartEsc(o.floor || "-")}</span></div>`,
    );
  });
  updateOrderCards();
  dartRefreshOrderBusyUi();
}

function dartRenderOrderGroups(container, orders) {
  const groups = window.DartGroups?.groupOrdersForDashboard?.(orders) || [];
  if (!groups.length) {
    container.innerHTML = '<div class="dart-empty-state">No order groups match the current filters.</div>';
    return;
  }
  groups.forEach((group) => {
    const first = group.records[0] || {};
    const statusSummary = Object.entries(group.statusCounts || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) =>
        `<span class="dart-order-group-status"><b>${Number(count)}</b> ${dartEsc(status)}</span>`,
      )
      .join("");
    const orderRefs = group.records
      .map((order) => `<span class="dart-order-group-ref"><b>${dartEsc(order.orderId || order.id || "-")}</b><span>${dartEsc(order.status || "Unknown")}</span></span>`)
      .join("");
    const location = group.location?.classified
      ? [first.country || "Egypt", first.governorate, first.area].filter(Boolean).join(" · ")
      : "Unclassified";
    container.insertAdjacentHTML(
      "beforeend",
      `<article class="dart-order-group-card" data-order-group-key="${dartEsc(group.key)}">
        <header>
          <div><small>Creation date</small><strong>${dartEsc(group.dateKey)}</strong></div>
          <div><small>Location</small><strong>${dartEsc(location)}</strong></div>
          <div><small>Orders</small><strong>${group.records.length}</strong></div>
          <div><small>Statuses</small><strong>${Object.keys(group.statusCounts || {}).length}</strong></div>
        </header>
        <article class="dart-order-group-block"><h3>Status breakdown</h3><div class="dart-order-group-statuses">${statusSummary}</div></article>
        <article class="dart-order-group-block"><details class="dart-order-group-details"><summary>Order numbers · ${group.records.length}</summary><div class="dart-order-group-refs">${orderRefs}</div></details></article>
      </article>`,
    );
  });
}

// Prepare authorized Sets in the dashboard without adding work to storefront pages.
window.addEventListener("dart:admin-authenticated", () => {
  if (window.DartAdminHydration?.ready === true && window.DartAdminAccess?.can?.("sets.read") === true)
    document.dispatchEvent(new Event("dart:sets-load-request"));
});

function dartAppendOperationGroupHeading(container, type, count, noun, record, note, groupKey = "") {
  const template = document.getElementById("dashboard-operation-group-template");
  if (!template) return;
  const fragment = template.content.cloneNode(true);
  const heading = fragment.querySelector("[data-operation-group-heading]");
  if (heading) {
    heading.dataset.operationGroupCount = String(count);
    if (groupKey) heading.dataset.operationGroupKey = String(groupKey);
  }
  fragment.querySelector('[data-operation-group-field="title"]').textContent = `${type} group · ${count} ${noun}`;
  fragment.querySelector('[data-operation-group-field="route"]').textContent = `${record.clientName || record.clientId || "Customer"} · ${[record.street, record.area, record.governorate].filter(Boolean).join("، ")}`;
  fragment.querySelector('[data-operation-group-field="note"]').textContent = note;
  container.appendChild(fragment);
}

function renderReturns(dataArray) {
  const c = document.getElementById("returns-container");
  if (!c) return;
  const template = document.getElementById("dashboard-return-row-template");
  c.replaceChildren();
  if (!template) return;
  const sorted = getSortedData(dataArray).sort(
    (a, b) =>
      new Date(b.createdAt || dartDateValue(b.date) || 0) -
      new Date(a.createdAt || dartDateValue(a.date) || 0),
  );
  const operationalGroups = window.DartGroups?.groupReturns?.(sorted) || [];
  const activeGroupedIds = new Set(operationalGroups.flatMap((group) => group.records.map((row) => String(row.id))));
  const orderedRows = [...operationalGroups.flatMap((group) => group.records), ...sorted.filter((row) => !activeGroupedIds.has(String(row.id)))];
  const groupMeta = new Map();
  operationalGroups.forEach((group) => group.records.forEach((row, index) => groupMeta.set(String(row.id), { ...group, index })));
  orderedRows.forEach((r) => {
      const meta = groupMeta.get(String(r.id));
      if (meta?.records.length > 1 && meta.index === 0) {
        dartAppendOperationGroupHeading(c, "Pickup", meta.records.length, "requests", r, "Each return and physical item remains independent.", meta.key);
      }
      const fragment = template.content.cloneNode(true);
      const row = fragment.querySelector("[data-return-row]");
      row.className = getRowClass(r);
      row.dataset.id = r.id;
      const checkbox = row.querySelector("[data-return-checkbox]");
      checkbox.checked = Boolean(r.isChecked);
      checkbox.disabled = dartIsArchived(r);
      const archiveIcon = row.querySelector(".btn-delete i");
      archiveIcon.className = `bx ${dartIsArchived(r) ? "bx-revision" : "bx-minus-circle"}`;
      const mayDecide = r.status === "Pending Request";
      const mayAssign = r.status === "Approved - Awaiting Representative";
      const mayInspect = r.status === "Pending Inspection" ||
        (r.isPostDeliveryReturn && r.status === "Completed" && (r.inspectionStatus || "Pending") === "Pending");
      row.querySelector(".return-accept-btn").hidden = !mayDecide;
      row.querySelector(".return-reject-btn").hidden = !mayDecide;
      row.querySelector(".return-assign-btn").hidden = !mayAssign;
      row.querySelector(".return-good-btn").hidden = !mayInspect;
      row.querySelector(".return-bad-btn").hidden = !mayInspect;
      row.querySelector(".return-rollback-btn").hidden = !window.DartReturns?.canRollback?.(r);
      const customerFee = Number(r.customerCourierFee) || 0;
      const brandFee = Number(r.brandCourierFee) || 0;
      const replacement = r.replacementItemCode ||
        (dartReturnIsExchange(r) ? `${r.requestedColor || "-"} / ${r.requestedSize || "-"}` : "-");
      const values = {
        returnId: r.returnId || "-",
        requestType: r.requestType || (r.isPostDeliveryReturn ? "Refund" : "Refusal"),
        modelId: r.modelId || "-",
        itemCode: r.itemCode || "-",
        replacement,
        status: dartReturnRules()?.publicStatus?.(r) || r.status || "-",
        inspection: r.inspectionStatus || (r.status === "Good" || r.status === "Damaged" ? r.status : "Pending"),
        date: r.date || "-",
        clientName: r.clientName || "-",
        clientId: r.clientId || "-",
        phone1: r.phone1 || "-",
        courierFee: customerFee > 0
          ? `${dartMoney(customerFee)} · Customer → Representative`
          : brandFee > 0
            ? `${dartMoney(brandFee)} · Dart → Representative`
            : "No fee",
        representative: r.representativeName || r.representativeBusinessId || "Not assigned",
        pickupAddress: dartReturnPickupAddress(r) || "-",
        reason: r.reason || "-",
        rejectionReason: r.rejectionReason || "-",
        orderId: r.orderId || "-",
      };
      Object.entries(values).forEach(([field, value]) => {
        const element = row.querySelector(`[data-return-field="${field}"]`);
        if (element) element.textContent = value;
      });
      const status = row.querySelector('[data-return-field="status"]');
      status?.classList.toggle("return-status-good", ["Completed", "Good"].includes(r.status));
      c.appendChild(fragment);
    });
}

