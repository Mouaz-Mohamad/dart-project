function dartNextStatus(status) {
  const i = DART_ORDER_FLOW.indexOf(status);
  return i >= 0 && i < DART_ORDER_FLOW.length - 1
    ? DART_ORDER_FLOW[i + 1]
    : null;
}
function dartCanTransition(order, target) {
  if (!order || dartIsArchived(order)) return false;
  if (order.status === target) return false;
  if (target === "Cancelled")
    return !["Delivered", "Refused", "Cancelled"].includes(order.status);
  if (target === "Refused")
    return ["Out With Representative", "Representative On The Way"].includes(
      order.status,
    );
  if (
    target === "Preparing" &&
    String(order.paymentMethod || "").toLowerCase().includes("cash")
  ) {
    const verificationStatus = String(
      order.verificationStatus || order.codVerificationStatus || "Not Required",
    );
    if (!["Not Required", "Verified"].includes(verificationStatus)) return false;
  }
  if (target === "Preparing" && order.status === "Out With Representative")
    return true; // representative cancelled pickup
  if (order.status === "Needs Attention") return false;
  return dartNextStatus(order.status) === target;
}
function dartPriceSnapshotForCodes(codes) {
  return codes.map((code) => {
    const item = dartFindItemByCode(code);
    const model = dartFindModelByCode(item?.modelId);
    if (!item || !model) throw new Error("Missing model or physical item");
    return DartCatalog.snapshot(model, item);
  });
}
function dartReserveItems(order, codes) {
  const seen = new Set();
  for (const code of codes) {
    const it = dartFindItemByCode(code);
    if (
      !it ||
      seen.has(code) ||
      dartIsArchived(it) ||
      String(it.status).toLowerCase() !== "in stock"
    )
      return { ok: false, message: `Item ${code} is not available.` };
    seen.add(code);
  }
  codes.forEach((code) => {
    const it = dartFindItemByCode(code);
    it.status = "Processing/Held";
    it.orderId = order.orderId;
    it.clientId = order.clientId;
    it.clientName = order.clientName;
    it.phone1 = order.phone1;
    it.phone2 = order.phone2;
    it.email = order.email;
  });
  return { ok: true };
}
function dartReleaseOrderItems(order, toStatus = "In stock") {
  (order.items || []).forEach((code) => {
    const it = dartFindItemByCode(code);
    if (it && !["Damaged", "Destroyed"].includes(it.status)) {
      it.status = toStatus;
      if (toStatus === "In stock") {
        it.orderId = "";
        it.clientId = "";
        it.clientName = "";
        it.purchaseDate = "";
      }
    }
  });
}
function dartAssignRepresentative(order, repId) {
  const rep = dartFindRepById(repId);
  if (!rep || dartIsArchived(rep) || rep.status !== "Active") return false;
  order.representativeId = rep.id;
  order.representativeBusinessId = rep.repId;
  order.representativeName = rep.name;
  order.representativePhone = rep.phone1 || "";
  order.deliveryStartedAt = null;
  order.courierLocation = null;
  return true;
}

function dartUpdateBirthdayRewardForOrder(order, target) {
  if (window.DartOrdersApi) return;
  if (!order?.birthdayRewardId) return;
  let rewards;
  rewards = window.DartState?.read?.("dart_birthday_rewards", []) || [];
  const reward = rewards.find((row) => row.id === order.birthdayRewardId);
  if (!reward) return;
  if (target === "Delivered") {
    reward.status = "Used";
    reward.usedCount = 1;
    reward.usedAt = order.deliveredAt || dartNowISO();
    order.birthdayRewardUsageRecorded = true;
  } else if (["Cancelled", "Refused"].includes(target)) {
    reward.status = new Date() < new Date(reward.expiresAt) ? "Active" : "Expired";
    reward.orderId = "";
    reward.reservedAt = null;
    order.birthdayRewardUsageRecorded = false;
  }
  if (window.DartDomainState?.write) {
    window.DartDomainState.write("dart_birthday_rewards", rewards);
  } else if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    window.DartState?.write?.("dart_birthday_rewards", rewards, { source: "dashboard" });
  } else {
    throw new Error("Birthday rewards require the secure server state.");
  }
}

