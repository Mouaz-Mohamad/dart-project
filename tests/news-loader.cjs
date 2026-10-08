// DART CODE GUIDE | tests/news-loader.cjs
// Verify deferred downloads, permission gates and recoverable News asset failures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("Js/dart-news.js", "utf8");
function element() {
  const node = new EventTarget();
  node.hidden = true;
  node.classes = new Set();
  node.classList = { contains: name => node.classes.has(name) };
  return node;
}
function fixture(admin = false) {
  const root = new EventTarget(), section = element(), body = element(), message = element(), retry = element(), item = element();
  const scripts = [], observers = [];
  const link = { closest: () => item };
  root.document = {
    body,
    getElementById: id => id === (admin ? "news" : "dart-news") ? section : id === "news-message" ? message : id === "news-retry" ? retry : null,
    querySelectorAll: () => [link],
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild: script => scripts.push(script) },
  };
  section.querySelector = selector => selector === "[data-news-status]" ? message : retry;
  root.MutationObserver = root.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  let permissions = [];
  root.DartAdminAccess = { can: permission => permissions.includes(permission) };
  root.DartAdminHydration = { ready: true };
  vm.runInNewContext(source, { window: root });
  return { root, section, body, scripts, observers, retry, message, item, permissions: values => { permissions = values; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const publicPage = fixture();
  assert.equal(publicPage.scripts.length, 0, "off-screen News must download no runtime");
  publicPage.observers[0].callback([{ isIntersecting: false }]);
  assert.equal(publicPage.scripts.length, 0);
  publicPage.observers[0].callback([{ isIntersecting: true }]);
  assert.match(publicPage.scripts[0].src, /^\/Js\/dart-news-links\.js\?v=/);
  publicPage.scripts[0].onerror(); await settle();
  assert.equal(publicPage.retry.hidden, false);
  assert.match(publicPage.message.textContent, /Please try again/);
  publicPage.retry.dispatchEvent(new Event("click"));
  assert.equal(publicPage.scripts.length, 2, "failed downloads must be retryable");
  publicPage.root.DartNewsLinks = {};
  publicPage.scripts[1].onload(); await settle();
  assert.match(publicPage.scripts[2].src, /dart-news-runtime/);
  publicPage.scripts[2].onerror(); await settle();
  publicPage.retry.dispatchEvent(new Event("click")); await settle();
  assert.match(publicPage.scripts[3].src, /dart-news-runtime/, "retry must reuse its loaded URL helper");
  publicPage.scripts[3].onload(); await settle();
  assert.equal(publicPage.scripts.length, 4, "storefront must never download News management");

  const staff = fixture(true);
  assert.equal(staff.item.hidden, true);
  assert.equal(staff.scripts.length, 0, "ungranted Staff must download no News modules");
  staff.permissions(["news.read"]);
  staff.root.dispatchEvent(new Event("dart:admin-authenticated"));
  assert.equal(staff.item.hidden, false);
  assert.equal(staff.scripts.length, 0, "authorization alone must not download News");
  staff.section.classes.add("active-section"); staff.observers[0].callback();
  staff.observers[0].callback();
  assert.equal(staff.scripts.length, 1, "repeated activation must share one download");
  staff.root.DartNewsLinks = {};
  staff.scripts[0].onload(); await settle();
  assert.match(staff.scripts[1].src, /dart-news-runtime/);
  staff.root.DartNews = {};
  staff.scripts[1].onload(); await settle();
  assert.match(staff.scripts[2].src, /^\/Eye\/dart-news-admin\.js\?v=/);
  staff.scripts[2].onerror(); await settle();
  staff.retry.dispatchEvent(new Event("click")); await settle();
  assert.equal(staff.scripts.length, 4);
  assert.match(staff.scripts[3].src, /dart-news-admin/, "management retry must reuse its loaded reader");
  staff.scripts[3].onload(); await settle();
  staff.permissions([]); staff.root.dispatchEvent(new Event("dart:admin-logged-out"));
  assert.equal(staff.item.hidden, true); assert.equal(staff.section.hidden, true);
  console.log("PASS News lazy loading: viewport, Staff grants, activation, deduplication and asset retries");
})().catch(error => { console.error(error); process.exitCode = 1; });
