function dartReturnRules() {
  return window.DartReturns || null;
}

function dartReturnIsExchange(record) {
  return dartReturnRules()?.isExchange(record) ||
    String(record?.requestType || "").toLowerCase().includes("exchange");
}

function dartReturnPickupAddress(record) {
  return record?.fullAddress ||
    [record?.building, record?.street, record?.area, record?.governorate, record?.country]
      .filter(Boolean)
      .join(", ");
}

function dartReturnReplacementCandidates(record) {
  return itemsData.filter(
    (item) =>
      dartIsActive(item) &&
      String(item.status || "").toLowerCase() === "in stock" &&
      String(item.modelId) === String(record.modelId) &&
      String(item.color) === String(record.requestedColor) &&
      String(item.size) === String(record.requestedSize),
  );
}

async function dartRefreshReturnServerState() {
  if (window.DartDomainState?.hydrateDomain) {
    await window.DartDomainState.hydrateDomain("returns", true);
    await window.DartDomainState.hydrateDomain("damage", true);
  }
  if (window.DartCatalog?.hydrate) {
    await window.DartCatalog.hydrate(true);
  }
}

async function dartAdminReturnAction(record, body) {
  if (!window.DartAdminApi?.request) return null;
  const payload = await window.DartAdminApi.request(
    `/api/v1/admin/returns/${encodeURIComponent(record.returnId || record.id)}/action`,
    { method: "POST", body },
  );
  await dartRefreshReturnServerState();
  return payload.return || null;
}

async function dartApproveReturn(record, replacementItemCode = "") {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "approve",
        ...(replacementItemCode ? { replacementItemCode } : {}),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return approval failed." };
    }
  }
  if (!record || record.status !== "Pending Request") return { ok: false, message: "Request is no longer pending." };
  let replacement = null;
  if (dartReturnIsExchange(record)) {
    replacement = dartReturnReplacementCandidates(record).find(
      (item) => String(item.itemCode) === String(replacementItemCode),
    );
    if (!replacement) return { ok: false, message: "Choose an available replacement item with the requested model, color and size." };
    record.approvalSnapshot = dartReturnRules()?.captureApprovalSnapshot?.(record, replacement, dartNowISO()) || null;
    replacement.status = "Processing/Held";
    replacement.orderId = record.orderId;
    replacement.returnRequestId = record.id;
    replacement.exchangeChainId = record.exchangeChainId || record.itemCode;
    record.replacementItemCode = replacement.itemCode;
    record.replacementItemId = replacement.id;
    const originalLine = record.originalLineSnapshot || {};
    record.replacementLineSnapshot = {
      ...originalLine,
      itemId: replacement.id,
      itemCode: replacement.itemCode,
      modelCode: replacement.modelId,
      color: replacement.color,
      size: String(replacement.size),
      exchangedFromItemCode: record.itemCode,
    };
  }
  if (!record.approvalSnapshot)
    record.approvalSnapshot = dartReturnRules()?.captureApprovalSnapshot?.(record, null, dartNowISO()) || null;
  const old = record.status;
  record.status = "Approved - Awaiting Representative";
  record.acceptedAt = dartNowISO();
  record.updatedAt = record.acceptedAt;
  record.inspectionStatus = record.inspectionStatus || "Pending";
  dartAudit("RETURN_ACCEPTED", "returns", record.id, { status: old }, { status: record.status, replacementItemCode: record.replacementItemCode || "" });
  dartNotify("return_accepted", `${record.returnId}: Approved`, "Request approved and waiting for a pickup representative.", "returns", record.id);
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartRejectReturn(record, reason) {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "reject",
        reason: String(reason || "").trim(),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return rejection failed." };
    }
  }
  if (!record || record.status !== "Pending Request") return { ok: false, message: "Request is no longer pending." };
  if (!String(reason || "").trim()) return { ok: false, message: "A rejection reason is required." };
  record.rejectionSnapshot = dartReturnRules()?.captureWorkflowSnapshot?.(
    record,
    ["rejectionReason", "rejectedAt", "updatedAt"],
    dartNowISO(),
  ) || null;
  const old = record.status;
  record.status = "Rejected";
  record.rejectionReason = String(reason).trim();
  record.rejectedAt = dartNowISO();
  record.updatedAt = record.rejectedAt;
  dartAudit("RETURN_REJECTED", "returns", record.id, { status: old }, { status: record.status, reason: record.rejectionReason });
  dartNotify("return_rejected", `${record.returnId}: Rejected`, record.rejectionReason, "returns", record.id, "warning");
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartAssignReturnRepresentative(record, representativeId, pickupGroupId = "") {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "assign",
        representativeId: String(representativeId || ""),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Representative assignment failed." };
    }
  }
  if (!record || record.status !== "Approved - Awaiting Representative") return { ok: false, message: "Approve the request before assigning a representative." };
  const representative = dartFindRepById(representativeId);
  if (!representative || !dartIsActive(representative) || representative.status !== "Active") return { ok: false, message: "Choose an active representative." };
  record.assignmentSnapshot = dartReturnRules()?.captureWorkflowSnapshot?.(
    record,
    ["representativeId", "representativeBusinessId", "representativeName", "representativePhone", "pickupGroupId", "assignedAt", "updatedAt"],
    dartNowISO(),
  ) || null;
  const old = record.status;
  record.status = "Representative Assigned";
  record.representativeId = representative.id;
  record.representativeBusinessId = representative.repId;
  record.representativeName = representative.name;
  record.representativePhone = representative.phone1;
  record.pickupGroupId = pickupGroupId || record.pickupGroupId || window.DartGroups?.newId?.("RPG") || `RPG-${Date.now()}`;
  record.assignedAt = dartNowISO();
  record.updatedAt = record.assignedAt;
  dartAudit("RETURN_REP_ASSIGNED", "returns", record.id, { status: old }, { status: record.status, representativeId: representative.id });
  dartNotify("return_representative_assigned", `${record.returnId}: Representative assigned`, representative.name, "returns", record.id);
  dartSaveAll();
  dartRefreshAll();
  return { ok: true };
}

