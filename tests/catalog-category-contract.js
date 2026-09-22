// DART CODE GUIDE | tests/catalog-category-contract.js
// الغرض: يثبت أن تصنيفات الموديلات ديناميكية وأن فلاتر الداشبورد والموقع لا تعتمد على قائمة ثابتة.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Eye", "Dart Eye.html"), "utf8");
const inventory = fs.readFileSync(path.join(root, "Eye", "dart-inventory.js"), "utf8");
const storefront = fs.readFileSync(path.join(root, "Js", "dart-ui.js"), "utf8");

assert(html.includes('id="modal-category" type="text"'), "Model Category must allow free text.");
assert(html.includes('list="model-category-options"'), "Model Category must expose saved category suggestions.");
assert(html.includes('id="model-category-options"'), "Dynamic category datalist is missing.");
assert((html.match(/data-filter-key="category"/g) || []).length >= 2, "Models and Items must expose category filters.");
assert(!html.includes('<option value="hoodies">Hoodies</option>'), "Dashboard category controls must not be hard-coded to the original three options.");
assert(inventory.includes("function refreshCategoryOptions"), "Dashboard must rebuild category choices from model data.");
assert(inventory.includes("function canonicalCategory"), "Category input must normalize duplicate spelling/case.");
assert(inventory.includes("modelsData.map((model) => model.category)"), "Saved model categories must feed dashboard category options.");
assert(storefront.includes("categoryMap"), "Storefront filters must derive and deduplicate categories dynamically.");
assert(storefront.includes("catalog.forEach(product =>"), "Storefront category options must come from the live public catalog.");

console.log("PASS dynamic catalog category contract");
