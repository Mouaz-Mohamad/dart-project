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

  function courierPolicy(recordOrType, completedExchanges = 0) {
    if (isRefund(recordOrType)) {
      return {
        customerFee: 100,
        brandFee: 0,
        payer: "Customer",
        label: "Customer pays the representative 100 EGP",
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
        customerFee: 50,
        brandFee: 0,
        payer: "Customer",
        label: "Additional exchange: customer pays the representative 50 EGP",
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
    eventDate,
    roundMoney,
  };

  root.DartReturns = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
