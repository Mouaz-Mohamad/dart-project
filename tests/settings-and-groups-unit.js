// DART CODE GUIDE | tests/settings-and-groups-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const assert = require("assert");
const groups = require("../Js/dart-groups.js");

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
};
global.location = { origin: "", pathname: "/" };
global.DartState = {
  read(key, fallback) { try { return JSON.parse(global.localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { global.localStorage.setItem(key, JSON.stringify(value)); },
};
const settings = require("../Js/dart-site-settings.js");
const zeroSettings = settings.save({ ...settings.get(), defaultMarkupPercent: 0, birthdayDiscountPercent: 0, dartCardDiscountPercent: 0 });
assert.strictEqual(zeroSettings.defaultMarkupPercent, 0, "Zero is a valid future-model markup setting");
assert.strictEqual(zeroSettings.birthdayDiscountPercent, 0, "Zero is a valid Birthday setting");
assert.strictEqual(zeroSettings.dartCardDiscountPercent, 0, "Zero is a valid Dart Card setting");
assert.strictEqual(settings.heroWordSize(72), "72px", "Numeric Hero Word sizes need a CSS unit");
assert.strictEqual(settings.heroWordSize("48px"), "48px", "Saved CSS-like Hero Word sizes must normalize safely");
assert.strictEqual(settings.heroWordSize(500), "120px", "Hero Word sizes must stay within the editor limit");

const base = {
  clientId: "DA-1", country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Makram Ebeid",
  status: "New", representativeId: "",
};
const orderGroups = groups.groupOrders([
  { ...base, id: "O1", orderId: "K-1" },
  { ...base, id: "O2", orderId: "K-2", street: "  makram-eBEID " },
  { ...base, id: "O3", orderId: "K-3", clientId: "DA-2" },
]);
assert.strictEqual(orderGroups.length, 2, "Only the same customer and normalized route may share a pre-assignment group");
assert.strictEqual(orderGroups.find((group) => group.records.some((row) => row.id === "O1")).records.length, 2);

const assigned = groups.groupOrders([
  { ...base, id: "O1", status: "Out With Representative", representativeId: "R1", deliveryGroupId: "DLG-1" },
  { ...base, id: "O2", status: "Out With Representative", representativeId: "R1", deliveryGroupId: "DLG-1" },
  { ...base, id: "O4", status: "New" },
]);
assert.strictEqual(assigned.length, 2, "Assigned group IDs remain fixed while later unassigned orders form another trip");
assert(groups.sameRoute([base, { ...base, id: "O5" }]), "Matching hierarchy must share a route");
assert(!groups.sameRoute([base, { ...base, street: "Another street" }]), "A different street must never be grouped");

const dashboardGroups = groups.groupOrdersForDashboard([
  { ...base, id: "DG-1", orderId: "K-101", clientId: "DA-1", status: "New", createdAt: "2026-11-10T22:30:00.000Z" },
  { ...base, id: "DG-2", orderId: "K-102", clientId: "DA-2", status: "Preparing", street: "Different street", createdAt: "2026-11-11T08:00:00+02:00" },
  { ...base, id: "DG-3", orderId: "K-103", status: "New", date: "12-11-2026" },
  { ...base, id: "DG-4", orderId: "K-104", status: "Accepted", area: "", date: "11-11-2026" },
]);
assert.strictEqual(dashboardGroups.length, 3, "Dashboard groups use Cairo creation date plus country, governorate and area");
const cairoGroup = dashboardGroups.find((group) => group.dateKey === "2026-11-11" && group.location.classified);
assert.deepStrictEqual(cairoGroup.orderRefs, ["K-101", "K-102"], "Customer and street must not split a dashboard order group");
assert.deepStrictEqual({ ...cairoGroup.statusCounts }, { New: 1, Preparing: 1 }, "Mixed statuses must be summarized inside one group");
assert(dashboardGroups.some((group) => !group.location.classified), "Missing location data must appear in Unclassified");

const returns = groups.groupReturns([
  { ...base, id: "R1", status: "Approved - Awaiting Representative" },
  { ...base, id: "R2", status: "Approved - Awaiting Representative" },
  { ...base, id: "R3", status: "Completed" },
]);
assert.strictEqual(returns.length, 1);
assert.strictEqual(returns[0].records.length, 2, "Completed return pickups must disappear from active groups");

delete global.localStorage;
delete global.location;
delete global.DartState;

console.log("PASS configurable settings grouping contract");
