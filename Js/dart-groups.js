// DART CODE GUIDE | Js/dart-groups.js
// الغرض: وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.
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
        if (record.deliveryGroupId) {
          key = `order:assigned:${record.deliveryGroupId}`;
        } else if (!record.representativeId && PRE_ASSIGNMENT_ORDERS.has(record.status) && customerKey(record)) {
          // Before any order leaves with a representative, all active orders for
          // the same customer are one operational group. Their individual
          // addresses/items remain visible inside the group and remain separate
          // records; assignment can still validate/route each destination.
          key = `order:auto:${customerKey(record)}`;
        }
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

  function cairoCreationDate(record) {
    const raw = record?.createdAt || record?.created_at || record?.date || "";
    const legacy = String(raw).trim().match(/^(\d{1,2})[-\/]([0-1]?\d)[-\/](\d{4})$/);
    if (legacy) {
      return `${legacy[3]}-${String(legacy[2]).padStart(2, "0")}-${String(legacy[1]).padStart(2, "0")}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "unknown-date";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function dashboardOrderLocation(record) {
    const country = normalize(record?.country || "Egypt");
    const governorate = normalize(record?.governorate);
    const area = normalize(record?.area);
    const classified = Boolean(country && governorate && area);
    return { country, governorate, area, classified };
  }

  function groupOrdersForDashboard(records) {
    const buckets = new Map();
    (records || [])
      .filter((record) => !record?.isDeleted && !record?.isArchived)
      .forEach((record) => {
        const dateKey = cairoCreationDate(record);
        const location = dashboardOrderLocation(record);
        const locationKey = location.classified
          ? `${location.country}|${location.governorate}|${location.area}`
          : "unclassified";
        const key = `${dateKey}|${locationKey}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            key,
            dateKey,
            location,
            records: [],
            statusCounts: Object.create(null),
            orderRefs: [],
          });
        }
        const bucket = buckets.get(key);
        bucket.records.push(record);
        const status = String(record?.status || "Unknown");
        bucket.statusCounts[status] = (bucket.statusCounts[status] || 0) + 1;
        bucket.orderRefs.push(String(record?.orderId || record?.id || "-"));
      });
    return [...buckets.values()].sort((a, b) =>
      b.dateKey.localeCompare(a.dateKey) || a.key.localeCompare(b.key),
    );
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

  const api = {
    normalize,
    customerKey,
    routeKey,
    validRoute,
    sameRoute,
    groupOrders,
    groupOrdersForDashboard,
    cairoCreationDate,
    groupReturns,
    newId,
  };
  root.DartGroups = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);


// END MODULE
