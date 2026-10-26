"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const read = (file) => fs.readFileSync(file, "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const line = (quantity) => ({ id: "M1", color: "Black", size: "M", quantity, reservationUntil: new Date(Date.now() + 600000).toISOString() });
const fields = { customer_name: "Synthetic", phone1: "01000000001", email: "synthetic@example.test", country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Synthetic", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" };
const form = { elements: { namedItem: (name) => ({ value: fields[name] || "" }) }, dataset: {} };

function cartContext() {
  const state = { dart_cart: [line(1)] }, calls = [], gates = [];
  const context = { API_BASE: "https://synthetic.test", CART_RESERVATION_ID: "CART-SYNTHETIC", cartData: state.dart_cart,
    currentUser: () => ({ id: "customer", name: "Synthetic", email: fields.email }), displayPhone: (x) => x,
    read: (key, fallback) => state[key] ?? fallback, write: (key, value) => state[key] = value,
    setCartReservationId(value) { context.CART_RESERVATION_ID = value; }, document: { getElementById: () => null },
    window: { dartCheckoutAddress: { validate: () => ({ ok: true, zone: "cairo-giza" }) }, dispatchEvent() {} },
    sessionStorage: { setItem() {} }, uid: () => "CART-NEXT", async hydrateCustomerCommerce() {}, async saveCustomerAddress() {},
    async apiRequest(url, options) {
      calls.push({ url, options });
      if (options?.method === "PUT" || options?.method === "DELETE") { const gate = deferred(); gates.push(gate); return gate.promise; }
      if (url.includes("/cart/quote")) return { fingerprint: "a".repeat(64), totalMinor: 150000,
        lines: Array.from({ length: context.serverQuantity || 3 }, () => ({ modelId: "M1", color: "Black", size: "M" })) };
      if (url === "/api/v1/orders") return { order: { orderId: "K-ACCEPTED" } };
      throw new Error(`Unexpected request ${url}`);
    } };
  vm.createContext(context); vm.runInContext(read("src/storefront/platform/cart.js") + read("src/storefront/platform/checkout.js"), context);
  return { context, state, calls, gates };
}

async function cartQueue() {
  const { context: c, state, calls, gates } = cartContext();
  const second = [line(2)], third = [line(3)];
  const two = c.reserveCart(second); c.cartData = third; const three = c.reserveCart(third);
  third[0].quantity = 99; // Each request owns an immutable intent snapshot.
  await tick(); assert.equal(calls.length, 1); assert.equal(calls[0].options.body.lines[0].quantity, 2);
  const checkout = c.checkout(form); await tick(); assert.equal(calls.length, 1, "checkout waits for all queued mutations");
  gates[0].resolve({ expiresAt: line(1).reservationUntil }); await two; await tick();
  assert.equal(calls.length, 2); assert.equal(calls[1].options.body.lines[0].quantity, 3);
  gates[1].resolve({ expiresAt: line(1).reservationUntil }); await three;
  assert.equal(state.dart_cart[0].quantity, 3); assert.equal(c.cartData[0].quantity, 3);
  assert.equal((await checkout).orderId, "K-ACCEPTED");
  assert.equal(calls.filter((entry) => entry.url === "/api/v1/orders").length, 1);

  const other = cartContext(), release = other.context.releaseCartReservation(true);
  const reserve = other.context.reserveCart([line(2)]); other.context.cartData = [line(2)];
  await tick(); assert.equal(other.calls.length, 1); other.gates[0].resolve({}); await release; await tick();
  assert.equal(other.context.cartData[0].quantity, 2, "an older release cannot erase a newer edit");
  other.gates[1].resolve({ expiresAt: line(1).reservationUntil }); await reserve;
  assert.equal(other.state.dart_cart[0].quantity, 2);

  const retry = cartContext(), failed = retry.context.reserveCart([line(2)]);
  await tick(); retry.gates[0].reject(new Error("Synthetic unavailable")); await assert.rejects(failed, /Synthetic unavailable/);
  await retry.context.settleCartMutations(); // A failure cannot poison future quotes forever.
  const recovered = retry.context.reserveCart([line(3)]); await tick(); retry.gates[1].resolve({ expiresAt: line(1).reservationUntil }); await recovered;
  assert.equal(retry.context.cartData[0].quantity, 3);
}

