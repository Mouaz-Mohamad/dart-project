"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  const listeners = new Map();
  const auth = { document: { addEventListener(type, fn) { listeners.set(type, fn); } }, window: {}, checkoutSubmissionBusy: false };
  vm.runInNewContext(fs.readFileSync("src/storefront/platform/auth-forms.js", "utf8") + "\nbindAuth();", auth);
  let intercepted = 0;
  await listeners.get("submit")({ target: { id: "checkoutForm", dataset: { dartCheckoutHandler: "ui" }, checkValidity: () => true },
    preventDefault() { intercepted++; }, stopImmediatePropagation() { intercepted++; } });
  assert.equal(intercepted, 0, "document capture must allow the address gate and canonical checkout handler to run");

  const fields = { customer_name: "Synthetic", phone1: "+201000000001", email: "synthetic@example.test", country: "Egypt", governorate: "Cairo", area: "Nasr City", street: "Test", building: "1", floor: "1", latitude: "30.05", longitude: "31.35" };
  const form = { elements: { namedItem: (name) => ({ value: fields[name] || "" }) }, dataset: {} };
  const checkout = { window: { dartCheckoutAddress: { validate: () => ({ ok: true, zone: "cairo-giza" }) }, DartCatalog: { checkForServerChanges: async () => { throw new Error("refresh offline"); } } },
    API_BASE: "https://synthetic.test", cartData: [{ id: "M1" }], CART_RESERVATION_ID: "CART-OLD", cleanupCartReservations() {},
    currentUser: () => ({ name: "Synthetic", email: fields.email }), displayPhone: (x) => x, apiRequest: async (url) => url.includes("/cart/quote") ? ({ fingerprint: "a".repeat(64), totalMinor: 18000, subtotalMinor: 20000, discountMinor: 2000 }) : ({ order: { orderId: "K-CONFIRMED" } }),
    write() {}, uid: () => "CART-NEW", setCartReservationId() {}, sessionStorage: { setItem() {} },
    saveCustomerAddress: async () => { throw new Error("preference offline"); }, hydrateCustomerCommerce: async () => { throw new Error("profile offline"); } };
  vm.runInNewContext(fs.readFileSync("src/storefront/platform/checkout.js", "utf8") + "\nthis.runCheckout=checkout;", checkout);
  assert.equal((await checkout.runCheckout(form)).orderId, "K-CONFIRMED", "a failed refresh cannot hide a committed order");
  assert.equal(checkout.cartData.length, 0);
  checkout.cartData = [{ id: "M1" }]; checkout.apiRequest = async () => { throw new Error("write failed"); };
  await assert.rejects(checkout.runCheckout(form), /write failed/);
  assert.equal(checkout.cartData.length, 1, "a failed POST retains the cart");

  // The actual platform requests per-line pricing before it submits, and binds acceptance to that quote.
  checkout.window.dartDisplayedTotalMinor = 16000;
  let posted = 0, fingerprint = "b".repeat(64);
  checkout.apiRequest = async (url, options) => {
    if (url.includes("/cart/quote")) return { fingerprint, totalMinor: 18000, subtotalMinor: 20000, discountMinor: 2000 };
    posted++; assert.equal(options.body.quoteFingerprint, fingerprint); assert.equal(options.body.expectedTotalMinor, 18000);
    return { order: { orderId: "K-QUOTED" } };
  };
  await assert.rejects(checkout.runCheckout(form), (error) => error.code === "PRICE_CHANGED");
  assert.equal(posted, 0, "a mixed scoped cart must review 180 instead of submitting the estimated 160");
  fingerprint = "c".repeat(64);
  await assert.rejects(checkout.runCheckout(form, { acceptPriceChanges: true }), (error) => error.code === "PRICE_CHANGED");
  assert.equal(posted, 0, "old acceptance cannot authorize changed discount sources");
  checkout.window.dartDisplayedTotalMinor = 18000;
  await checkout.runCheckout(form, { acceptPriceChanges: true }); assert.equal(posted, 1);
  checkout.cartData = [{ id: "M1" }];
  checkout.apiRequest = async (url) => {
    assert.ok(url.includes("/cart/quote"), "a committed reply is recovered before attempting another POST");
    return { completedOrder: { orderId: "K-ALREADY-COMMITTED" } };
  };
  assert.equal((await checkout.runCheckout(form)).orderId, "K-ALREADY-COMMITTED");

  // A commerce poll refreshes statistics but retains the current customer's edit inputs and Cancel button.
  const draftInput = { value: "Unsaved draft" }, editButton = { dataset: { mode: "edit", customerId: "customer-1" }, textContent: "Save", addEventListener() {} };
  let removed = false, replaced = false;
  const field = { querySelector: () => draftInput, set textContent(_value) { replaced = true; } };
  const profileUser = { id: "customer-1", customerId: "DR-1", name: "Stored Name", email: "stored@example.test", phone1: "01000000001" };
  const profileContext = { currentUser: () => profileUser, syncCustomer: () => ({}), read: () => [], KEYS: { orders: "orders", returns: "returns" },
    serverPurchaseStats: { totalPieces: 2, monthlyPieces: 1 }, cairoParts: () => ({ year: 2026, month: 10 }), displayPhone: (x) => x,
    renderProfileWaiting() {}, document: { getElementById: () => null,
      querySelector: (selector) => selector === ".account" ? {} : selector === ".profile-details .edit" ? editButton :
        selector === ".profile-details .cancel-edit" ? { remove() { removed = true; } } : selector === "#user-name" ? field : null } };
  vm.runInNewContext(fs.readFileSync("src/storefront/platform/profile.js", "utf8") + "\nthis.render=renderProfile;", profileContext);
  profileContext.render();
  assert.equal(replaced, false); assert.equal(removed, false); assert.equal(editButton.dataset.mode, "edit"); assert.equal(draftInput.value, "Unsaved draft");
  editButton.dataset.mode = ""; profileContext.render(); assert.equal(replaced, true); assert.equal(removed, true);

  const ui = fs.readFileSync("Js/dart-ui.js", "utf8");
  const block = ui.slice(ui.indexOf("// BEGIN Checkout submission:"), ui.indexOf("// END Checkout submission."));
  for (const accept of [false, true]) {
    let handler, calls = 0; const options = []; const toasts = [];
    const button = { tagName: "BUTTON", textContent: "Order", disabled: false };
    const context = { window: { DartPlatform: { checkout: async (_form, option) => {
      calls++; options.push(option);
      if (calls === 1) throw Object.assign(new Error("price changed"), { code: "PRICE_CHANGED", details: { changes: [{ modelId: "M1", color: "Black", size: "M", previousUnitPrice: 500, currentUnitPrice: 501.25 }] } });
      return { orderId: "K-REVIEWED" };
    } }, DartDialog: { confirm: async (message) => { assert.match(message, /501\.25/); return accept; } }, DartState: { write() {} } },
      checkoutForm: { dataset: {}, querySelector: () => button, setAttribute() {}, addEventListener(_type, fn) { handler = fn; } },
      cartData: [{ id: "M1", color: "Black", size: "M", price: 500 }], sessionStorage: { setItem() {} }, appliedDiscountRate: 0,
      updateCartCount() {}, renderCart() {}, showToast: (text) => toasts.push(text), setTimeout() {} };
    vm.runInNewContext(block, context);
    await handler({ preventDefault() {} });
    assert.equal(calls, accept ? 2 : 1);
    if (accept) { assert.equal(options[1].acceptPriceChanges, true); assert.ok(toasts.some((x) => x.includes("K-REVIEWED"))); }
    else { assert.equal(button.disabled, false); assert.equal(context.cartData.length, 1); }
  }

  const domains = [];
  const returns = { window: { DartAdminApi: { request: async () => ({ return: { id: "R-1" } }) },
    DartAdminAccess: { can: () => false }, DartDomainState: { hydrateDomain: async (domain) => { domains.push(domain); throw new Error("read offline"); } } } };
  vm.runInNewContext(fs.readFileSync("src/dashboard/core/return-workflow.js", "utf8") + "\nthis.approve=dartApproveReturn;", returns);
  assert.equal((await returns.approve({ returnId: "R-1" })).ok, true, "a committed return stays successful when its refresh fails");
  assert.deepEqual(domains, ["returns"], "a returns reviewer must not read the protected damage domain");

  const cache = [{ id: "W-OLD", modelName: "Old design", color: "Red", size: "M" }, { id: "W-NEW", modelName: "New design", color: "Black", size: "L" }];
  const rows = [];
  const cards = [...cache].reverse().map((entry) => ({ dataset: { waitingRecordId: entry.id }, matches: () => true, querySelector: () => null,
    querySelectorAll: () => [], cloneNode: () => ({ actionId: entry.id }), replaceWith: (row) => rows.push(row) }));
  const events = new Map();
  const waitingWindow = { DartPlatform: { waitingEntries: () => cache }, addEventListener() {}, MutationObserver: class { observe() {} },
    document: { readyState: "loading", getElementById: (id) => id === "profileWaitingList" ? { children: cards } : null,
      addEventListener: (type, fn) => events.set(type, fn),
      createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, querySelector: () => null }) } };
  vm.runInNewContext(fs.readFileSync("Js/dart-profile-records.js", "utf8"), { window: waitingWindow, queueMicrotask: (fn) => fn() });
  events.get("DOMContentLoaded")();
  assert.equal(rows[0].dataset.dartProfileRecordOpen, "waiting:W-NEW");
  assert.match(rows[0].innerHTML, /New design/);
  assert.equal(rows[1].dataset.dartProfileRecordOpen, "waiting:W-OLD");
  assert.match(rows[1].innerHTML, /Old design/);
  console.log("PASS council browser regressions: checkout ownership, price review, committed writes, scoped permissions and waiting identities");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
