// DART CODE GUIDE | tests/sets-runtime-contract.cjs
// Browser contract for page-scoped Sets loading and additive storefront/dashboard integration.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const settings = fs.readFileSync("Js/dart-site-settings.js", "utf8");
const sets = fs.readFileSync("Js/dart-sets.js", "utf8");
const admin = fs.readFileSync("Eye/dart-sets-admin.js", "utf8");
const profile = fs.readFileSync("Js/dart-profile-records.js", "utf8");

assert.match(settings, /SET_STOREFRONT_PAGES/);
for (const page of ["/index.html", "/products.html", "/cart-checkout.html", "/profile.html"]) {
  assert(settings.includes(page), `Sets loader must include ${page}`);
}
assert(settings.includes('[data-target="models"]'), "Dart Eye Sets must lazy-load from Models navigation");
assert(settings.includes("dart:sets-load-request"), "Sets loader must expose an explicit lazy-load request hook");
assert(profile.includes('dart:sets-extension-ready'), "Profile rows must re-enhance after lazy Sets runtime loads");

assert(sets.includes('/api/v1/sets'), "Storefront Sets client must use the server Sets API");
assert(sets.includes('/api/v1/cart/set-groups'), "Set cart operations must use the server Set-cart API");
assert(sets.includes("setFilterActive"), "Storefront must expose the Sets product filter state");
assert(sets.includes("data-set-color") && sets.includes("data-set-size"), "Set modal must select color and size per component");

assert(admin.includes('data-model-set-view="sets"'), "Models section must expose the Sets tab");
assert(admin.includes("data-set-component-add"), "Set editor must support adding components");
assert(admin.includes('can("sets.manage")'), "Set mutations must honor central dashboard permissions");
assert(admin.includes("Selling Below Cost"), "Owner below-cost override must remain visibly warned");

console.log("PASS Sets lazy runtime, storefront and Dart Eye contracts");