async function contentMismatch() {
  const { context: c, calls } = cartContext(); c.cartData = [line(3)]; c.serverQuantity = 2;
  let refreshed = 0; c.hydrateCustomerCart = async () => { refreshed++; c.cartData = [line(2)]; };
  await assert.rejects(c.checkout(form), (error) => error.code === "CART_CONTENT_CHANGED");
  assert.equal(refreshed, 1); assert.equal(calls.filter((entry) => entry.url === "/api/v1/orders").length, 0);
}

async function setAttachmentQueue() {
  const { context: c, calls, gates } = cartContext(), attachment = deferred();
  let attached = false;
  const first = c.reserveCart([line(2)], { afterReservation: async () => { await attachment.promise; attached = true; } });
  const second = c.reserveCart([line(3)]);
  await tick(); gates[0].resolve({ expiresAt: line(1).reservationUntil }); await tick();
  const checkout = c.checkout(form); await tick();
  assert.equal(calls.length, 1, "a later cart mutation or checkout cannot overtake Set attachment");
  attachment.resolve(); await first; await tick(); assert.equal(attached, true);
  gates[1].resolve({ expiresAt: line(1).reservationUntil }); await second; assert.equal((await checkout).orderId, "K-ACCEPTED");

  const rollback = cartContext(); let failed = false;
  const operation = rollback.context.reserveCart([line(2)], { afterReservation: async (_payload, restore) => {
    await restore([line(1)]); failed = true; throw new Error("Set attachment failed");
  } });
  const rejected = assert.rejects(operation, /Set attachment failed/);
  await tick(); rollback.gates[0].resolve({ expiresAt: line(1).reservationUntil }); await tick();
  assert.equal(rollback.calls.length, 2); assert.equal(rollback.calls[1].options.body.lines[0].quantity, 1);
  rollback.gates[1].resolve({ expiresAt: line(1).reservationUntil }); await rejected;
  assert.equal(failed, true); assert.equal(rollback.context.cartData[0].quantity, 1);
}

async function staleRollback() {
  for (const source of ["Js/dart-ui.js", "src/storefront/home-ui.js"]) {
    const text = read(source), start = text.indexOf("async function persistCartReservation("), end = text.indexOf(source.startsWith("Js/") ? "async function resolveAutomaticCampaign(" : "const defaultScenes", start);
    const gates = [], c = { cartData: [line(2)], cacheFastCartSnapshot() {}, showToast() {}, updateCartCount() {}, async resolveAutomaticCampaign() {},
      window: { DartState: { read: () => [line(1)], write() {} }, DartPlatform: { reserveCart() { const gate = deferred(); gates.push(gate); return gate.promise; } } } };
    vm.createContext(c); vm.runInContext(text.slice(start, end), c);
    const older = c.persistCartReservation([line(1)]); c.cartData = [line(3)]; const newer = c.persistCartReservation([line(2)]);
    gates[0].reject(new Error("Older request failed")); await older;
    assert.equal(c.cartData[0].quantity, 3, source); gates[1].resolve({}); await newer;
    assert.equal(c.cartData[0].quantity, 3, source);
  }
}