function dartPersistOrderWorkflow() {
  if (window.DartOrdersApi) {
    saveDataToStorage("dart_orders", ordersData);
    saveDataToStorage("dart_notifications", notificationData);
    return;
  }
  dartSaveAll();
}

async function dartApplyTransition(order, target, meta = {}) {
  if (window.DartOrdersApi?.isBusy?.(order.orderId || order.id))
    return { ok: false, message: "This order already has an action in progress." };
  if (!dartCanTransition(order, target))
    return {
      ok: false,
      message: `Invalid transition: ${order.status} → ${target}`,
    };
  const prev = order.status,
    now = dartNowISO(),
    serverAuthoritative = Boolean(window.DartOrdersApi);
  if (target === "Out With Representative" && !meta.representativeId)
    return { ok: false, needsRep: true };
  if (window.DartOrdersApi?.workflow) {
    try {
      await window.DartOrdersApi.workflow(order.orderId || order.id, {
        expectedStatus: order.status,
        target,
        ...(meta.representativeId
          ? { representativeId: String(meta.representativeId) }
          : {}),
        ...(meta.deliveryGroupId
          ? { deliveryGroupId: String(meta.deliveryGroupId) }
          : {}),
        ...(meta.reason ? { reason: String(meta.reason) } : {}),
        ...(meta.notes ? { notes: String(meta.notes) } : {}),
      });
      return { ok: true };
    } catch (error) {
      if (
        ["ORDER_STATE_STALE", "COD_VERIFICATION_REQUIRED"].includes(error?.code)
      ) {
        await window.DartOrdersApi.hydrate(true).catch(() => {});
      }
      return {
        ok: false,
        message: error?.message || "Order status was not committed to the server.",
      };
    }
  }
  if (
    target === "Out With Representative" &&
    !dartAssignRepresentative(order, meta.representativeId)
  )
    return { ok: false, message: "Representative is not available." };
  if (target === "Out With Representative" && !order.deliveryGroupId)
    order.deliveryGroupId = window.DartGroups?.newId?.("DLG") || `DLG-${Date.now()}`;
  if (target === "Preparing" && prev === "Out With Representative") {
    order.representativeId = null;
    order.representativeBusinessId = "";
    order.representativeName = "";
    order.representativePhone = "";
    order.deliveryGroupId = "";
  }
  order.status = target;
  const stamps = {
    Accepted: "acceptedAt",
    Preparing: "preparingAt",
    "Out With Representative": "outWithRepresentativeAt",
    "Representative On The Way": "representativeOnWayAt",
    Delivered: "deliveredAt",
    Refused: "refusedAt",
    Cancelled: "cancelledAt",
    "Needs Attention": "needsAttentionAt",
  };
  if (stamps[target]) order[stamps[target]] = now;
  if (target === "Delivered") {
    if (!serverAuthoritative) {
      (order.items || []).forEach((code) => {
        const it = dartFindItemByCode(code);
        if (it) {
          it.status = "Sold";
          it.purchaseDate = new Date().toLocaleDateString("en-GB");
        }
      });
    }
    if (
      order.paymentMethod &&
      String(order.paymentMethod).toLowerCase().includes("cash") &&
      order.paymentStatus === "Unpaid"
    ) {
      order.paymentStatus = "Paid";
      order.amountPaid = dartOrderNet(order);
      order.paidAt = now;
    }
    if (!serverAuthoritative && order.dartCardId && !order.dartCardUsageRecorded) {
      const card = cardsData.find(
        (c) => c.cardId === order.dartCardId && c.status === "Active",
      );
      if (card) {
        card.purchasedItems = String(
          Number(card.purchasedItems || 0) +
            Number(order.totalProducts || order.items?.length || 0),
        );
        card.requestedProducts = [
          ...new Set([
            ...(card.requestedProducts || []),
            ...(order.items || []),
          ]),
        ];
        if (
          Number(card.purchasedItems) >=
          Number(card.itemLimit || card.purchasedLimit || 10)
        )
          card.status = "Expired";
        order.dartCardUsageRecorded = true;
      }
    }
  }
  if (target === "Refused") {
    order.refusalReason = meta.reason || "Other";
    order.refusalNotes = meta.notes || "";
    if (!serverAuthoritative)
      dartCreateInspectionReturns(order, order.refusalReason);
  }
  if (target === "Cancelled") {
    order.cancelledByRole = meta.actorRole || "Admin";
    order.cancelledBy = meta.actorId || null;
    order.cancellationReason = meta.reason || "Cancelled";
    if (!serverAuthoritative) dartReleaseOrderItems(order, "In stock");
  }
  if (
    !serverAuthoritative &&
    ["Delivered", "Cancelled", "Refused"].includes(target)
  )
    dartUpdateBirthdayRewardForOrder(order, target);
  dartLogOrder(order, meta.type || "STATUS_CHANGED", prev, target, meta);
  dartAudit(
    "ORDER_STATUS_CHANGE",
    "orders",
    order.id,
    { status: prev },
    { status: target },
    meta.reason || "",
  );
  dartNotify(
    `order_${target.toLowerCase().replace(/ /g, "_")}`,
    `${order.orderId}: ${target}`,
    meta.reason || `Order moved from ${prev} to ${target}.`,
    "orders",
    order.id,
    target === "Needs Attention" ? "warning" : "info",
  );
  if (!meta.suppressRefresh) {
    dartPersistOrderWorkflow();
    dartRefreshAll();
  }
  return { ok: true };
}
async function dartBatchTransition(orders, target, meta = {}) {
  if (orders.some((order) => window.DartOrdersApi?.isBusy?.(order.orderId || order.id)))
    return { ok: false, message: "A selected order already has an action in progress." };
  const statuses = new Set(orders.map((order) => String(order.status || "")));
  if (statuses.size !== 1)
    return {
      ok: false,
      message: "حدد أوردرات من نفس الحالة الحالية لتنفيذ عملية جماعية.",
    };
  if (target === "Out With Representative" && !meta.representativeId)
    return { ok: false, needsRep: true };
  if (
    target === "Out With Representative" &&
    !dartFindRepById(meta.representativeId)
  ) return { ok: false, message: "Representative unavailable." };

  if (window.DartOrdersApi?.bulkWorkflow) {
    try {
      const payload = await window.DartOrdersApi.bulkWorkflow({
        orderRefs: orders.map((order) => String(order.orderId || order.id)),
        expectedStatus: String(orders[0]?.status || ""),
        target,
        ...(meta.representativeId
          ? { representativeId: String(meta.representativeId) }
          : {}),
        ...(meta.reason ? { reason: String(meta.reason) } : {}),
        ...(meta.notes ? { notes: String(meta.notes) } : {}),
      });
      const result = payload?.result || {};
      const succeeded = Array.isArray(result.succeeded) ? result.succeeded : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      dartRefreshAll();
      if (failed.length) {
        const details = failed
          .map((row) => `${row.orderRef}: ${row.message || row.code || "Failed"}`)
          .join("\n");
        window.DartDialog.alert(
          `نجح ${succeeded.length} من ${orders.length} أوردر.\nفشل ${failed.length}:\n${details}`,
        );
      }
      return {
        ok: succeeded.length > 0,
        message: succeeded.length ? "" : "لم يتم تحديث أي أوردر.",
        result,
      };
    } catch (error) {
      return {
        ok: false,
        message: error?.message || "Bulk order update was not committed.",
      };
    }
  }

  for (const original of orders) {
    const current =
      ordersData.find(
        (row) =>
          String(row.id) === String(original.id) ||
          String(row.orderId) === String(original.orderId),
      ) || original;
    const result = await dartApplyTransition(current, target, {
      ...meta,
      suppressRefresh: true,
    });
    if (!result.ok) return result;
  }
  if (!window.DartOrdersApi?.workflow) {
    dartPersistOrderWorkflow();
    dartRefreshAll();
  }
  return { ok: true };
}

