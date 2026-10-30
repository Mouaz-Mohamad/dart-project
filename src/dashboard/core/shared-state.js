// ============================================================================
let damageData = [];
let notificationData = [];
let auditData = [];
const DART_LOW_STOCK_THRESHOLD = 5;
const DART_DEAD_STOCK_DAYS = 15;
const DART_ORDER_FLOW = [
  "New",
  "Accepted",
  "Preparing",
  "Out With Representative",
  "Representative On The Way",
  "Delivered",
];
const DART_FINAL_ORDER_STATES = ["Delivered", "Refused", "Cancelled"];
let dartPendingOrderAction = null;
let dartPendingReturnAction = null;
const dartFilterState = {};

function dartNowISO() {
  return new Date().toISOString();
}
function dartUid(prefix = "ID") {
  const randomPart =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4)))
          .map((value) => value.toString(36))
          .join("-");
  return `${prefix}-${randomPart}`;
}
function dartMoney(v) {
  return `${window.DartState.formatMoney(v)} EGP`;
}
function dartEsc(v) {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function dartDateValue(v) {
  if (!v) return null;
  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(v)) {
    const [d, m, y] = v.split(/[/-]/);
    return new Date(`${y}-${m}-${d}T00:00:00`);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
// BEGIN Client age — derived from birthday and today's calendar date.
function dartClientAge(birthday, today = new Date()) {
  const born = dartDateValue(birthday);
  if (!born || born > today) return "-";
  let age = today.getFullYear() - born.getFullYear();
  const birthdayPassed =
    today.getMonth() > born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : "-";
}
function dartClientAgeLabel(birthday) {
  const age = dartClientAge(birthday);
  return age === "-" ? "-" : `${age} years`;
}
// END Client age.
function dartIsArchived(x) {
  return Boolean(x?.isArchived ?? x?.isDeleted);
}
function dartIsActive(x) {
  return !dartIsArchived(x);
}
function dartSetArchived(x, val) {
  x.isArchived = Boolean(val);
  x.isDeleted = Boolean(val);
  x.archivedAt = val ? dartNowISO() : null;
}
function dartStatusClass(s) {
  return `status-${String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}
function dartPaymentIcon(method) {
  const m = String(method || "").toLowerCase();
  if (m.includes("cash on") || m === "cash") return "bx bx-money";
  if (m.includes("insta")) return "bx bx-transfer";
  if (m.includes("wallet") || m.includes("vodafone")) return "bx bx-wallet";
  if (m.includes("card") || m.includes("visa") || m.includes("credit"))
    return "bx bx-credit-card";
  return "bx bx-dollar-circle";
}
function dartFindModelByCode(code) {
  return modelsData.find((m) => String(m.modelId) === String(code));
}
function dartFindItemByCode(code) {
  return itemsData.find((i) => String(i.itemCode) === String(code));
}
function dartFindCustomerByCode(code) {
  return customersData.find((c) => String(c.clientId) === String(code));
}
function dartFindRepById(id) {
  return representativeData.find(
    (r) => String(r.id) === String(id) || String(r.repId) === String(id),
  );
}
function dartOrderNet(order) {
  if (Number.isFinite(Number(order?.finalAmount)))
    return Math.max(0, Number(order.finalAmount));
  if (Array.isArray(order.priceSnapshot) && order.priceSnapshot.length) {
    return (
      order.priceSnapshot.reduce(
        (a, l) => a + (Number(l.finalUnitPrice) || 0) * (Number(l.qty) || 1),
        0,
      ) - (Number(order.orderLevelDiscountAmount) || 0)
    );
  }
  const subtotal = Number(order.totalPrice) || 0,
    pct = Number(order.discount) || 0;
  return Math.max(0, subtotal - (subtotal * pct) / 100);
}

function dartSaveAll() {
  saveDataToStorage("dart_models", modelsData);
  saveDataToStorage("dart_items", itemsData);
  saveDataToStorage("dart_customers", customersData);
  saveDataToStorage("dart_orders", ordersData);
  saveDataToStorage("dart_returns", returnsData);
  saveDataToStorage("dart_reviews", reviewsData);
  saveDataToStorage("dart_cards", cardsData);
  saveDataToStorage("dart_representatives", representativeData);
  saveDataToStorage("dart_damage", damageData);
  saveDataToStorage("dart_notifications", notificationData);
  saveDataToStorage("dart_audit", auditData);
  // Business schema state is server-authoritative.
}

function getRowClass(item) {
  return dartIsArchived(item)
    ? "model-row row-deleted"
    : "model-row row-normal";
}
function getSortedData(dataArray) {
  return [...(dataArray || [])].sort(
    (a, b) =>
      Number(dartIsArchived(a)) - Number(dartIsArchived(b)) ||
      String(b.createdAt || b.date || b.regDate || "").localeCompare(
        String(a.createdAt || a.date || a.regDate || ""),
      ),
  );
}

function dartAudit(
  action,
  entityType,
  entityId,
  oldValues = {},
  newValues = {},
  note = "",
) {
  auditData.unshift({
    id: dartUid("AUD"),
    action,
    entityType,
    entityId: String(entityId || ""),
    timestamp: dartNowISO(),
    oldValues,
    newValues,
    actorRole: "Admin",
    actorId: null,
    note,
  });
  if (auditData.length > 1500) auditData.length = 1500;
}
function dartNotify(
  type,
  title,
  message,
  entityType = "",
  entityId = "",
  severity = "info",
) {
  notificationData.unshift({
    id: dartUid("NOT"),
    type,
    title,
    message,
    timestamp: dartNowISO(),
    relatedEntityType: entityType,
    relatedEntityId: String(entityId || ""),
    read: false,
    severity,
  });
  if (notificationData.length > 500) notificationData.length = 500;
  renderNotifications();
}
function dartLogOrder(order, type, previousStatus, newStatus, meta = {}) {
  order.activityLog = Array.isArray(order.activityLog) ? order.activityLog : [];
  order.activityLog.push({
    id: dartUid("EVT"),
    type,
    previousStatus: previousStatus || null,
    newStatus: newStatus || order.status,
    timestamp: dartNowISO(),
    representativeId: meta.representativeId || order.representativeId || null,
    reason: meta.reason || "",
    notes: meta.notes || "",
    actorRole: meta.actorRole || "Admin",
    actorId: meta.actorId || null,
  });
}

