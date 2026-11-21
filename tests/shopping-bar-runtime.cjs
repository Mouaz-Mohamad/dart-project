// Persistent server-priced cart, reward progress, safe text and session races.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.hidden = false; this.attributes = {}; this.classes = new Set(); this.style = {};
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  getBoundingClientRect() { return { height: this.classes.has("cart-banner-expanded") ? 150 : 66 }; }
}
const events = {}, timers = new Map(), space = {}; let nextTimer = 1, count = 0, clock = 1000, user = { id: "customer-a" }, currentQuote, checkoutMarker = "";
const priced = (incentives = [], totalMinor = 48490) => ({ currency: "EGP", totalMinor, shippingMinor: 10000, incentives });
let reply = priced();
const document = { body: new Node("body"), documentElement: { style: { setProperty: (key, value) => { space[key] = value; } } },
  hidden: false, activeElement: null, getElementById: id => id === checkoutMarker ? {} : null, createElement: tag => new Node(tag), addEventListener() {} };
const window = { document, setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  location: { pathname: "/products.html" },
  addEventListener(type, fn) { (events[type] ||= []).push(fn); },
  DartState: { read: () => count ? [{ id: "model", quantity: count }] : [] },
  DartSiteSettings: { get: () => ({ shoppingBar: { enabled: true, durationSeconds: 6 } }) },
  DartPlatform: { currentUser: () => user, currentCartQuote: () => currentQuote, quoteCart: async () => reply, apiRequest: async () => reply } };
