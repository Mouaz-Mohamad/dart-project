// Shopping confirmation, safe text, dismissal and session-race behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.hidden = false; this.attributes = {}; this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}
const events = {}, timers = new Map(); let nextTimer = 1, count = 1, user = { id: "customer-a" }, reply = { incentives: [] };
const document = { body: new Node("body"), hidden: false, activeElement: null, getElementById: () => null, createElement: tag => new Node(tag), addEventListener() {} };
const window = { document, setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  addEventListener(type, fn) { (events[type] ||= []).push(fn); },
  DartState: { read: () => count ? [{ id: "model", quantity: count }] : [] },
  DartSiteSettings: { get: () => ({ shoppingBar: { enabled: true, durationSeconds: 6 } }) },
  DartPlatform: { currentUser: () => user, quoteCart: async () => reply, apiRequest: async () => reply } };
vm.runInNewContext(fs.readFileSync("src/storefront/shopping-bar.js", "utf8"), { window, Date, Number, String, Math, Object, Array });
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const find = (node, tag) => node.tagName === tag ? node : node.children.map(child => find(child, tag)).find(Boolean);
(async () => {
  assert.equal(document.body.children.length, 0, "no success notification before an addition");
  window.DartShoppingBar.added('<img src=x onerror="bad()">'); await tick();
  const bar = document.body.children[0], link = find(bar, "a"), heading = find(bar, "strong"), detail = link.children[0].children[0].children[1];
  assert.equal(link.href, "/cart-checkout.html"); assert(!bar.hidden);
  assert(heading.textContent.includes("<img"), "product names are text, never HTML");
  assert(!find(bar, "img"), "product titles cannot inject markup");
  reply = { incentives: [{ title: "قربت", message: "فاضلك 1 قطعة", target: 3, current: 2 }] };
  await window.DartShoppingBar.refresh(); assert.equal(detail.textContent, "فاضلك 1 قطعة");
  const progress = find(bar, "progress"); assert.equal(progress.max, 3); assert.equal(progress.value, 2);
  const close = find(bar, "button"); close.events.click[0](); assert(bar.hidden);
  await window.DartShoppingBar.refresh(); assert(bar.hidden, "refresh does not reopen a dismissed bar");
  window.DartShoppingBar.added("New addition"); await tick(); assert(!bar.hidden);
  count = 0; events["dart:data-changed"][0]({ detail: { key: "dart_cart" } }); assert(bar.hidden, "removing the cart clears stale confirmation/progress immediately");
  count = 1;
  let finish;
  window.DartPlatform.quoteCart = () => new Promise(resolve => { finish = resolve; });
  const pending = window.DartShoppingBar.refresh();
  user = null; events["dart:customer-session-changed"][0]();
  finish({ incentives: [{ title: "Private previous progress", message: "old", target: 10, current: 9 }] });
  await pending;
  assert.notEqual(detail.textContent, "old", "a late response cannot expose the previous customer's progress");
  window.DartPlatform.quoteCart = async () => { throw Error("temporary outage"); };
  await window.DartShoppingBar.refresh(); assert(bar.hidden, "failed progress lookup creates no false offer");
  assert.equal(document.body.children.length, 1, "all additions reuse one bar");
  console.log("PASS shopping bar: cart link, safe product names, progress, dismissal, empty cart, session races and service failures");
})().catch(error => { console.error(error); process.exitCode = 1; });
