"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const read = (file) => fs.readFileSync(file, "utf8"), ui = read("Js/dart-ui.js");
function money() {
  const context = { window: {} }; vm.runInNewContext(read("Js/dart-state.js"), context);
  const state = context.window.DartState;
  for (const [value, expected] of [[120.75, "120.75"], [0.05, "0.05"], [100, "100"], [-5.25, "-5.25"], [NaN, "0"]]) assert.equal(state.formatMoney(value), expected);
  for (const file of ["Js/dart-rep.js", "Js/dart-tracking.js"]) {
    const line = read(file).split("\n").find((line) => line.includes("const money ="));
    const ctx = { window: { DartState: state } };
    vm.runInNewContext(line + "\nthis.money=money;", ctx);
    assert.equal(ctx.money(120.75), "120.75 EGP", file);
  }
  const rep = read("Js/dart-rep.js"), start = rep.indexOf("  const orderTotal ="), end = rep.indexOf("\n\n", start);
  const ctx = { window: { DartState: state }, order: { finalAmount: 120.75 } };
  vm.runInNewContext(rep.split("\n").find((line) => line.includes("const money =")) + rep.slice(start, end) + "\nthis.collect=money(orderTotal(order));", ctx);
  assert.equal(ctx.collect, "120.75 EGP");
  return state;
}
async function ownStock(state) {
  const catalog = read("src/storefront/catalog.js"), events = {}, fields = {};
  const line = { id: "M1", title: "Synthetic", quantity: 1, color: "Black", size: "M", price: 120.75,
    reservationId: "CART-OWN", reservationUntil: new Date(Date.now() + 600000).toISOString() };
  const element = (selector) => fields[selector] ??= { style: {}, addEventListener(type, fn) { events[`${selector}:${type}`] = fn; } };
  const card = { style: {}, removeAttribute() {}, querySelector: element }, container = { querySelectorAll: () => [], querySelector: () => null, appendChild() {} };
  const model = { modelId: "M1" }, product = { id: "M1", code: "M1" };
  const context = { active: () => true, colors: () => [{ name: "Black" }], sizes: () => [{ name: "M" }],
    norm: (value) => String(value).toLowerCase(), normalizeStockKey: (...args) => JSON.stringify(args), IS_ADMIN: false,
    remoteStock: new Map([[JSON.stringify(["M1", "Black", "M"]), 1]]), items: () => [], cartData: [line], productsData: [product],
    window: { DartState: { ...state, read: () => [line] } }, updateCartTotals() {}, updateCartCount() {},
    document: { getElementById: (id) => id === "cartItemsContainer" ? container : { cloneNode: () => card } },
    calls: 0, async persistCartReservation() { context.calls++; return true; }, showToast(message) { throw new Error(message); } };
  vm.createContext(context); vm.runInContext(catalog.slice(catalog.indexOf("  function available("), catalog.indexOf("  const groupKey =")), context);
  assert.equal(context.available(model, "M", "Black", "CART-OWN"), 2);
  assert.equal(context.available(model, "M", "Black", "CART-OTHER"), 1);
  assert.equal(context.available(model, "M", "Black"), 1);
  line.reservationUntil = "2000-01-01"; assert.equal(context.available(model, "M", "Black", "CART-OWN"), 1);
  line.reservationUntil = new Date(Date.now() + 600000).toISOString();
  context.DartCatalog = { model: () => model, available: context.available };
  context.getAvailableStock = (_product, size, color) => context.available(model, size, color, "CART-OWN");
  vm.runInContext(ui.slice(ui.indexOf("function renderCart()"), ui.indexOf("async function persistCartReservation(")), context);
  context.renderCart(); assert.equal(fields[".cart-item-price"].textContent, "120.75 EGP");
  await events[".increase:click"](); assert.equal(line.quantity, 2); assert.equal(context.calls, 1);
}
async function recovery() {
  let committed = false, posts = 0, quoteCalls = 0;
  const storage = new Map(), state = { dart_cart: [{ id: "M1", color: "Black", size: "M", quantity: 1, reservationUntil: new Date(Date.now() + 600000).toISOString() }] };
  const fields = { customer_name: "Synthetic", phone1: "01000000001", email: "synthetic@example.test", country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Synthetic", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" };
  const form = { elements: { namedItem: (name) => ({ value: fields[name] || "" }) }, dataset: {} };
  const context = { API_BASE: "https://synthetic.test", cartData: state.dart_cart, CART_RESERVATION_ID: "CART-OLD",
    currentUser: () => ({ id: "U1", name: "Synthetic", email: fields.email }), displayPhone: (x) => x,
    read: (key, fallback) => state[key] ?? fallback, write: (key, value) => state[key] = value,
    sessionStorage: { setItem: (key, value) => storage.set(key, value) }, uid: () => "CART-NEW",
    setCartReservationId(value) { context.CART_RESERVATION_ID = value; }, renderCart() {}, updateCartCount() {}, showToast() {},
    async hydrateCustomerCommerce() {}, async saveCustomerAddress() {},
    window: { dartCheckoutAddress: { validate: () => ({ ok: true, zone: "cairo-giza" }) } },
    async apiRequest(url) {
      if (url === "/api/v1/me/cart") return { cart: null };
      if (url.includes("/cart/quote")) { quoteCalls++; return committed ? { completedOrder: { orderId: "K-COMMITTED" } } : { lines: [{ modelId: "M1", color: "Black", size: "M" }], fingerprint: "a".repeat(64), totalMinor: 12075 }; }
      posts++; committed = true; throw new TypeError("Synthetic lost reply");
    } };
  vm.createContext(context); vm.runInContext(read("src/storefront/platform/cart.js") + read("src/storefront/platform/checkout.js"), context);
  await assert.rejects(context.checkout(form), /Synthetic lost reply/); assert.equal(posts, 1);
  // Simulate a new document: no cart business data survived, only the reservation identifier.
  state.dart_cart = []; context.cartData = [];
  await context.hydrateCustomerCart();
  assert.equal(storage.get("dart_last_order_id"), "K-COMMITTED"); assert.equal(context.CART_RESERVATION_ID, "CART-NEW");
  assert.equal(posts, 1); assert.equal(quoteCalls, 2);
  // The empty-cart submit recovery also runs before address validation.
  context.CART_RESERVATION_ID = "CART-OLD";
  assert.equal((await context.checkout({})).orderId, "K-COMMITTED"); assert.equal(posts, 1);
  context.apiRequest = async () => { throw Object.assign(new Error("expired"), { status: 409 }); };
  await assert.rejects(context.checkout({}), /السلة فارغة/);
  context.apiRequest = async () => { throw new TypeError("Synthetic offline recovery"); };
  await assert.rejects(context.hydrateCustomerCart(), /Synthetic offline recovery/);
}
async function promotion() {
  let handler; const requests = [], input = { value: "OLDCODE", disabled: false, closest: () => null }, button = { addEventListener(_type, fn) { handler = fn; } };
  const lines = [{ id: "M1", quantity: 1 }];
  const context = { cartData: lines, appliedDiscountRate: 0, renderCart() {}, showToast() {},
    window: { dartAppliedPromotion: { type: "Promotion", code: "OLDCODE", discountPercent: 10, automatic: false },
      DartState: { read: () => lines }, DartCatalog: { model: () => ({ discount: 0 }) },
      DartPlatform: { currentUser: () => ({ id: "U1" }), cleanupCartReservations() {}, cartReservationId: "CART-OWN",
        activeBirthdayReward: () => null, activeDartCard: () => null,
        apiRequest: async (url) => { requests.push(url); return { campaign: { code: "NEWCODE", discountPercent: 20, automatic: false } }; } } },
    document: { getElementById: (id) => id === "discountInput" ? input : id === "applyDiscountBtn" ? button : null, querySelector: () => null } };
  context.updateCartTotals = () => context.syncBirthdayCheckoutDiscount();
  vm.createContext(context);
  vm.runInContext(ui.slice(ui.indexOf("function syncBirthdayCheckoutDiscount("), ui.indexOf("function applyCartQuote(")), context);
  vm.runInContext(ui.slice(ui.indexOf("function initCartAndCheckoutEvents()"), ui.indexOf("    if (toCheckoutBtn && checkoutView)")) + "\n}", context);
  context.initCartAndCheckoutEvents(); context.syncBirthdayCheckoutDiscount();
  assert.equal(input.disabled, false); assert.equal(button.textContent, "Apply");
  input.value = "NEWCODE"; await handler();
  assert.ok(requests[0].includes("code=NEWCODE")); assert.equal(context.window.dartAppliedPromotion.code, "NEWCODE");
  input.value = ""; await handler(); assert.equal(context.window.dartAppliedPromotion, null);
  assert.equal(requests.length, 1, "removing a code must not resolve the old code again");
}
(async () => { await ownStock(money()); await recovery(); await promotion(); console.log("PASS third Council runtime: fractional cash, own reservations, reload recovery and manual code replacement/removal"); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