vm.runInNewContext(fs.readFileSync("src/storefront/shopping-bar.js", "utf8"), { window, Date: { now: () => clock }, Number, String, Math, Object, Array });
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const find = (node, tag) => node.tagName === tag ? node : node.children.map(child => find(child, tag)).find(Boolean);
const byClass = (node, cls) => node.className?.split(" ").includes(cls) ? node : node.children.map(child => byClass(child, cls)).find(Boolean);
(async () => {
  assert.equal(document.body.children.length, 0, "empty carts have no shopping bar");
  count = 2;
  window.DartShoppingBar.added('<img src=x onerror="bad()">'); await tick();
  const bar = document.body.children[0], link = find(bar, "a"), live = byClass(bar, "sr-only"), detail = byClass(bar, "cart-banner-detail");
  const price = byClass(bar, "cart-banner-price"), offer = byClass(bar, "cart-banner-offer");
  assert.equal(link.href, "/cart-checkout.html"); assert(!bar.hidden);
  assert(live.textContent.includes("<img"), "product names are text, never HTML");
  assert(!find(bar, "img"), "product titles cannot inject markup");
  assert.equal(price.textContent, "385 ج.م", "the server item total is displayed rounded to a whole pound");
  assert(bar.className.includes("glass-effect"), "the cart shares the account glass surface");
  assert(!byClass(bar, "cart-banner-price-label"), "the redundant total caption is removed");
  assert.equal(byClass(bar, "cart-banner-count").textContent, "2");
  assert(offer.hidden, "no expanded reward row without an eligible offer");
  clock += 7000; for (const fn of [...timers.values()]) fn(); await tick();
  assert(!bar.hidden, "the cart remains visible after the added confirmation expires");
  assert(byClass(bar, "cart-banner-feedback").hidden);
  reply = priced([{ type: "freeShipping", title: "كمّل اختياراتك واستفيد", message: "فاضلك 1 قطعة", target: 3, current: 2 }]);
  await window.DartShoppingBar.refresh(); assert.equal(detail.textContent, "فاضلك 1 قطعة");
  assert.equal(byClass(bar, "cart-banner-offer-title").textContent, "توصيل مجاني");
  assert(!offer.hidden); assert(bar.classes.has("cart-banner-expanded"));
  const progress = byClass(bar, "cart-banner-progress"), fill = byClass(bar, "cart-banner-progress-fill");
  assert.equal(progress.attributes["aria-valuemax"], "3"); assert.equal(progress.attributes["aria-valuenow"], "2");
  assert.equal(fill.style.transform, `scaleX(${2 / 3})`);
  assert.equal(space["--dart-shopping-bar-space"], "164px", "space includes the expanded bar and the smaller bottom inset");
  currentQuote = priced([{ type: "card", title: "Dart Card", message: "اكتمل الهدف", target: 3, current: 3 }], 58270);
  window.DartShoppingBar.updateQuote(currentQuote);
  assert.equal(price.textContent, "483 ج.م", "accepted quotes keep the whole-pound display");
  assert.equal(currentQuote.totalMinor, 58270, "formatting does not change the quoted money");
  assert.equal(fill.style.transform, "scaleX(1)");
  window.DartShoppingBar.updateQuote(priced([], 1)); assert.equal(price.textContent, "483 ج.م", "unaccepted quotes cannot replace current prices");
  currentQuote = priced([], 48249); window.DartShoppingBar.updateQuote(currentQuote);
  assert.equal(price.textContent, "382 ج.م", "values below half a pound round down for display");
  const close = find(bar, "button"); close.events.click[0](); assert(bar.hidden);
  await window.DartShoppingBar.refresh(); assert(bar.hidden, "refresh does not reopen a dismissed bar");
  window.DartShoppingBar.added("New addition"); await tick(); assert(!bar.hidden);
  count = 0; events["dart:data-changed"][0]({ detail: { key: "dart_cart" } }); assert(bar.hidden, "removing the cart clears stale confirmation/progress immediately");
  assert.equal(space["--dart-shopping-bar-space"], "0px");
  count = 1;
  let finish;
  window.DartPlatform.quoteCart = () => new Promise(resolve => { finish = resolve; });
  const pending = window.DartShoppingBar.refresh();
  user = null; events["dart:customer-session-changed"][0]();
  finish({ incentives: [{ title: "Private previous progress", message: "old", target: 10, current: 9 }] });
  await pending;
  assert(offer.hidden, "a late response cannot expose the previous customer's progress");
  assert.equal(price.textContent, "…", "session changes clear the previous customer's price immediately");
  window.DartPlatform.quoteCart = async () => { throw Error("temporary outage"); };
  await window.DartShoppingBar.refresh(); assert(!bar.hidden, "the cart link stays available during pricing outages");
  assert(offer.hidden, "failed progress lookup creates no false offer"); assert.equal(price.textContent, "—", "unknown totals are never invented");
  window.DartPlatform.quoteCart = async () => priced([], 10000.5);
  await window.DartShoppingBar.refresh(); assert.equal(price.textContent, "—", "malformed money is not presented as a price");
  let requests = 0;
  window.DartPlatform.quoteCart = async () => { requests++; return priced(); };
  window.DartPlatform.apiRequest = async () => { requests++; return priced(); };
  for (const pathname of ["/cart-checkout", "/cart-checkout.html", "/cart-checkout/"]) {
    window.location.pathname = pathname; events.pageshow.forEach(fn => fn());
    window.DartShoppingBar.added("Checkout addition"); await window.DartShoppingBar.refresh();
    window.DartShoppingBar.updateQuote(currentQuote);
    assert(bar.hidden, `the cart and checkout page suppress the bar: ${pathname}`);
    assert.equal(space["--dart-shopping-bar-space"], "0px");
  }
  window.location.pathname = "/internal-cart";
  for (checkoutMarker of ["cartView", "checkoutView"]) {
    events.pageshow.forEach(fn => fn()); await window.DartShoppingBar.refresh();
    assert(bar.hidden, "cart/checkout DOM markers also prevent the bar");
  }
  assert.equal(requests, 0, "suppressed pages do not add quote or incentive requests");
  assert.equal(document.body.children.length, 1, "all additions reuse one bar");
  console.log("PASS shopping bar: glass surface, integer display without changing money, checkout suppression without requests, persistent cart, accepted quotes, safe text, progress, dismissal and session races");
})().catch(error => { console.error(error); process.exitCode = 1; });
