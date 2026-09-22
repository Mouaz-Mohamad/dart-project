// DART CODE GUIDE | tests/settings-reset-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const settings = require(path.join(__dirname, "..", "Eye", "dart-settings.js"));

class StorageMock {
  constructor(entries) {
    this.values = new Map(Object.entries(entries));
  }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  removeItem(key) { this.values.delete(key); }
}

assert.equal(settings.CONFIRMATION_PHRASE, "DELETE DART");
assert.equal(settings.isDartStorageKey("dart_orders"), true);
assert.equal(settings.isDartStorageKey("dart_finance_expenses"), true);
assert.equal(settings.isDartStorageKey("user_last_address"), true);
assert.equal(settings.isDartStorageKey("order_45_state"), true);
assert.equal(settings.isDartStorageKey("unrelated_preference"), false);

const storage = new StorageMock({
  dart_orders: "[]",
  dart_finance_expenses: "[]",
  dart_session: "{}",
  user_last_address: "{}",
  order_45_state: "delivered",
  unrelated_preference: "keep-me",
});
const removed = settings.clearDartStorage(storage);
assert.deepEqual(new Set(removed), new Set(["dart_orders", "dart_finance_expenses", "dart_session", "user_last_address", "order_45_state"]));
assert.equal(storage.getItem("unrelated_preference"), "keep-me", "Reset must preserve unrelated origin storage.");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Eye", "Dart Eye.html"), "utf8");
const script = fs.readFileSync(path.join(root, "Eye", "dart-settings.js"), "utf8");
for (const id of ["settings", "open-reset-data-modal", "reset-data-modal", "reset-confirmation-input", "reset-understand-checkbox", "confirm-reset-data"]) {
  assert(html.includes(`id="${id}"`), `Missing static settings HTML #${id}.`);
}
assert.equal((html.match(/data-target="settings"/g) || []).length, 2, "Settings must exist in desktop and mobile navigation.");
assert(html.includes('href="dart-settings.css"'));
assert(html.includes('src="dart-settings.js"'));
assert(script.includes("clearCatalogMedia"), "Reset must clear IndexedDB product images.");
assert(!script.includes("localStorage.clear("), "Reset must never clear unrelated origin storage.");

console.log("PASS guarded Settings reset and Dart-only storage scope");
