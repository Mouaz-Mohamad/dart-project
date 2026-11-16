// DART CODE GUIDE | tests/admin-cart-release-runtime.cjs
// Exercise the maintained inventory UI and live cart reconciliation with synthetic APIs.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync("src/dashboard/inventory.js", "utf8");
const tick = () => new Promise(setImmediate);
function fixture() {
  const item = { id: "piece-1", itemCode: "SERIAL-1", modelId: "MODEL", color: "Black", size: "M",
    status: "Cart Reserved", version: 4, cartReservationId: "CART-SYNTHETIC-12345" };
  const status = { textContent: "" }, calls = [];
  let rows = [item], allowed = true, confirm = true;
  const catalog = { active: () => true, cover: () => "image", isServerAuthoritative: () => true,
    releaseCartItem: async value => { calls.push(value); return { released: true }; },
    hydrate: async () => { rows = [{ ...item, status: "In stock", cartReservationId: null, version: 5 }]; },
    items: () => rows };
  const context = { DartCatalog: catalog, itemsData: rows, modelsData: [], getRowClass: () => "model-row",
    dartRefreshAll() {}, console,
    document: { getElementById: id => id === "inventory-release-status" ? status : null, addEventListener() {} },
    window: { addEventListener() {}, DartAdminAccess: { can: () => allowed },
      DartDialog: { confirm: async () => confirm } } };
  vm.runInNewContext(source.replace("  window.DartInventory = {",
    "  window.inventoryTest = { rowMarkup, releaseCartItem };\n  window.DartInventory = {"), context);
  return { item, catalog, status, calls, ui: context.window.inventoryTest,
    allow: value => { allowed = value; }, confirm: value => { confirm = value; } };
}
async function inventory() {
  const f = fixture();
  assert.match(f.ui.rowMarkup(f.item), /btn-release-cart/);
  assert.doesNotMatch(f.ui.rowMarkup({ ...f.item, status: "In stock" }), /btn-release-cart/);
  assert.doesNotMatch(f.ui.rowMarkup({ ...f.item, orderId: "ORDER-1" }), /btn-release-cart/);
  f.allow(false); assert.doesNotMatch(f.ui.rowMarkup(f.item), /btn-release-cart/);
  await f.ui.releaseCartItem(f.item); assert.equal(f.calls.length, 0);
  f.allow(true); f.confirm(false); await f.ui.releaseCartItem(f.item); assert.equal(f.calls.length, 0);

  f.confirm(true); let finish;
  f.catalog.releaseCartItem = async value => { f.calls.push(value); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.ui.releaseCartItem(f.item); await tick();
  assert.match(f.status.textContent, /جاري/);
  assert.match(f.ui.rowMarkup(f.item), /disabled aria-busy="true"/);
  await f.ui.releaseCartItem(f.item); assert.equal(f.calls.length, 1, "double clicking cannot send duplicate releases");
  assert.equal(f.item.status, "Cart Reserved", "no optimistic browser-only stock change");
  finish({ released: true }); await pending;
  assert.match(f.status.textContent, /تم فك/);
  assert.doesNotMatch(f.ui.rowMarkup(f.catalog.items()[0]), /btn-release-cart/);

  for (const error of [new Error("offline"), Object.assign(new Error("stale"), { status: 409 })]) {
    const failed = fixture(); failed.catalog.releaseCartItem = async () => { throw error; };
    await failed.ui.releaseCartItem(failed.item);
    assert.equal(failed.item.status, "Cart Reserved");
    assert.match(failed.status.textContent, error.status === 409 ? /اتغيرت/ : /لم يتم تأكيد/);
    assert.doesNotMatch(failed.ui.rowMarkup(failed.item), /disabled aria-busy/);
  }
  const committed = fixture(); committed.catalog.hydrate = async () => { throw Error("refresh offline"); };
  await committed.ui.releaseCartItem(committed.item);
  assert.match(committed.status.textContent, /تم فك الحجز، لكن تعذر تحديث العرض/);
  assert.equal(committed.calls.length, 1, "refresh failure preserves the acknowledged release boundary");
}
async function reconcile() {
  const handlers = new Map(), events = [];
  let cart = [{ id: "MODEL", quantity: 2 }], reads = 0, invalidations = 0, fail = false;
  const context = { API_BASE: "https://dart.test", read: () => cart,
    invalidateCartQuote() { invalidations++; },
    hydrateCustomerCart: async options => { assert.equal(options.claimLocal, false); reads++; if (fail) throw Error("offline"); cart = [{ id: "MODEL", quantity: 1 }]; },
    window: { addEventListener: (name, fn) => handlers.set(name, fn), dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  const lifecycle = fs.readFileSync("src/storefront/platform/lifecycle.js", "utf8");
  const start = lifecycle.indexOf('  window.addEventListener("dart:catalog-hydrated"');
  const end = lifecycle.indexOf('  window.addEventListener("dart:data-changed"', start);
  vm.runInNewContext(lifecycle.slice(start, end), context);
  const update = handlers.get("dart:catalog-hydrated");
  update({ detail: { admin: true } }); assert.equal(reads, 0);
  update({ detail: { admin: false } }); await tick();
  assert.equal(reads, 1); assert.equal(invalidations, 1); assert.equal(cart[0].quantity, 1);
  fail = true; update({ detail: { admin: false } }); await tick();
  assert.equal(cart[0].quantity, 1, "network errors retain the last confirmed cart");
  assert.equal(events.at(-1).detail.code, "CART_REFRESH_FAILED");
  cart = []; update({ detail: { admin: false } }); assert.equal(reads, 2, "empty carts do not issue extra live requests");
}
function actionLabel() {
  const ui = fs.readFileSync("src/dashboard/dashboard-ui.js", "utf8");
  const fn = ui.slice(ui.indexOf("  function syncBusy("), ui.indexOf("  function refresh()"));
  const c = {}; vm.createContext(c); vm.runInContext(fn, c);
  let busy = "false";
  const state = { primary: { disabled: false, hidden: false, textContent: "", title: "Release from Cart", getAttribute: () => busy },
    proxy: { setAttribute() {} } };
  c.syncBusy(state); assert.equal(state.proxy.textContent, "Release from Cart", "icon actions retain their visible title after row decoration");
  busy = "true"; c.syncBusy(state); assert.equal(state.proxy.textContent, "Saving…");
  busy = "false"; c.syncBusy(state); assert.equal(state.proxy.textContent, "Release from Cart");
}
(async () => { await inventory(); await reconcile(); actionLabel(); console.log("PASS admin cart release visibility, permission, confirmation, pending/error/retry states, compact action labels and live customer cart reconciliation"); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