async function profileRecovery() {
  const hosts = { profileOrdersList: { innerHTML: "" }, profileReturnsList: { innerHTML: "" } }, data = {}, handlers = {};
  let fail = true, redirects = 0;
  const c = { API_BASE: "https://synthetic.test", API_REQUIRED: true, apiUserCache: { id: "customer", customerId: "DR-1", name: "Synthetic", email: "synthetic@example.test" },
    customerCommerceGeneration: 1, customerCommercePromise: null, customerCommerceStatus: "idle", apiSessionUnavailable: false,
    serverReviewEligible: null, serverPurchaseStats: null, KEYS: { orders: "orders", returns: "returns", cards: "cards", birthdayRewards: "birthday", birthdayMessages: "messages", customers: "customers" },
    uid: () => "synthetic-id", now: () => new Date().toISOString(), async trackAnalyticsEvent() {},
    read: (key, fallback) => data[key] ?? fallback, write: (key, value) => data[key] = value, syncCustomer: () => ({}),
    currentUser: () => c.apiUserCache, cairoParts: () => ({ year: 2026, month: 10 }), displayPhone: (x) => x, returnRules: () => null,
    money: String, orderNet: () => 500, escapeHtml: String, profileField: () => "", formatDateTime: String, renderProfileWaiting() {},
    location: { replace() { redirects++; } }, CustomEvent: class {}, window: { dispatchEvent() {}, DartState: { remove() {} } },
    document: { cookie: "dart_csrf=synthetic", addEventListener: (type, fn) => handlers[type] = fn,
      querySelector: (selector) => selector === ".account" ? {} : null, getElementById: (id) => hosts[id] || null },
    async apiRequest(url) {
      if (fail) throw Object.assign(new Error("Synthetic unavailable"), { status: 503 });
      if (url === "/api/v1/me") return { user: { id: "customer", accountType: "customer", code: "DR-1", name: "Synthetic", email: "synthetic@example.test" } };
      return { orders: [{ clientId: "DR-1", orderId: "K-SAVED", status: "Delivered", items: [], priceSnapshot: [] }], returns: [] };
    } };
  vm.createContext(c); vm.runInContext(read("src/storefront/platform/customer-state.js") + read("src/storefront/platform/profile.js"), c);
  c.renderProfile(); assert.match(hosts.profileOrdersList.innerHTML, /Loading/); assert.doesNotMatch(hosts.profileOrdersList.innerHTML, /No orders/);
  await assert.rejects(c.hydrateCustomerCommerce(), /Synthetic unavailable/); assert.match(hosts.profileOrdersList.innerHTML, /Retry/);
  assert.doesNotMatch(hosts.profileOrdersList.innerHTML, /No orders/); assert.equal(redirects, 0);
  fail = false; await c.hydrateCustomerCommerce(); assert.match(hosts.profileOrdersList.innerHTML, /K-SAVED/);
  fail = true; await assert.rejects(c.hydrateCustomerCommerce()); assert.match(hosts.profileOrdersList.innerHTML, /K-SAVED/); assert.match(hosts.profileOrdersList.innerHTML, /Retry/);
  c.apiUserCache = null; await assert.rejects(c.hydrateApiSession()); c.renderProfile(); assert.equal(redirects, 0); assert.match(hosts.profileOrdersList.innerHTML, /session/);
  fail = false; handlers.click({ target: { closest: () => ({}) } }); await tick();
  assert.equal(c.apiSessionUnavailable, false); assert.match(hosts.profileOrdersList.innerHTML, /K-SAVED/); assert.equal(redirects, 0);
}

function editorVersions() {
  const fields = {}, order = { id: "order", version: 7, items: [] }, r = { id: "return", condition: "Damaged", updatedAt: "2026-10-25T12:00:00.000Z" };
  const element = (id) => fields[id] ??= { value: "", dataset: {} };
  const c = { sectionsMap: { orders: { data: [order] }, returns: { data: [r] } }, document: { getElementById: element }, window: {}, openModal() {} };
  vm.createContext(c); vm.runInContext(read("src/dashboard/core/record-editors.js"), c);
  c.openEditModal("order", "orders"); c.openEditModal("return", "returns");
  order.version = 9; r.updatedAt = "2026-10-26T12:00:00.000Z";
  assert.equal(fields.orderForm.dataset.orderVersion, "7"); assert.equal(fields["return-form"].dataset.returnUpdatedAt, "2026-10-25T12:00:00.000Z");
  assert.equal(fields["modal-item-condition"].value, "Bad");
}

(async () => { await cartQueue(); await contentMismatch(); await setAttachmentQueue(); await staleRollback(); await profileRecovery(); editorVersions();
  console.log("PASS fourth Council runtime: queued cart intents, checkout reconciliation, stale rollback, profile retry/cache and captured editor versions");
})().catch((error) => { console.error(error); process.exitCode = 1; });
