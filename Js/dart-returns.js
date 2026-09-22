// DART CODE GUIDE | Js/dart-returns.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
// DART | MODULE: dart-returns.js
// Customer return/exchange rules, pricing, states, and helpers.
// BEGIN MODULE

/* ========================================================================== */
/* DART RETURNS — shared, backend-ready return and exchange business rules     */
/* The production API must run the same rules transactionally on the server.  */
/* ========================================================================== */
(function (root) {
  "use strict";

  const FLOW = Object.freeze({
    PENDING: "Pending Request",
    APPROVED: "Approved - Awaiting Representative",
    ASSIGNED: "Representative Assigned",
    ON_THE_WAY: "Pickup On The Way",
    COMPLETED: "Completed",
    REJECTED: "Rejected",
  });

  const INSPECTION = Object.freeze({
    PENDING: "Pending",
    GOOD: "Good",
    DAMAGED: "Damaged",
  });

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundMoney(value) {
    return Math.round((number(value) + Number.EPSILON) * 100) / 100;
  }

  function normalizeType(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text.includes("exchange") || text.includes("استبدال")) return "Exchange";
    if (text.includes("refund") || text.includes("return") || text.includes("استرجاع")) return "Refund";
    return "";
  }

  function isExchange(recordOrType) {
    return normalizeType(recordOrType?.requestType || recordOrType) === "Exchange";
  }

  function isRefund(recordOrType) {
    return normalizeType(recordOrType?.requestType || recordOrType) === "Refund";
  }

  function isCompleted(record) {
    const status = String(record?.status || "").toLowerCase();
    return Boolean(
      record?.completedAt ||
        ["completed", "good", "damaged", "bad"].includes(status),
    );
  }

  function lineForItem(order, itemCode, record = null) {
    if (record?.originalLineSnapshot) return record.originalLineSnapshot;
    return (order?.priceSnapshot || []).find(
      (line) => String(line.itemCode) === String(itemCode),
    ) || null;
  }

  function orderSubtotal(order) {
    const linesTotal = (order?.priceSnapshot || []).reduce(
      (sum, line) =>
        sum + number(line.finalUnitPrice) * Math.max(1, number(line.qty, 1)),
      0,
    );
    return Math.max(0, number(order?.totalPrice, linesTotal) || linesTotal);
  }

  // Allocates an order-level discount proportionally to the physical item.
  function allocatedNetAmount(order, itemCode, record = null) {
    const line = lineForItem(order, itemCode, record);
    if (!line) return 0;
    const lineAmount =
      number(line.finalUnitPrice) * Math.max(1, number(line.qty, 1));
    const subtotal = orderSubtotal(order);
    const discount = Number.isFinite(Number(order?.orderLevelDiscountAmount))
      ? Math.max(0, number(order.orderLevelDiscountAmount))
      : Math.max(0, (subtotal * number(order?.discount)) / 100);
    const allocatedDiscount = subtotal > 0 ? discount * (lineAmount / subtotal) : 0;
    return Math.max(0, roundMoney(lineAmount - allocatedDiscount));
  }

  function chainIdForItem(item, fallbackCode = "") {
    return String(item?.exchangeChainId || item?.itemCode || fallbackCode || "");
  }

  function completedExchangeCount(returns, chainId, excludeId = "") {
    const key = String(chainId || "");
    if (!key) return 0;
    return (returns || []).filter(
      (record) =>
        String(record.id) !== String(excludeId || "") &&
        isExchange(record) &&
        isCompleted(record) &&
        String(record.exchangeChainId || record.itemCode) === key,
    ).length;
  }

  function feeSettings() {
    const direct = root.DartSiteSettings?.get?.();
    if (direct) return direct;
    try {
      return root.DartSiteSettings?.get?.() || {};
    } catch {
      return {};
    }
  }

  function courierPolicy(recordOrType, completedExchanges = 0) {
    const settings = feeSettings();
    const refundFee = Math.max(0, number(settings.refundCustomerFee, 100));
    const repeatExchangeFee = Math.max(0, number(settings.repeatExchangeCustomerFee, 50));
    if (isRefund(recordOrType)) {
      return {
        customerFee: refundFee,
        brandFee: 0,
        payer: "Customer",
        label: `Customer pays the representative ${refundFee} EGP`,
      };
    }
    if (isExchange(recordOrType) && number(completedExchanges) < 1) {
      return {
        customerFee: 0,
        brandFee: 50,
        payer: "Brand",
        label: "First completed exchange: Dart pays the representative 50 EGP",
      };
    }
    if (isExchange(recordOrType)) {
      return {
        customerFee: repeatExchangeFee,
        brandFee: 0,
        payer: "Customer",
        label: `Additional exchange: customer pays the representative ${repeatExchangeFee} EGP`,
      };
    }
    return { customerFee: 0, brandFee: 0, payer: "None", label: "No courier fee" };
  }

  function inspectionStatus(record) {
    const explicit = String(record?.inspectionStatus || "");
    if ([INSPECTION.GOOD, INSPECTION.DAMAGED, INSPECTION.PENDING].includes(explicit)) return explicit;
    const legacy = String(record?.status || "").toLowerCase();
    if (legacy === "good") return INSPECTION.GOOD;
    if (["bad", "damaged"].includes(legacy)) return INSPECTION.DAMAGED;
    return INSPECTION.PENDING;
  }

  function publicStatus(record) {
    const status = String(record?.status || "");
    if (status === FLOW.REJECTED) return "Rejected";
    if (isCompleted(record)) return "Return Completed";
    if ([FLOW.APPROVED, FLOW.ASSIGNED, FLOW.ON_THE_WAY, "Pending Inspection"].includes(status)) {
      return "Approved";
    }
    return "Under Review";
  }

  function eventDate(record) {
    return (
      record?.completedAt ||
      record?.resolvedAt ||
      record?.updatedAt ||
      record?.date ||
      record?.createdAt ||
      null
    );
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function captureFields(source, fields) {
    if (!source) return null;
    const values = {};
    const absent = [];
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(source, field)) values[field] = clone(source[field]);
      else absent.push(field);
    });
    return { values, absent };
  }

  function restoreFields(target, snapshot) {
    if (!target || !snapshot) return;
    Object.entries(snapshot.values || {}).forEach(([field, value]) => {
      target[field] = clone(value);
    });
    (snapshot.absent || []).forEach((field) => delete target[field]);
  }

  const COMPLETION_ITEM_FIELDS = Object.freeze([
    "status", "orderId", "clientId", "clientName", "phone1", "phone2", "email",
    "purchaseDate", "returnRequestId", "exchangeChainId", "exchangedFromItemCode", "updatedAt",
  ]);
  const COMPLETION_ORDER_FIELDS = Object.freeze([
    "items", "priceSnapshot", "amountRefunded", "refundedAt", "paymentStatus", "exchangeHistory", "activityLog",
  ]);
  const COMPLETION_CARD_FIELDS = Object.freeze(["purchasedItems", "requestedProducts", "status"]);
  const INSPECTION_ITEM_FIELDS = Object.freeze([
    "status", "orderId", "clientId", "clientName", "returnRequestId", "restockedAt",
    "restockedSellingPrice", "updatedAt",
  ]);

  function captureCompletionSnapshot(record, originalItem, replacementItem, order, card, capturedAt = new Date().toISOString()) {
    return {
      version: 1,
      capturedAt,
      originalItem: captureFields(originalItem, COMPLETION_ITEM_FIELDS),
      replacementItem: captureFields(replacementItem, COMPLETION_ITEM_FIELDS),
      order: captureFields(order, COMPLETION_ORDER_FIELDS),
      card: captureFields(card, COMPLETION_CARD_FIELDS),
      record: captureFields(record, [
        "financialCompletionApplied", "exchangeCompletionApplied", "dartCardUsageReversed",
        "refundAmount", "customerCourierFeeStatus", "brandCourierFeeStatus",
      ]),
    };
  }

  function captureInspectionSnapshot(record, item, card, damageRows, capturedAt = new Date().toISOString()) {
    return {
      version: 1,
      capturedAt,
      item: captureFields(item, INSPECTION_ITEM_FIELDS),
      card: captureFields(card, COMPLETION_CARD_FIELDS),
      record: captureFields(record, ["status", "inspectionStatus", "inspectedAt", "dartCardUsageReversed"]),
      damageIds: (damageRows || []).map((row) => String(row.id)),
    };
  }

  function captureWorkflowSnapshot(record, fields, capturedAt = new Date().toISOString()) {
    return { version: 1, capturedAt, record: captureFields(record, fields || []) };
  }

  function captureApprovalSnapshot(record, replacementItem, capturedAt = new Date().toISOString()) {
    return {
      ...captureWorkflowSnapshot(record, [
        "acceptedAt", "updatedAt", "inspectionStatus", "replacementItemCode",
        "replacementItemId", "replacementLineSnapshot",
      ], capturedAt),
      replacementItem: captureFields(replacementItem, COMPLETION_ITEM_FIELDS),
    };
  }

  function findByCode(rows, field, value) {
    return (rows || []).find((row) => String(row?.[field]) === String(value));
  }

  function canRollback(record) {
    if (!record) return false;
    const status = String(record.status || "");
    const inspected = inspectionStatus(record) !== INSPECTION.PENDING;
    return inspected || [
      FLOW.APPROVED,
      FLOW.ASSIGNED,
      FLOW.ON_THE_WAY,
      FLOW.COMPLETED,
      FLOW.REJECTED,
      "Good",
      "Damaged",
      "Bad",
    ].includes(status);
  }

  function addRollbackActivity(record, previousStatus, nextStatus, step, timestamp) {
    record.activityLog = record.activityLog || [];
    record.activityLog.push({
      action: "RETURN_ROLLBACK",
      rollbackStep: step,
      previousStatus,
      newStatus: nextStatus,
      timestamp,
      actorRole: "Admin",
    });
  }

  function rollbackInspection(record, context, timestamp) {
    const previousStatus = String(record.status || "");
    const item = findByCode(context.items, "itemCode", record.itemCode);
    const order = findByCode(context.orders, "orderId", record.orderId);
    const card = order?.dartCardId ? findByCode(context.cards, "cardId", order.dartCardId) : null;
    const snapshot = record.inspectionSnapshot;
    if (snapshot) {
      restoreFields(item, snapshot.item);
      restoreFields(card, snapshot.card);
      restoreFields(record, snapshot.record);
    } else if (item) {
      item.status = "Return Inspection";
      item.orderId = record.orderId || item.orderId || "";
      item.clientId = record.clientId || order?.clientId || item.clientId || "";
      item.clientName = record.clientName || order?.clientName || item.clientName || "";
      item.returnRequestId = record.id;
      item.updatedAt = timestamp;
      delete item.restockedAt;
      delete item.restockedSellingPrice;
    }
    const existingDamageIds = new Set((snapshot?.damageIds || []).map(String));
    for (let index = (context.damage || []).length - 1; index >= 0; index -= 1) {
      const row = context.damage[index];
      const createdByInspection = String(row.returnId || "") === String(record.returnId || "") &&
        String(row.itemCode || "") === String(record.itemCode || "") &&
        !existingDamageIds.has(String(row.id));
      if (String(row.id) === String(record.inspectionDamageId || "") || createdByInspection)
        context.damage.splice(index, 1);
    }
    const legacy = ["Good", "Damaged", "Bad"].includes(previousStatus) || !record.isPostDeliveryReturn;
    record.status = legacy ? "Pending Inspection" : FLOW.COMPLETED;
    record.inspectionStatus = INSPECTION.PENDING;
    record.inspectedAt = null;
    record.inspectionDamageId = "";
    record.inspectionSnapshot = null;
    record.updatedAt = timestamp;
    addRollbackActivity(record, previousStatus, record.status, "Inspection", timestamp);
    return { ok: true, step: "Inspection", previousStatus, newStatus: record.status };
  }

  function fallbackCompletionRollback(record, context, timestamp) {
    const originalItem = findByCode(context.items, "itemCode", record.itemCode);
    const replacement = findByCode(context.items, "itemCode", record.replacementItemCode);
    const order = findByCode(context.orders, "orderId", record.orderId);
    const card = order?.dartCardId ? findByCode(context.cards, "cardId", order.dartCardId) : null;
    if (originalItem) {
      originalItem.status = "Sold";
      originalItem.orderId = record.orderId || originalItem.orderId || "";
      originalItem.clientId = record.clientId || order?.clientId || originalItem.clientId || "";
      originalItem.clientName = record.clientName || order?.clientName || originalItem.clientName || "";
      originalItem.returnRequestId = "";
      originalItem.updatedAt = timestamp;
    }
    if (isRefund(record) && order && record.financialCompletionApplied) {
      order.amountRefunded = Math.max(0, roundMoney(number(order.amountRefunded) - number(record.refundAmount || record.originalNetAmount)));
      order.refundedAt = order.amountRefunded ? order.refundedAt : null;
      order.paymentStatus = order.amountRefunded
        ? "Partially Refunded"
        : number(order.amountPaid) > 0 || order.status === "Delivered" || Boolean(order.deliveredAt)
          ? "Paid"
          : "Unpaid";
    }
    if (isRefund(record) && card && record.dartCardUsageReversed) {
      card.purchasedItems = String(number(card.purchasedItems) + 1);
      card.requestedProducts = Array.from(new Set([...(card.requestedProducts || []), record.itemCode]));
      const limit = number(card.itemLimit || card.purchasedLimit, 10);
      if (number(card.purchasedItems) >= limit) card.status = "Expired";
    }
    if (isExchange(record) && order) {
      if (replacement) {
        replacement.status = "Processing/Held";
        replacement.orderId = record.orderId || "";
        replacement.returnRequestId = record.id;
        replacement.clientId = "";
        replacement.clientName = "";
        replacement.phone1 = "";
        replacement.phone2 = "";
        replacement.email = "";
        replacement.purchaseDate = "";
        replacement.exchangedFromItemCode = "";
        replacement.updatedAt = timestamp;
      }
      order.items = (order.items || []).map((code) =>
        String(code) === String(record.replacementItemCode) ? record.itemCode : code,
      );
      order.priceSnapshot = (order.priceSnapshot || []).map((line) =>
        String(line.itemCode) === String(record.replacementItemCode)
          ? clone(record.originalLineSnapshot || { ...line, itemCode: record.itemCode })
          : line,
      );
      order.exchangeHistory = (order.exchangeHistory || []).filter((row) =>
        String(row.returnId || "") !== String(record.returnId || ""),
      );
    }
  }

  function rollbackCompletion(record, context, timestamp) {
    const originalItem = findByCode(context.items, "itemCode", record.itemCode);
    const replacement = findByCode(context.items, "itemCode", record.replacementItemCode);
    const order = findByCode(context.orders, "orderId", record.orderId);
    const card = order?.dartCardId ? findByCode(context.cards, "cardId", order.dartCardId) : null;
    const snapshot = record.completionSnapshot;
    if (snapshot) {
      restoreFields(originalItem, snapshot.originalItem);
      restoreFields(replacement, snapshot.replacementItem);
      restoreFields(order, snapshot.order);
      restoreFields(card, snapshot.card);
      restoreFields(record, snapshot.record);
      record.completionSnapshot = null;
    } else {
      fallbackCompletionRollback(record, context, timestamp);
      record.financialCompletionApplied = false;
      record.exchangeCompletionApplied = false;
      record.dartCardUsageReversed = false;
    }
    const previousStatus = String(record.status || FLOW.COMPLETED);
    record.status = FLOW.ON_THE_WAY;
    record.completedAt = null;
    record.inspectionStatus = INSPECTION.PENDING;
    record.inspectedAt = null;
    record.updatedAt = timestamp;
    addRollbackActivity(record, previousStatus, record.status, "Completion", timestamp);
    if (order) {
      order.activityLog = order.activityLog || [];
      order.activityLog.push({
        action: "RETURN_COMPLETION_ROLLED_BACK",
        returnId: record.returnId,
        itemCode: record.itemCode,
        timestamp,
        actorRole: "Admin",
      });
    }
    return { ok: true, step: "Completion", previousStatus, newStatus: record.status };
  }

  function rollbackOneStep(record, context = {}, timestamp = new Date().toISOString()) {
    const data = {
      items: Array.isArray(context.items) ? context.items : [],
      orders: Array.isArray(context.orders) ? context.orders : [],
      cards: Array.isArray(context.cards) ? context.cards : [],
      damage: Array.isArray(context.damage) ? context.damage : [],
    };
    if (!canRollback(record)) return { ok: false, message: "This return has no previous step." };
    if (inspectionStatus(record) !== INSPECTION.PENDING) return rollbackInspection(record, data, timestamp);
    if (String(record.status) === FLOW.COMPLETED || Boolean(record.completedAt))
      return rollbackCompletion(record, data, timestamp);

    const previousStatus = String(record.status || "");
    if (previousStatus === FLOW.ON_THE_WAY) {
      restoreFields(record, record.pickupSnapshot?.record);
      record.pickupSnapshot = null;
      record.status = FLOW.ASSIGNED;
    } else if (previousStatus === FLOW.ASSIGNED) {
      restoreFields(record, record.assignmentSnapshot?.record);
      record.assignmentSnapshot = null;
      record.status = FLOW.APPROVED;
    } else if (previousStatus === FLOW.APPROVED) {
      const replacement = findByCode(data.items, "itemCode", record.replacementItemCode);
      const approvalSnapshot = record.approvalSnapshot;
      if (approvalSnapshot) {
        restoreFields(replacement, approvalSnapshot.replacementItem);
        restoreFields(record, approvalSnapshot.record);
      } else if (replacement && String(replacement.returnRequestId || "") === String(record.id)) {
        replacement.status = "In stock";
        replacement.orderId = "";
        replacement.returnRequestId = "";
        replacement.exchangeChainId = "";
        replacement.updatedAt = timestamp;
      }
      record.status = FLOW.PENDING;
      if (!approvalSnapshot) {
        record.acceptedAt = null;
        record.replacementItemCode = "";
        record.replacementItemId = "";
        record.replacementLineSnapshot = null;
      }
      record.approvalSnapshot = null;
    } else if (previousStatus === FLOW.REJECTED) {
      restoreFields(record, record.rejectionSnapshot?.record);
      record.rejectionSnapshot = null;
      record.status = FLOW.PENDING;
      if (!record.rejectionSnapshot) {
        record.rejectionReason = "";
        record.rejectedAt = null;
      }
    } else {
      return { ok: false, message: "This return has no safe previous step." };
    }
    record.updatedAt = timestamp;
    addRollbackActivity(record, previousStatus, record.status, "Workflow", timestamp);
    return { ok: true, step: "Workflow", previousStatus, newStatus: record.status };
  }

  const api = {
    FLOW,
    INSPECTION,
    normalizeType,
    isExchange,
    isRefund,
    isCompleted,
    inspectionStatus,
    publicStatus,
    lineForItem,
    orderSubtotal,
    allocatedNetAmount,
    chainIdForItem,
    completedExchangeCount,
    courierPolicy,
    feeSettings,
    eventDate,
    roundMoney,
    captureCompletionSnapshot,
    captureInspectionSnapshot,
    captureWorkflowSnapshot,
    captureApprovalSnapshot,
    canRollback,
    rollbackOneStep,
  };

  root.DartReturns = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);


// END MODULE
