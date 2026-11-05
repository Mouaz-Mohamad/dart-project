"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const tick = () => new Promise(setImmediate);
const model = i => ({ modelId: `M${i}`, name: `Model ${i}`, selling: 600,
  colorOptions: [{ name: "Black" }], sizeOptions: [{ name: "M" }] });
const chunk = (page, version = 2, total = 205) => {
  const models = Array.from({ length: Math.min(100, total - (page - 1) * 100) }, (_, i) => model((page - 1) * 100 + i));
  return { version, models, stock: Object.fromEntries(models.map(m => [JSON.stringify([m.modelId, "Black", "M"]), 3])),
    pagination: { page, limit: 100, total } };
};
async function fixture(file) {
  const memory = new Map(), writes = [], requests = [];
  let responder = async () => ({ version: 1, models: [model("old")], stock: {} });
  const document = { hidden: false, cookie: "", addEventListener() {} };
  const location = { origin: "https://dart.test", pathname: "/products.html" };
  const window = { DartState: { read: (key, fallback) => memory.get(key) ?? fallback,
    write: (key, value) => { memory.set(key, value); writes.push(key); } },
    addEventListener() {}, dispatchEvent() {}, setInterval() {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { window, document, location, URL,
    console, CustomEvent: class {}, Event: class {}, clearInterval() {}, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const parsed = new URL(url); requests.push(parsed);
      assert.equal(options.method, "GET");
      assert.equal(parsed.searchParams.get("limit"), "100", "every catalog request must be bounded");
      const value = await responder(Number(parsed.searchParams.get("page")));
      return { ok: true, json: async () => value };
    } }, { filename: file });
  await tick();
  return { catalog: window.DartCatalog, memory, writes, requests,
    respond: fn => { responder = fn; requests.length = writes.length = 0; } };
}
async function verifyRestore() {
  const handlers = new Map(), events = [], removed = [];
  let checks = 0, carts = 0, release, fail = false, allowed = true;
  const context = {
    window: { addEventListener: (name, fn) => handlers.set(name, fn), dispatchEvent: event => events.push(event),
      DartCatalog: { hydrate: () => assert.fail("a restored document must not force a full catalog snapshot"),
        refreshChanged: async () => { checks++; if (fail) throw Error("Synthetic offline"); await new Promise(resolve => { release = resolve; }); } },
      DartSets: { clearDrafts() {} }, DartState: { remove: key => removed.push(key) } },
    document: { prerendering: false, addEventListener() {}, body: { hasAttribute: () => false } },
    bindAuth() {}, setInterval() {}, apiSessionChecked: true, apiSessionGeneration: 0, apiSessionPromise: null, apiUserCache: {},
    KEYS: { customers: "customers", orders: "orders", returns: "returns", cards: "cards" },
    cartData: ["stale"], updateCartCount() {}, setCartReservationId() {}, uid: () => "CART-RESTORE",
    sessionStorage: { getItem: () => "CART-RESTORE" }, hydrateApiSession: async () => {},
    enforceCustomerAccountAccess: () => allowed, hydrateCustomerCart: async options => { assert.equal(options.claimLocal, false); carts++; },
    updateCartReservationTimer() {}, renderBirthdayExperience() {}, wireAccountLink() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(fs.readFileSync("src/storefront/platform/lifecycle.js", "utf8"), context);
  const show = handlers.get("pageshow");
  await show({ persisted: false }); assert.equal(checks, 0);
  const first = show({ persisted: true }); await tick(); await show({ persisted: true });
  assert.equal(checks, 1, "overlapping restoration events share one refresh"); assert.equal(carts, 1);
  assert.equal(context.cartData.length, 0); assert.ok(removed.includes("dart_cart"), "private/cart projections are still cleared before account revalidation");
  release(); await first;
  fail = true; await show({ persisted: true });
  assert.equal(events.at(-1).detail.code, "RESTORE_REFRESH_FAILED");
  fail = false; const retry = show({ persisted: true }); await tick(); release(); await retry;
  assert.equal(checks, 3, "a failed restoration releases its guard for the next attempt");
  allowed = false; await show({ persisted: true }); assert.equal(checks, 3, "denied private-route access cannot refresh catalog or commerce");
}
async function verify(file) {
  const f = await fixture(file); let release;
  f.respond(async page => page === 3 ? new Promise(resolve => { release = () => resolve(chunk(page)); }) : chunk(page));
  const pending = f.catalog.hydrate(); await tick();
  assert.equal(f.writes.length, 0, "partial pages never replace the confirmed catalog");
  assert.equal(f.catalog.models()[0].modelId, "Mold");
  release(); await pending;
  assert.equal(f.catalog.models().length, 205);
  assert.deepEqual(f.requests.map(r => r.searchParams.get("page")), ["1", "2", "3"]);
  assert.equal(f.catalog.available(f.catalog.model("M204"), "M", "Black"), 3, "stock from the final page is merged");

  f.respond(async page => { if (page === 2) throw Error("Synthetic offline"); return chunk(page, 3); });
  await assert.rejects(f.catalog.hydrate(), /Synthetic offline/);
  assert.equal(f.catalog.serverVersion(), 2); assert.equal(f.catalog.models().length, 205);
  assert.equal(f.catalog.available(f.catalog.model("M204"), "M", "Black"), 3);

  let first = true;
  f.respond(async page => { const version = first && page === 1 ? 3 : 4; if (page === 2) first = false; return chunk(page, version); });
  await f.catalog.hydrate();
  assert.deepEqual(f.requests.map(r => r.searchParams.get("page")), ["1", "2", "1", "2", "3"]);
  assert.equal(f.catalog.serverVersion(), 4);
  let version = 4;
  f.respond(async page => chunk(page, ++version));
  await assert.rejects(f.catalog.hydrate(), error => error.code === "CATALOG_CHANGED_DURING_READ");
  assert.equal(f.requests.length, 6, "continuous changes have a bounded retry count");
  assert.equal(f.catalog.serverVersion(), 4);

  for (const corrupt of [
    state => { state.models[0].modelId = "M0"; },
    state => { delete state.pagination; },
    state => { state.pagination.total++; },
    state => { state.models.pop(); },
  ]) {
    f.respond(async page => { const state = chunk(page, 5); if (page === 2) corrupt(state); return state; });
    await assert.rejects(f.catalog.hydrate(), error => error.code === "CATALOG_PAGE_INVALID");
    assert.equal(f.catalog.serverVersion(), 4, "malformed or incomplete pages leave the confirmed projection intact");
  }

  f.respond(async page => chunk(page, 6, 0)); await f.catalog.hydrate();
  assert.equal(f.catalog.models().length, 0, "an explicitly empty complete catalog replaces previous data");
  f.respond(async () => ({ version: 7, models: [model("legacy")], stock: {} }));
  await f.catalog.hydrate(); assert.equal(f.requests.length, 1, "older deployed APIs remain compatible");

  f.respond(async page => page === 2 ? new Promise(resolve => { release = () => resolve(chunk(page, 8, 101)); }) : chunk(page, 8, 101));
  const older = f.catalog.hydrate(); await tick();
  f.respond(async () => ({ version: 9, models: [model("newer")], stock: {} }));
  await f.catalog.hydrate(); release(); await older;
  assert.equal(f.catalog.models()[0].modelId, "Mnewer", "a slower complete snapshot cannot overwrite an acknowledged newer version");
}
(async () => {
  for (const file of ["src/storefront/catalog.js", "Js/dart-catalog.js"]) await verify(file);
  await verifyRestore();
  console.log("PASS catalog pagination: bounded requests, atomic complete projection, stock merge, version restarts, offline/invalid recovery and stale-read isolation");
})().catch(error => { console.error(error); process.exitCode = 1; });
