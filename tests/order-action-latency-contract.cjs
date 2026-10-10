const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sets = fs.readFileSync("Js/dart-sets.js", "utf8");
const ui = fs.readFileSync("Js/dart-ui.js", "utf8");
const apiSource = fs.readFileSync("Eye/dart-orders-api.js", "utf8");
const dashboard = fs.readFileSync("Eye/dart.js", "utf8");

assert(!sets.includes('root.document.addEventListener("click",()=>root.setTimeout(renderSetAwareTotals,0),true)'),
  "Ordinary page clicks must not recalculate Set cart totals");
assert(sets.includes("if (cartDecorationScheduled) return;"),
  "Repeated cart events must coalesce Set decoration");
assert(ui.includes("if (checkoutSubmitting) return;") && ui.includes("setCheckoutBusy(true)"),
  "Checkout must lock synchronously on the first submission");
assert(ui.includes("if (!orderCreated) setCheckoutBusy(false);"),
  "Checkout must unlock after failure or rejected price review");
assert.equal((ui.match(/completeCheckout\(order\);/g) || []).length, 2,
  "Normal checkout and accepted price-review retry must share the success path");
assert(dashboard.includes('event.detail?.key === "dart_orders"') &&
  dashboard.includes('"orders:hydrate", "orders:authoritative", "orders:sync-confirmed"'),
  "Dashboard must not fully render twice for the same orders hydration");
assert(dashboard.includes('"dart:orders-refresh-failed"'),
  "A failed secondary refresh must have an admin-facing error state");

const checkoutSource = ui.slice(ui.indexOf("function initCartAndCheckoutEvents()"),
  ui.indexOf("function initAddressMap()"));
let submitHandler;
let checkoutCalls = 0;
let rejectCheckout;
const submitButton = { tagName: "BUTTON", textContent: "Order", disabled: false };
const checkoutForm = {
  querySelector: () => submitButton,
  addEventListener(type, callback) { if (type === "submit") submitHandler = callback; },
  setAttribute(name, value) { this[name] = value; },
};
const checkoutContext = {
  document: { getElementById(id) { return id === "checkoutForm" ? checkoutForm : null; } },
  window: { location: { href: "" }, DartState: { read: () => [], write() {} }, DartPlatform: {
    checkout: () => { checkoutCalls += 1; return new Promise((_, reject) => { rejectCheckout = reject; }); },
  } },
  sessionStorage: { setItem() {} },
  cartData: [], renderCart() {}, updateCartCount() {}, showToast() {},
  setTimeout() {},
};
vm.runInNewContext(checkoutSource, checkoutContext);
checkoutContext.initCartAndCheckoutEvents();

let orders = [];
let relatedRefreshStarted = false;
const neverResolves = new Promise(() => {});
const events = [];
const runtimeWindow = {
  DART_API_BASE_URL: "https://dart.test",
  DartState: {
    read: () => orders,
    write(_key, rows) { orders = rows; },
  },
  DartCatalog: { hydrate() { relatedRefreshStarted = true; return neverResolves; } },
  DartDomainState: { hydrateDomain: () => neverResolves, hydrateAudit: () => neverResolves },
  addEventListener() {},
  dispatchEvent(event) { events.push(event); },
  setInterval() {},
};
const payload = { version: 2, orders: [{ orderId: "D-1", status: "Accepted" }] };
vm.runInNewContext(apiSource, {
  window: runtimeWindow,
  location: { origin: "https://dart.test" },
  document: { cookie: "", addEventListener() {}, hidden: false,
    head: { append() {} }, createElement: () => ({}), },
  fetch: async () => ({ ok: true, json: async () => payload }),
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  setTimeout,
  clearTimeout,
  console,
});

(async () => {
  const firstSubmit = submitHandler({ preventDefault() {} });
  assert.equal(submitButton.disabled, true, "First submission must lock the button immediately");
  await submitHandler({ preventDefault() {} });
  assert.equal(checkoutCalls, 1, "A second submission must not create another request");
  rejectCheckout(new Error("Temporary checkout failure"));
  await firstSubmit;
  assert.equal(submitButton.disabled, false, "Failed checkout must restore the button");
  assert.equal(submitButton.textContent, "Order");
  checkoutContext.window.DartPlatform.checkout = async () => {
    checkoutCalls += 1;
    return { orderId: "D-2" };
  };
  await submitHandler({ preventDefault() {} });
  assert.equal(checkoutCalls, 2);
  assert.equal(submitButton.disabled, true, "Committed checkout stays locked until navigation");

  const result = await Promise.race([
    runtimeWindow.DartOrdersApi.workflow("D-1", { expectedStatus: "New", target: "Accepted" }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Workflow waited for unrelated domains")), 150)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.equal(relatedRefreshStarted, true);
  assert.equal(result[0].status, "Accepted");
  assert.equal(orders[0].status, "Accepted");
  assert(events.some((event) => event.type === "dart:orders-hydrated"));
  console.log("PASS order workflow latency, checkout lock and Set click scope");
})().catch((error) => { console.error(error); process.exitCode = 1; });
