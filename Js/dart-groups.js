// DART | MODULE: dart-groups.js
// Address/order grouping helpers shared by tracking and operations.
// BEGIN MODULE

/* Operational grouping keeps every order/return record independent. */
(function (root) {
  "use strict";

  const FINAL_ORDERS = new Set(["Delivered", "Refused", "Cancelled"]);
  const PRE_ASSIGNMENT_ORDERS = new Set(["New", "Accepted", "Preparing"]);
  const PRE_ASSIGNMENT_RETURNS = new Set(["Pending Request", "Approved - Awaiting Representative"]);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[\s,،._-]+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function customerKey(record) {
    return normalize(record?.clientId || record?.customerId || record?.email || record?.phone1);
  }

  function routeKey(record) {
    return [customerKey(record), record?.country || "Egypt", record?.governorate, record?.area, record?.street]
      .map(normalize)
      .join("|");
  }

  function validRoute(record) {
    return routeKey(record).split("|").every(Boolean);
  }

  function sameRoute(records) {
    const keys = (records || []).map(routeKey);
    return keys.length > 0 && (records || []).every(validRoute) && keys.every((key) => key === keys[0]);
  }

  function group(records, type) {
    const buckets = new Map();
    (records || []).forEach((record) => {
      const id = String(record.id || record.orderId || record.returnId || Math.random());
      let key = `${type}:single:${id}`;
      if (type === "order") {
        if (record.deliveryGroupId) key = `order:assigned:${record.deliveryGroupId}`;
        else if (!record.representativeId && PRE_ASSIGNMENT_ORDERS.has(record.status) && validRoute(record))
          key = `order:auto:${routeKey(record)}`;
      } else {
        if (record.pickupGroupId) key = `return:assigned:${record.pickupGroupId}`;
        else if (!record.representativeId && PRE_ASSIGNMENT_RETURNS.has(record.status) && validRoute(record))
          key = `return:auto:${routeKey(record)}`;
      }
      if (!buckets.has(key)) buckets.set(key, { key, records: [], automatic: key.includes(":auto:") });
      buckets.get(key).records.push(record);
    });
    return [...buckets.values()].map((entry) => ({
      ...entry,
      id: entry.key.split(":").at(-1),
      customerKey: customerKey(entry.records[0]),
      routeKey: routeKey(entry.records[0]),
    }));
  }

  function groupOrders(records) {
    return group((records || []).filter((record) => !record.isDeleted && !record.isArchived && !FINAL_ORDERS.has(record.status)), "order");
  }

  function groupReturns(records) {
    return group((records || []).filter((record) => !record.isDeleted && !record.isArchived && record.status !== "Completed"), "return");
  }

  function newId(prefix) {
    const random = root.crypto?.getRandomValues
      ? root.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
      : Math.random().toString(36).slice(2);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  const api = { normalize, customerKey, routeKey, validRoute, sameRoute, groupOrders, groupReturns, newId };
  root.DartGroups = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);


// END MODULE