async function dartInspectReturn(record, condition) {
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, {
        action: "inspect",
        condition,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Return inspection failed." };
    }
  }
  if (!record) return;
  const isLegacyRefusal = !record.isPostDeliveryReturn && record.status === "Pending Inspection";
  const canInspectCompleted = record.isPostDeliveryReturn &&
    (record.status === "Completed" || Boolean(record.completedAt)) &&
    (record.inspectionStatus || "Pending") === "Pending";
  if (!isLegacyRefusal && !canInspectCompleted) return;
  const item = dartFindItemByCode(record.itemCode);
  if (!item) return;
  const order = ordersData.find((row) => String(row.orderId) === String(record.orderId));
  const card = order?.dartCardId ? cardsData.find((row) => row.cardId === order.dartCardId) : null;
  record.inspectionSnapshot = dartReturnRules()?.captureInspectionSnapshot?.(
    record,
    item,
    card,
    damageData,
    dartNowISO(),
  ) || null;
  const previousInspection = record.inspectionStatus || "Pending";
  record.inspectionStatus = condition;
  record.inspectedAt = dartNowISO();
  record.updatedAt = record.inspectedAt;
  if (isLegacyRefusal) record.status = condition;
  if (condition === "Good") {
    const model = dartFindModelByCode(item.modelId);
    item.status = "In stock";
    item.orderId = "";
    item.clientId = "";
    item.clientName = "";
    item.returnRequestId = "";
    item.restockedAt = record.inspectedAt;
    item.restockedSellingPrice = Number(model?.discountedPrice ?? model?.selling) || 0;
  } else {
    item.status = "Damaged";
    item.updatedAt = record.inspectedAt;
    if (!damageData.some((damage) => damage.itemCode === item.itemCode && ["Damaged", "Destroyed"].includes(damage.status))) {
      const damageRecord = {
        id: dartUid("DMGDB"),
        damageId: dartUid("DMG"),
        itemCode: item.itemCode,
        modelId: item.modelId,
        img: item.img || "",
        color: item.color,
        size: item.size,
        status: "Damaged",
        reason: record.reason || "Return inspection - Damaged",
        notes: "",
        date: new Date().toLocaleDateString("en-GB"),
        createdAt: record.inspectedAt,
        inspectedAt: record.inspectedAt,
        costSnapshot: Number(record.originalLineSnapshot?.costSnapshot) || Number(dartFindModelByCode(item.modelId)?.cost) || 0,
        orderId: record.orderId || "",
        requestType: record.requestType || (record.isPostDeliveryReturn ? "Refund" : "Refusal"),
        exchangeChainId: record.exchangeChainId || "",
        clientId: record.clientId || "",
        clientName: record.clientName || "",
        returnId: record.returnId || "",
        isArchived: false,
        isDeleted: false,
        isChecked: false,
      };
      damageData.push(damageRecord);
      record.inspectionDamageId = damageRecord.id;
    }
  }
  if (!dartReturnIsExchange(record) && !record.dartCardUsageReversed) {
    if (card && order.dartCardUsageRecorded) {
      card.purchasedItems = String(Math.max(0, Number(card.purchasedItems || 0) - 1));
      card.requestedProducts = (card.requestedProducts || []).filter((code) => String(code) !== String(record.itemCode));
      if (card.status === "Expired" && Number(card.purchasedItems) < Number(card.itemLimit || card.purchasedLimit || 10) && (!dartDateValue(card.expDate) || dartDateValue(card.expDate) >= new Date())) card.status = "Active";
      record.dartCardUsageReversed = true;
    }
  }
  dartAudit("RETURN_INSPECTION", "returns", record.id, { inspectionStatus: previousInspection }, { inspectionStatus: condition });
  dartNotify(condition === "Good" ? "return_good" : "item_damaged", `${record.itemCode}: ${condition}`, condition === "Good" ? "Item returned to stock at the model's current selling price." : "Item moved to Damage.", "returns", record.id, condition === "Good" ? "info" : "warning");
  dartSaveAll();
  dartRefreshAll();
}

