"use strict";
// Execute the maintained UI and worker: async ownership, opt-in, failures and navigation.
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const source = fs.readFileSync("Js/dart-customer-notifications.js", "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let i = 0; i < 8; i++) await tick(); }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Element {
  constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.textContent = ""; this.hidden = false; this.disabled = false; }
  replaceChildren(...nodes) { this.children = nodes; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
function fixture({ supported = false, list = async () => ({ notifications: [], unreadCount: 0, nextCursor: null }) } = {}) {
  const elements = Object.fromEntries(["list", "status", "unread", "more", "refresh", "mark"].map(key => [`data-notification-${key}`, new Element()]));
  elements["data-push-toggle"] = new Element(); elements["data-push-status"] = new Element();
  const host = { querySelector: selector => elements[selector.slice(1, -1)] };
  const events = {}, calls = [], permissions = [], registrations = [], sends = [];
  let user = { id: "customer-a" }, permission = "default", failRead = false, subscription = null;
  const push = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic", toJSON() { return { endpoint: this.endpoint, keys: {} }; }, async unsubscribe() { subscription = null; return true; } };
  const registration = { active: {}, pushManager: {
    async getSubscription() { return subscription; },
    async subscribe(options) { sends.push(options); subscription = push; return subscription; },
  } };
  const serviceWorker = { async getRegistration() { return registrations.length ? registration : null; }, async register(url, options) { registrations.push({ url, options }); return registration; } };
  const Notification = { get permission() { return permission; }, async requestPermission() { permissions.push("requested"); permission = "granted"; return permission; } };
  const context = { console, URL, crypto: webcrypto, TextEncoder, Uint8Array, atob, navigator: { serviceWorker }, Notification,
    document: { readyState: "complete", getElementById: () => host, createElement: () => new Element() },
    window: { isSecureContext: supported, Notification, ...(supported ? { PushManager: {} } : {}), setTimeout, clearTimeout,
      addEventListener: (name, callback) => events[name] = callback,
      DartPlatform: { currentUser: () => user, async apiRequest(path, options) {
        calls.push({ path, options });
        if (path.startsWith("/api/v1/me/notifications?")) return list(path, user);
        if (path === "/api/v1/me/notifications/read") { if (failRead) throw new Error("private backend trace"); return { updated: options.body.ids.length }; }
        if (path === "/api/v1/me/push/config") return { configured: true, publicKey: "A".repeat(87) };
        if (path === "/api/v1/me/push/subscriptions" && !options) return { subscriptions: [] };
        if (path === "/api/v1/me/push/subscriptions") return { id: "device", enabled: true };
        if (path === "/api/v1/me/push/subscriptions/device") return {};
        throw new Error(`Unexpected fixture request ${path}`);
      } },
    },
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, elements, events, calls, permissions, registrations, sends,
    switchUser(value) { user = value; events["dart:customer-session-changed"](); },
    set failRead(value) { failRead = value; },
  };
}
const note = (id, title = "Order placed") => ({ id, title, orderCode: "K-TEST", message: "Synthetic order update", createdAt: "2026-10-27T00:00:00.000Z", readAt: null });
async function ui() {
  const pending = deferred(); const f = fixture({ list: () => pending.promise });
  assert.match(f.elements["data-notification-status"].textContent, /Loading/);
  pending.resolve({ notifications: [], unreadCount: 0, nextCursor: null }); await flush();
  assert.match(f.elements["data-notification-status"].textContent, /No notifications yet/);
  assert.match(f.elements["data-push-status"].textContent, /cannot enable/);
  assert.equal(f.permissions.length, 0); assert.equal(f.registrations.length, 0);

  let fail = true;
  const error = fixture({ list: async () => { if (fail) throw new Error("private database secret"); return { notifications: [note("one", "<img onerror=alert(1)>")], unreadCount: 1, nextCursor: null }; } });
  await flush(); assert.match(error.elements["data-notification-status"].textContent, /Refresh/);
  assert.doesNotMatch(error.elements["data-notification-status"].textContent, /private/);
  fail = false; error.elements["data-notification-refresh"].click(); await flush();
  assert.equal(error.elements["data-notification-list"].children[0].children[0].textContent, "<img onerror=alert(1)>");
  error.failRead = true; error.elements["data-notification-mark"].click(); await flush();
  assert.match(error.elements["data-notification-status"].textContent, /not saved/);
  assert.equal(error.elements["data-notification-list"].children[0].dataset.unread, "true");
  error.failRead = false; error.elements["data-notification-mark"].click(); await flush();
  assert.equal(error.elements["data-notification-list"].children[0].dataset.unread, "false");

  const old = deferred();
  const privacy = fixture({ list: (_path, user) => user.id === "customer-a" ? old.promise : Promise.resolve({ notifications: [note("b")], unreadCount: 1, nextCursor: null }) });
  privacy.switchUser({ id: "customer-b" }); await flush();
  old.resolve({ notifications: [note("a", "Private old customer")], unreadCount: 10, nextCursor: null }); await flush();
  assert.equal(privacy.elements["data-notification-list"].children[0].children[0].textContent, "Order placed");
  privacy.switchUser(null); await flush(); assert.equal(privacy.elements["data-notification-list"].children.length, 0);
  assert.match(privacy.elements["data-notification-status"].textContent, /Sign in/);

  const optIn = fixture({ supported: true }); await flush();
  assert.equal(optIn.permissions.length, 0); assert.equal(optIn.registrations.length, 0);
  optIn.elements["data-push-toggle"].click(); await flush();
  assert.equal(optIn.permissions.length, 1); assert.equal(optIn.registrations.length, 1);
  assert.equal(optIn.registrations[0].url, "/push-sw.js"); assert.equal(optIn.registrations[0].options.scope, "/push/");
  assert.equal(optIn.sends[0].userVisibleOnly, true);
  assert.match(optIn.elements["data-push-toggle"].textContent, /Disable/);
  optIn.elements["data-push-toggle"].click(); await flush();
  assert.ok(optIn.calls.some(call => call.options?.method === "DELETE"));
  assert.match(optIn.elements["data-push-status"].textContent, /disabled/);
}

async function worker() {
  const events = {}, shown = [], opened = [];
  const context = { URL, self: { location: { origin: "https://www.dartofficial.com" },
    addEventListener: (name, callback) => events[name] = callback,
    registration: { async showNotification(title, options) { shown.push({ title, options }); } },
    clients: { async matchAll() { return []; }, async openWindow(url) { opened.push(url); } },
  } };
  vm.createContext(context); vm.runInContext(fs.readFileSync("push-sw.js", "utf8"), context);
  let pending;
  events.push({ data: { json: () => ({ notificationId: "12345678-1234-1234-1234-123456789abc", url: "https://attacker.test/" }) }, waitUntil: task => pending = task });
  await pending; assert.equal(shown.length, 1); assert.match(shown[0].options.tag, /12345678/);
  assert.doesNotMatch(JSON.stringify(shown), /attacker/);
  events.push({ data: { json() { throw new Error("malformed"); } }, waitUntil: task => pending = task });
  await pending; assert.equal(shown.length, 2, "Every push still produces a visible notification");
  events.notificationclick({ notification: { close() {}, data: { url: "https://attacker.test" } }, waitUntil: task => pending = task });
  await pending; assert.equal(opened[0], "https://www.dartofficial.com/profile.html#customerNotifications");
  assert.equal(events.fetch, undefined); assert.doesNotMatch(fs.readFileSync("push-sw.js", "utf8"), /caches\.|indexedDB|localStorage/);
}

async function recovery() {
  let kept = 0, removed = 0;
  const valid = { scope: "https://www.dartofficial.com/push/", active: { scriptURL: "https://www.dartofficial.com/push-sw.js" }, async unregister() { kept++; } };
  const legacy = { scope: "https://www.dartofficial.com/", active: { scriptURL: "https://www.dartofficial.com/sw.js" }, async unregister() { removed++; } };
  const fake = { scope: "https://www.dartofficial.com/push/", active: { scriptURL: "https://www.dartofficial.com/other.js" }, async unregister() { removed++; } };
  const context = { URL, navigator: { serviceWorker: { async getRegistrations() { return [valid, legacy, fake]; } } }, location: { origin: "https://www.dartofficial.com" }, localStorage: { length: 0 }, window: { addEventListener() {} } };
  vm.createContext(context); vm.runInContext(fs.readFileSync("Js/dart-cache-recovery.js", "utf8"), context); await flush();
  assert.equal(kept, 0); assert.equal(removed, 2);
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.ok(config.headers.find(row => row.source === "/push-sw.js").headers.some(header => header.key === "Cache-Control" && header.value.includes("no-store")));
  assert.match(fs.readFileSync("scripts/stage-vercel-public.cjs", "utf8"), /'push-sw\.js'/);
}
(async () => { await ui(); await worker(); await recovery(); console.log("PASS customer notifications: async owner isolation, states/retry, safe text, explicit opt-in, disable, visible push and safe worker lifecycle"); })().catch(error => { console.error(error); process.exitCode = 1; });
