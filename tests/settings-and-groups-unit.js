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