async function dartRollbackReturn(record) {
  const rules = dartReturnRules();
  if (!record || !rules?.canRollback?.(record)) {
    window.DartDialog.alert("لا توجد خطوة سابقة آمنة لهذا المرتجع.");
    return;
  }
  const warning = [
    `تحذير: سيتم إرجاع المرتجع ${record.returnId || record.id} خطوة واحدة للخلف.`,
    "سيتم عكس الحالة التشغيلية الآمنة لهذه الخطوة، وسيُسجل الإجراء في سجل المراجعة.",
    "بعد استلام المرتجع تنتهي رحلة الاسترجاع/الاستبدال ولا يمكن الرجوع منها بهذه الأداة.",
  ].join("\n\n");
  if (!await window.DartDialog.confirm(warning)) return;
  if (window.DartAdminApi?.request) {
    try {
      await dartAdminReturnAction(record, { action: "back" });
    } catch (error) {
      window.DartDialog.alert(error.message || "تعذر إرجاع المرتجع خطوة واحدة.");
    }
    return;
  }
  const before = {
    status: record.status,
    inspectionStatus: record.inspectionStatus || "Pending",
    financialCompletionApplied: Boolean(record.financialCompletionApplied),
    exchangeCompletionApplied: Boolean(record.exchangeCompletionApplied),
  };
  const result = rules.rollbackOneStep(record, {
    items: itemsData,
    orders: ordersData,
    cards: cardsData,
    damage: damageData,
  }, dartNowISO());
  if (!result.ok) {
    window.DartDialog.alert(result.message || "تعذر التراجع عن هذه الخطوة بأمان.");
    return;
  }
  const after = {
    status: record.status,
    inspectionStatus: record.inspectionStatus || "Pending",
    financialCompletionApplied: Boolean(record.financialCompletionApplied),
    exchangeCompletionApplied: Boolean(record.exchangeCompletionApplied),
  };
  dartAudit("RETURN_ROLLBACK", "returns", record.id, before, after, `Reversed ${result.step} one step`);
  dartNotify(
    "return_rollback",
    `${record.returnId || record.id}: رجوع خطوة`,
    `${result.previousStatus} → ${result.newStatus}`,
    "returns",
    record.id,
    "warning",
  );
  dartSaveAll();
  dartRefreshAll();
}

