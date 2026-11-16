"use strict";
// Regression: live options, exact physical states, scoped variants and operational filters.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Option {
  constructor(label, value) { this.textContent = label; this.value = value; }
}
class Select {
  constructor() {
    this.options = [new Option("All", "all")];
    this.dataset = {};
    this.value = "all";
  }
  replaceChildren(...options) {
    this.options = options;
    this.value = options[0]?.value || "all";
  }
}
class Section {
  constructor(keys) {
    this.fields = Object.fromEntries(keys.map((key) => [key, new Select()]));
  }
  querySelector(selector) {
    if (selector === ".filter-bar") return {};
    const key = selector.match(/data-filter-key="([^"]+)"/)?.[1];
    return key ? this.fields[key] || null : null;
  }
}
const fields = {
  models: ["category", "size", "color", "status"],
  items: ["category", "size", "color", "status"],
  orders: ["status", "deliveryMode", "carrier", "codVerification"],
  returns: ["status", "inspection", "returnType"],
  review: ["status"], representative: ["status"],
  card: ["status"], damage: ["status"],
};
const sections = Object.fromEntries(Object.entries(fields)
  .map(([key, keys]) => [key, new Section(keys)]));
const records = {
  models: [
    { modelId: "J1", category: "Jeans", available: 1, total: 2, sizeOptions: [
      { name: "30", active: true }, { name: "32", active: true }, { name: "26", active: false },
    ], colorOptions: [{ name: "Navy", active: true }] },
    { modelId: "T1", category: "Hoodies", available: 0, total: 0,
      sizeOptions: [{ name: "M", active: true }, { name: "XL", active: true }],
      colorOptions: [{ name: "Black", active: true }, { name: "Old White", active: false }] },
    { modelId: "OLD", category: "Archived", isArchived: true, available: 0, total: 1,
      sizeOptions: [{ name: "4XL", active: true }], colorOptions: [{ name: "Orange", active: true }] },
  ],
  items: [
    { modelId: "J1", itemCode: "a", size: "30", color: "Navy", status: "In stock" },
    { modelId: "J1", itemCode: "b", size: "32", color: "Navy", status: "Processing/Held" },
    { modelId: "T1", itemCode: "c", size: "M", color: "Black", status: "Sold" },
    { modelId: "OLD", itemCode: "old", size: "4XL", color: "Orange", status: "Sold", isArchived: true },
  ],
  orders: [
    { status: "New", createdAt: new Date().toISOString(), codVerificationStatus: "Verified",
      deliveryShipment: { type: "external", companyName: "Fast Ship" } },
    { status: "Delivered", createdAt: new Date().toISOString(),
      representativeId: "REP-1" },
  ],
  returns: [
    { status: "Completed", inspectionStatus: "Good", requestType: "Refund" },
    { status: "Pending Inspection", inspectionStatus: "Pending", requestType: "Exchange" },
  ],
  review: [], representative: [], card: [], damage: [],
};
const filters = {};
let rendered = [];
const context = vm.createContext({
  window: { DartCatalog: {} },
  document: { getElementById: (key) => sections[key] || null },
  Option, Date, console,
  dartFilterState: filters,
  modelsData: records.models,
  itemsData: records.items,
  sectionsMap: Object.fromEntries(Object.entries(records)
    .map(([key, data]) => [key, { data }])),
  DART_ORDER_FLOW: ["New", "Accepted", "Preparing", "Ready for Dispatch", "Out With Representative", "Representative On The Way", "Delivered"],
  dartModelDerived: (model) => ({ count: model.available, total: model.total }),
  dartSectionSearchText: (row) => JSON.stringify(row).toLowerCase(),
  dartApplyFilters: (_key, data) => [...(data || [])],
  dartRenderSection: (key) => { rendered.push(key); },
  setupSearchFilter: () => {},
  dartPopulateItemSizeFilter: () => {},
});
vm.runInContext(fs.readFileSync("Eye/dart-dynamic-filters.js", "utf8"), context);
const values = (section, key) => sections[section].fields[key].options.map((option) => option.value);
const refresh = context.window.DartDashboardDynamicFilters.refresh;
filters.items = { archive: "active" };
refresh("items");
assert.deepEqual(values("items", "size"), ["all", "30", "32", "M", "XL"]);
assert.deepEqual(values("items", "color"), ["all", "Black", "Navy"]);
assert(!values("items", "size").includes("26"), "inactive variants must not appear");
assert(!values("items", "size").includes("4XL"), "archived models must not appear in active view");
filters.items.category = "Jeans";
filters.items.size = "M";
refresh("items");
assert.deepEqual(values("items", "size"), ["all", "30", "32"]);
assert.equal(filters.items.size, "all", "removed options must clear internal state");
filters.items = { archive: "active", status: "In stock" };
assert.deepEqual(Array.from(context.dartApplyFilters("items", records.items), (row) => row.itemCode), ["a"]);
filters.items.status = "Processing/Held";
assert.deepEqual(Array.from(context.dartApplyFilters("items", records.items), (row) => row.itemCode), ["b"]);
filters.items = { archive: "active", sizeProfile: "pants" };
refresh("items");
assert.deepEqual(values("items", "size"), ["all", "30", "32"]);
filters.items = { archive: "archived" };
refresh("items");
assert(values("items", "size").includes("4XL"), "history must retain archived variants");
filters.models = { archive: "active", status: "out-of-stock" };
assert.deepEqual(Array.from(context.dartApplyFilters("models", records.models), (row) => row.modelId), ["T1"]);
filters.models.status = "in-stock";
assert.deepEqual(Array.from(context.dartApplyFilters("models", records.models), (row) => row.modelId), ["J1"]);
filters.orders = { archive: "active", deliveryMode: "external", carrier: "Fast Ship", codVerification: "Verified" };
assert.deepEqual(Array.from(context.dartApplyFilters("orders", records.orders), (row) => row.status), ["New"]);
refresh("orders");
assert(values("orders", "status").includes("Needs Attention"), "known non-current order states must remain selectable");
filters.returns = { archive: "active", inspection: "Good", returnType: "Refund" };
assert.deepEqual(Array.from(context.dartApplyFilters("returns", records.returns), (row) => row.status), ["Completed"]);
refresh("returns");
assert(values("returns", "status").includes("Pending Inspection"), "inspection states must be selectable");
assert.equal(records.items[0].status, "In stock", "filtering never mutates inventory");
assert.equal(records.models[0].sizeOptions.length, 3, "filtering never mutates model variants");
context.dartRenderSection("orders");
assert.deepEqual(rendered, ["orders"], "wrapped renderer must preserve its original invocation");
console.log("PASS dynamic dashboard filters: live variants, archive, cascading state, exact status, delivery, COD and returns");
