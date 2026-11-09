// DART CODE GUIDE | tests/admin-notifications-runtime.cjs
// In-memory UI/worker tests: counters, escaped text, read actions, arrival and logout races.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const html = fs.readFileSync("Eye/Dart Eye.html", "utf8"), source = fs.readFileSync("Eye/dart-admin-notifications.js", "utf8");
const row = (id, section = "orders") => ({ id, entityId: id, section, title: section === "orders" ? "New order" : "New exchange request", entityCode: "K-TEST", createdAt: "2026-11-09T08:00:00.000Z", readAt: null });
function element() {
  return { hidden: true, textContent: "", innerHTML: "", dataset: {}, checked: false, disabled: false, events: {}, attributes: {}, children: [],
    addEventListener(type, fn) { this.events[type] = fn; }, setAttribute(key, value) { this.attributes[key] = value; },
    querySelector() { return this.children[0] || null; }, append(child) { this.children.push(child); }, contains() { return false; }, focus() {} };
}
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
async function ui() {
  const ids = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], element()]));
  const events = new Map(), docEvents = new Map(), nav = Object.fromEntries(["orders", "returns", "review"].map(key => [key, [element(), element()]]));
  let rows = [row("00000000-0000-4000-8000-000000000001"), row("00000000-0000-4000-8000-000000000002", "returns")], hasAccess = true;
  const calls = [], notices = [], opened = [];
  const document = { hidden: false, getElementById: id => ids.get(id), createElement: element, addEventListener: (name, fn) => docEvents.set(name, fn),
    querySelectorAll: selector => nav[selector.match(/data-target="([^"]+)"/)?.[1]] || [], querySelector: () => ({ click() {} }) };
  const window = { DartAdminAccess: { can: () => hasAccess }, addEventListener: (name, fn) => events.set(name, fn),
    DartDashboardUI: { notify: text => notices.push(text) }, DartOrdersApi: { hydrate: async () => {} }, dartOpenAdminNotification: async n => { opened.push(n.id); return true; },
    DartAdminApi: { request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/read")) { rows.forEach(n => { if (options.body.ids.includes(n.id)) n.readAt = "2026-11-09T09:00:00.000Z"; }); return { updated: options.body.ids.length }; }
      const unread = { orders: 0, returns: 0, review: 0 }; rows.filter(n => !n.readAt).forEach(n => unread[n.section]++);
      return { notifications: JSON.parse(JSON.stringify(rows)), unread, unreadCount: rows.filter(n => !n.readAt).length, nextCursor: null };
    } } };
  const local = new Map(), context = { window, document, navigator: { onLine: true }, location: { href: "https://synthetic.test/Eye/Dart%20Eye.html" },
    history: { replaceState() {} }, URL, Uint8Array, Date, Set, Map, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) } };
  vm.runInNewContext(source, context); await flush();
  assert.equal(nav.orders[0].children[0].textContent, "1"); assert.equal(nav.returns[0].children[0].textContent, "1");
  assert.equal(ids.get("dart-notification-count").textContent, "2"); assert.equal(ids.get("dart-notification-bar").hidden, false);
  assert.ok(window.DartAdminNotifications.renderRows(false, "return").includes("New exchange request"));
  assert.ok(!window.DartAdminNotifications.renderRows(false, "return").includes("New order"));
  assert.equal(notices.length, 0, "initial history must not replay arrival sounds/toasts");
  rows.unshift({ ...row("00000000-0000-4000-8000-000000000003"), entityCode: '<img src=x onerror="attack()">' });
  events.get("dart:server-change")({ detail: { name: "admin_notifications" } }); await flush();
  assert.equal(nav.orders[0].children[0].textContent, "2"); assert.equal(notices.length, 1);
  assert.ok(window.DartAdminNotifications.renderRows().includes("&lt;img")); assert.ok(!window.DartAdminNotifications.renderRows().includes("<img"));
  events.get("dart:server-change")({ detail: { reconcile: true } }); await flush(); assert.equal(notices.length, 1, "reconciliation cannot duplicate arrival alerts");
  docEvents.get("click")({ target: { closest: () => ({ dataset: { adminNotification: rows[0].id } }) } }); await flush();
  assert.equal(opened[0], rows[0].id); assert.equal(nav.orders[0].children[0].textContent, "1");
  assert.ok(calls.some(call => call.path.endsWith("/read") && call.options.method === "POST"));
  ids.get("dart-notification-read").events.click(); await flush(); assert.equal(ids.get("dart-notification-count").hidden, true);
  assert.equal(nav.orders[0].children[0].hidden, true, "zero-count circles disappear");
  hasAccess = false; events.get("dart:data-changed")({ detail: { source: "logout" } }); await flush();
  assert.equal(ids.get("dart-notification-bar").hidden, true); assert.equal(window.DartAdminNotifications.renderRows().includes("K-TEST"), false);
}
async function worker() {
  const events = new Map(), notifications = [], targets = [];
  const self = { location: { origin: "https://synthetic.test" }, addEventListener: (key, fn) => events.set(key, fn), skipWaiting() {},
    registration: { showNotification: async (title, options) => notifications.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow: async url => targets.push(String(url)) } };
  vm.runInNewContext(fs.readFileSync("Eye/admin-push-sw.js", "utf8"), { self, URL });
  let pending;
  events.get("push")({ data: { json: () => ({ notificationId: "00000000-0000-4000-8000-000000000001", eventType: "EXCHANGE_CREATED", url: "https://hostile.test/" }) }, waitUntil: promise => { pending = promise; } }); await pending;
  assert.match(notifications[0].title, /exchange/); assert.equal(notifications[0].options.tag, "dart-admin-00000000-0000-4000-8000-000000000001");
  events.get("notificationclick")({ notification: { close() {}, data: { notificationId: "00000000-0000-4000-8000-000000000001", url: "https://hostile.test/" } }, waitUntil: promise => { pending = promise; } }); await pending;
  assert.equal(new URL(targets[0]).origin, "https://synthetic.test"); assert.match(targets[0], /notification=00000000/);
}
(async () => { await ui(); await worker(); console.log("PASS staff notifications: white-counter state, arrivals/dedupe, escaping, read/deep-open, logout isolation and safe native click routing"); })().catch(error => { console.error(error); process.exitCode = 1; });