// BEGIN Return decision — approval, representative pickup, completion, then inspection.
function dartDecideReturn(record, decision) {
  if (!record || record.status !== "Pending Request") return;
  dartPendingReturnAction = { record, decision };
  if (decision === "reject") {
    const reason = document.getElementById("return-rejection-reason");
    if (reason) reason.value = "";
    openModal(document.getElementById("return-rejection-modal"));
    return;
  }
  const isExchange = dartReturnIsExchange(record);
  const field = document.getElementById("return-replacement-field");
  const select = document.getElementById("return-replacement-select");
  if (field) field.hidden = !isExchange;
  if (select) {
    select.required = isExchange;
    select.replaceChildren();
    dartReturnReplacementCandidates(record).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.itemCode;
      option.textContent = `${item.itemCode} — ${item.color} / ${item.size}`;
      select.appendChild(option);
    });
  }
  if (isExchange && !select?.options.length) {
    dartPendingReturnAction = null;
    window.DartDialog.alert("No available physical item matches the requested model, color and size.");
    return;
  }
  const summary = document.getElementById("return-approval-summary");
  if (summary) summary.textContent = `${record.returnId} · ${record.requestType || "Return"} · ${record.itemCode}`;
  const fee = document.getElementById("return-approval-fee-note");
  if (fee) fee.textContent = Number(record.customerCourierFee) > 0
    ? `Customer pays ${dartMoney(record.customerCourierFee)} directly to the representative.`
    : Number(record.brandCourierFee) > 0
      ? `Dart pays ${dartMoney(record.brandCourierFee)} to the representative.`
      : "No courier fee.";
  openModal(document.getElementById("return-approval-modal"));
}
// END Return decision.

function renderDamage(dataArray) {
  const c = document.getElementById("damage-container");
  if (!c) return;
  c.innerHTML = "";
  getSortedData(dataArray).forEach((d) =>
    c.insertAdjacentHTML(
      "beforeend",
      `<div class="${getRowClass(d)}" data-id="${dartEsc(d.id)}"><input type="checkbox" class="model-checkbox" ${d.isChecked ? "checked" : ""} ${dartIsArchived(d) ? "disabled" : ""}><div class="w200 button row-action-btns"><button class="action-btn btn-delete"><i class="bx ${dartIsArchived(d) ? "bx-revision" : "bx-minus-circle"}"></i></button><button class="action-btn btn-hard-delete"><i class="bx bx-trash"></i></button><button class="action-btn btn-edit"><i class="bx bx-edit"></i></button>${d.status === "Damaged" ? '<button class="dart-repair-btn">Repaired</button><button class="dart-destroy-btn">Destroyed</button>' : ""}</div><span class="text-item w150">${dartEsc(d.damageId)}</span><span class="text-item w150">${dartEsc(d.itemCode)}</span><span class="text-item w150">${dartEsc(d.modelId || "-")}</span><div class="w100"><img src="${dartEsc(d.img || "https://via.placeholder.com/50")}" class="product-img"></div><span class="text-item w150">${dartEsc(d.color || "-")}</span><span class="text-item w150">${dartEsc(d.size || "-")}</span><span class="text-item w150"><span class="status-pill ${dartStatusClass(d.status)}">${dartEsc(d.status)}</span></span><span class="text-item w200">${dartEsc(d.reason || "-")}</span><span class="text-item w150">${dartEsc(d.date || "-")}</span><span class="text-item w150">${dartEsc(d.orderId || "-")}</span><span class="text-item w150">${dartEsc(d.clientName || d.clientId || "-")}</span><span class="text-item w150">${dartEsc(d.returnId || "-")}</span></div>`,
    ),
  );
}
async function dartSetDamageStatus(d, status) {
  if (!d) return { ok: false, message: "Damage record not found." };

  if (window.DartAdminApi?.request) {
    try {
      await window.DartAdminApi.request(
        `/api/v1/admin/damage/${encodeURIComponent(d.damageId || d.id)}/action`,
        { method: "POST", body: { status } },
      );
      if (window.DartDomainState?.hydrateDomain) {
        await window.DartDomainState.hydrateDomain("damage", true);
      }
      if (window.DartCatalog?.hydrate) {
        await window.DartCatalog.hydrate(true);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Damage action failed." };
    }
  }


  const it = dartFindItemByCode(d.itemCode),
    old = d.status;
  d.status = status;
  d[status === "Repaired" ? "repairDate" : "destroyedAt"] = dartNowISO();
  if (it) it.status = status === "Repaired" ? "In stock" : "Destroyed";
  dartAudit("DAMAGE_STATUS", "damage", d.id, { status: old }, { status });
  dartNotify(
    "damage_status",
    `${d.itemCode}: ${status}`,
    status === "Repaired"
      ? "Item returned to stock."
      : "Item permanently removed from usable inventory.",
    "damage",
    d.id,
    status === "Destroyed" ? "warning" : "info",
  );
  dartSaveAll();
  dartRefreshAll();
}

