globalThis.location = globalThis.location || {
  origin: "http://localhost",
  pathname: "/products.html",
};

"use strict";

const assert = require("assert");

const memory = new Map([
  ["dart_v7_empty_start_completed", "1"],
  ["dart_models", JSON.stringify([])],
  ["dart_items", JSON.stringify([])],
]);
global.window = global;
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
  key(index) { return [...memory.keys()][index] || null; },
  get length() { return memory.size; },
};
global.sessionStorage = {
  getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0,
};
global.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
global.dispatchEvent = () => {};
global.addEventListener = () => {};
global.DartSiteSettings = { activeSiteDiscount: () => null };

require("../Js/dart-catalog.js");

const model = { selling: 600, discount: 50 };
assert.deepStrictEqual(
  DartCatalog.pricing(model),
  { originalPrice: 600, finalPrice: 300, effectiveDiscountPercent: 50, discountSource: "Model" },
  "A model discount must expose both prices and its percentage",
);

DartSiteSettings.activeSiteDiscount = () => ({ type: "Site", percent: 20 });
assert.deepStrictEqual(
  DartCatalog.pricing(model),
  { originalPrice: 600, finalPrice: 480, effectiveDiscountPercent: 20, discountSource: "Site" },
  "Site discount takes precedence over model discount and must never stack",
);
assert.strictEqual(DartCatalog.modelPrice(model), 300, "Immutable order snapshots keep the model price when no order-level promotion applies");

DartSiteSettings.activeSiteDiscount = () => null;
assert.deepStrictEqual(
  DartCatalog.pricing({ selling: 600, discount: 0 }),
  { originalPrice: 600, finalPrice: 600, effectiveDiscountPercent: 0, discountSource: "" },
  "A regular product card must remain unchanged",
);

console.log("PASS catalog product-card pricing and discount priority");
