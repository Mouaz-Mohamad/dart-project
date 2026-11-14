// Actual browser-source functions, navigation-sized empty memory, and synthetic API replies.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const read = file => fs.readFileSync(file, "utf8");
function node(tag = "div") {
  return { tag, children: [], listeners: {}, disabled: false, setAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    append(...children) { this.children.push(...children); },
    remove() { this.removed = true; },
    querySelectorAll(selector) { return this.children.filter(child => child.tag === selector); } };
}
function cartContext() {
  const state = {}, storage = new Map();
  const document = { body: { prepend(value) { document.notice = value; } },
    getElementById() { return null; }, createElement: node };
  const c = { API_BASE: "https://dart.test", CART_RESERVATION_ID: "NEW-DOCUMENT-ID", cartData: [],
    URLSearchParams, document, console,
    currentUser: () => ({ id: "customer-a" }),
    read: (key, fallback) => state[key] ?? fallback, write: (key, value) => { state[key] = value; },
    setCartReservationId(value) { c.CART_RESERVATION_ID = value; },
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
    location: { assign(value) { c.redirect = value; } },
    getProducts: () => [], DartCatalog: { model: () => null, price: () => 600, cover: () => "" },
    renderCart() {}, updateCartCount() {}, recoverCompletedCheckout: async () => null,
    invalidateCartQuote() {}, hydrateApiSession: async () => null,
    window: { DartCatalog: {} } };
  vm.createContext(c); vm.runInContext(read("src/storefront/platform/cart.js"), c);
  c.state = state; return c;
}
async function recovery() {
  const c = cartContext(), calls = [];
  const cart = { reservationId: "LEGACY-CART-ID", expiresAt: new Date(Date.now() + 60000).toISOString(),
    lines: [{ modelId: "M1", size: "M", color: "Black", quantity: 1 }] };
  c.apiRequest = async (path, options) => {
    calls.push([path, options]);
    if (path === "/api/v1/cart/reservation") return { cart };
    if (path === "/api/v1/me/cart/claim") return { reservationId: cart.reservationId };
    if (path === "/api/v1/me/cart") return { cart };
    throw new Error(`Unexpected ${path}`);
  };
  await c.hydrateCustomerCart();
  assert.equal(calls[1][1].body.reservationId, cart.reservationId, "claim must use cookie-proven server discovery, never the new document ID");
  assert.equal(c.cartData.length, 1, "empty document memory must recover the server cart after authentication");
  assert.equal(c.CART_RESERVATION_ID, cart.reservationId);
  c.apiRequest = async () => { throw new Error("Synthetic offline"); };
  await assert.rejects(c.hydrateCustomerCart(), /Synthetic offline/);
  assert.equal(c.cartData.length, 1, "network failure must not clear the cart");

  const guest = cartContext(); guest.currentUser = () => null;
  await assert.rejects(guest.reserveCart([{ id: "M1", size: "M", color: "Black", quantity: 1 }]), /سجل الدخول/);
  assert.equal(await guest.requireCartAccount("/products/test--m1"), false);
  assert.match(guest.redirect, /next=product&productPath=/);
  assert.equal(guest.cartData.length, 0);
}
async function conflict() {
  const c = cartContext(); let replaced = false, offline = true, mutations = 0;
  c.apiRequest = async (path, options) => {
    if (path === "/api/v1/cart/reservation") return { cart: { reservationId: "LEGACY-CART" } };
    if (path === "/api/v1/me/cart/claim") {
      if (!options.body.replaceReservationId) throw Object.assign(new Error("two carts"), { code: "CART_CONFLICT", details: { reservationId: "ACCOUNT-CART" } });
      assert.equal(options.body.replaceReservationId, "ACCOUNT-CART"); replaced = true; mutations++; return { reservationId: "LEGACY-CART" };
    }
    if (path === "/api/v1/me/cart") { if (offline) throw Error("Synthetic refresh outage"); return { cart: null }; }
    throw new Error(path);
  };
  await c.claimGuestCartAfterAuth();
  assert.equal(replaced, false, "conflict must never automatically delete/replace a cart");
  const notice = c.document.notice;
  assert.equal(notice.querySelectorAll("button").length, 2);
  await notice.querySelectorAll("button")[0].listeners.click();
  assert.equal(replaced, true); assert.equal(notice.removed, undefined, "refresh failure must leave a visible error and retry");
  offline = false;
  await notice.querySelectorAll("button")[0].listeners.click();
  assert.equal(notice.removed, true); assert.equal(mutations, 1, "refresh retry must not repeat a destructive cart choice");
}
async function staleHydration() {
  const c = cartContext(); let resolveCart;
  const expiry = new Date(Date.now() + 60000).toISOString();
  c.apiRequest = async path => {
    if (path === "/api/v1/cart/reservation") return { cart: null };
    if (path === "/api/v1/me/cart") return new Promise(resolve => { resolveCart = resolve; });
    if (path === "/api/v1/me/cart/reservation") return { reservationId: "CURRENT", expiresAt: expiry };
    throw Error(path);
  };
  const hydration = c.hydrateCustomerCart();
  await new Promise(resolve => setImmediate(resolve));
  await c.reserveCart([{ id: "NEW", size: "M", color: "Black", quantity: 1 }]);
  resolveCart({ cart: { reservationId: "OLD", expiresAt: expiry, lines: [{ modelId: "OLD", size: "L", color: "Navy", quantity: 1 }] } });
  await hydration;
  assert.equal(c.cartData[0].id, "NEW", "an older GET must not overwrite an acknowledged newer mutation");

  const gate = cartContext(); let finish;
  gate.apiRequest = async path => path === "/api/v1/cart/reservation" ? { cart: null }
    : new Promise(resolve => { finish = resolve; });
  let ready = false; const pending = gate.requireCartAccount().then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(ready, false);
  finish({ cart: { reservationId: "ACCOUNT", expiresAt: expiry, lines: [{ modelId: "EXISTING", size: "L", color: "Black", quantity: 1 }] } });
  await pending; assert.equal(gate.cartData[0].id, "EXISTING", "Add must wait for the account's existing basket");
}
async function checkoutRetry() {
  const c = cartContext(); let offline = true, posted = 0;
  c.cartData = [{ id: "M1", size: "M", color: "Black", quantity: 1, reservationUntil: new Date(Date.now() + 60000).toISOString() }];
  c.state.dart_cart = c.cartData; c.displayPhone = value => value; c.uid = () => "NEXT-CART";
  c.saveCustomerAddress = async () => {}; c.hydrateCustomerCommerce = async () => {};
  const availability = { ready: true, canonical: value => value, isGovernorateOpen: () => availability.ready,
    isAddressCovered: () => availability.ready,
    async load() { availability.ready = false; if (offline) throw Error("Synthetic coverage outage"); availability.ready = true; } };
  c.window.DartShippingAvailability = availability;
  c.window.dartCheckoutAddress = { validate: () => ({ ok: availability.ready, zone: "coverage-enabled" }) };
  const fields = { customer_name: "Synthetic", phone1: "01000000001", email: "synthetic@example.test", country: "Egypt", governorate: "Alexandria", area: "Montaza", street: "Synthetic", building: "1", floor: "1", latitude: "31.2", longitude: "29.9" };
  const form = { elements: { namedItem: name => ({ value: fields[name] || "" }) }, dataset: {} };
  c.apiRequest = async path => {
    if (path.includes("/cart/quote")) return { lines: [{ modelId: "M1", size: "M", color: "Black" }], fingerprint: "f".repeat(64), totalMinor: 60000 };
    if (path === "/api/v1/orders") { posted++; return { order: { orderId: "TEST-ORDER" } }; }
    throw Error(path);
  };
  vm.runInContext(read("src/storefront/platform/checkout.js"), c);
  await assert.rejects(c.checkout(form), /Synthetic coverage outage/);
  assert.equal(posted, 0); assert.equal(c.cartData.length, 1);
  offline = false;
  assert.equal((await c.checkout(form)).orderId, "TEST-ORDER");
  assert.equal(posted, 1, "a temporary coverage outage must recover without a page reload, including external provinces");
}
function sessionCleanup() {
  const state = { dart_cart: [{ id: "legacy-piece" }] }, storage = new Map([["dart_cart_reservation_id", "legacy-id"]]);
  const c = { KEYS: {}, API_USER_CACHE_KEY: "api-user", CART_UI_CACHE_KEY: "cart-ui", cartData: state.dart_cart,
    sessionStorage: { removeItem: key => storage.delete(key) },
    window: { DartState: { remove: key => delete state[key] }, DartSets: { clearDrafts() {} } } };
  const source = read("src/storefront/platform/authentication.js");
  vm.createContext(c); vm.runInContext(source.slice(source.indexOf("  function clearCustomerPrivateCache("), source.indexOf("\n  async function logout()")), c);
  c.clearCustomerPrivateCache({ preserveCartIdentifier: true, preserveGuestCart: true });
  assert.equal(storage.get("dart_cart_reservation_id"), "legacy-id"); assert.equal(c.cartData.length, 1);
  c.clearCustomerPrivateCache();
  assert.equal(storage.has("dart_cart_reservation_id"), false); assert.equal(c.cartData.length, 0);
  const verifyStart = source.indexOf("  async function acceptVerifiedSession(");
  const verifyEnd = source.indexOf("\n  async function ", verifyStart + 1);
  assert(verifyStart >= 0, "Customer OTP verification method must exist");
  assert.match(source.slice(verifyStart, verifyEnd), /await claimGuestCartAfterAuth\(\)/,
    "A verified customer session must claim the guest cart before redirect");
}
async function availability(pickup = false) {
  let offline = false;
  const regions = Array.from({ length: 27 }, (_, index) => ({ id: ["Cairo", "Giza", "Alexandria"][index] || `Region${index}`,
    en: ["Cairo", "Giza", "Alexandria"][index] || `Region${index}`, ar: `منطقة${index}`, cities: [],
    available: index === 1 || index === 2, blocked: index === 0, carriers: index === 1 ? ["dart"] : index === 2 ? ["carrier"] : [] }));
  let endpoint = "";
  const c = { document: { readyState: "loading", addEventListener() {}, getElementById(id) { return pickup && id === "returnRequestForm" ? {} : null; } },
    window: { dispatchEvent() {} }, location: { origin: "https://dart.test" }, Event: class {},
    fetch: async url => { endpoint = url; if (offline) throw new Error("Synthetic outage"); return { ok: true, json: async () => ({ governorates: regions,
      companies: [{ id: "carrier", name: "Test Carrier", coverage: { Alexandria: { all: true } } }] }) }; } };
  vm.createContext(c); vm.runInContext(read("Js/dart-checkout-regions.js"), c);
  const service = c.window.DartShippingAvailability;
  assert.equal(service.isGovernorateOpen("Giza"), false, "coverage must be fetched before granting local delivery");
  await service.load();
  if (pickup) {
    assert.match(endpoint, /\/shipping\/coverage-catalog$/);
    assert.equal(service.isGovernorateOpen("Alexandria"), true);
    assert.equal(service.isGovernorateOpen("Region26"), true, "returns remain possible after checkout coverage is removed");
    assert.equal(service.isGovernorateOpen("Unknown"), false);
    offline = true; await assert.rejects(service.load({ force: true }), /Synthetic outage/);
    assert.equal(service.isGovernorateOpen("Alexandria"), false, "pickup must wait for a verified region catalog");
    return;
  }
  assert.equal(service.isGovernorateOpen("Cairo"), false);
  assert.equal(service.availableCompanies({ governorate: "Cairo" }).length, 0);
  assert.equal(service.isAddressCovered({ governorate: "Alexandria" }), true);
  assert.equal(service.isAddressCovered({ governorate: "Giza" }), true);
  offline = true; await assert.rejects(service.load({ force: true }), /Synthetic outage/);
  assert.equal(service.isAddressCovered({ governorate: "Giza" }), false, "outage must not silently restore Cairo/Giza");
}
(async () => { await recovery(); await conflict(); await staleHydration(); await checkoutRetry(); sessionCleanup(); await availability(); await availability(true); console.log("PASS guest navigation recovery, explicit cart conflicts, stale GET/mutation races, authenticated cart readiness, email verification, external checkout and nationwide pickup coverage retries"); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
