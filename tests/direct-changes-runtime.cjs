"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
function fixture(admin = false, supported = true) {
  const sources = [], timers = new Map(), events = [], listeners = new Map(), documentEvents = new Map();
  let timerId = 0;
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); sources.push(this); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  }
  const window = { EventSource: Source, DartAdminHydration: { ready: false },
    addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent: event => events.push(event),
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; } };
  const document = { hidden: false, addEventListener: (name, fn) => documentEvents.set(name, fn) };
  vm.runInNewContext(fs.readFileSync("Js/dart-changes.js", "utf8"), { window, document, navigator: { onLine: true },
    location: { origin: "https://dart.test", pathname: admin ? "/Eye/Dart Eye.html" : "/products.html" },
    fetch: async () => ({ ok: true, json: async () => ({ capabilities: supported ? ["direct-updates-v1"] : [] }) }),
    CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } }, clearTimeout: id => timers.delete(id) });
  const fire = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
  return { window, document, sources, timers, events, listeners, documentEvents, fire };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
const unsupported = fixture(false, false); await tick(); assert.equal(unsupported.sources.length, 0);
const f = fixture(); await tick();
assert.equal(f.sources.length, 1); assert.equal(f.window.DartChanges.active, false);
f.sources[0].emit("ready", {}); assert.equal(f.window.DartChanges.active, true);
assert.equal(f.events[0].detail.reconcile, true);
f.sources[0].emit("change", { scope: "version", name: "catalog_inventory", version: -1 });
assert.equal(f.events.length, 1);
f.sources[0].emit("change", { scope: "version", name: "catalog_inventory", version: 5 });
assert.equal(f.events[1].detail.version, 5);
f.sources[0].emit("error"); assert.equal(f.window.DartChanges.active, false); assert.equal(f.sources[0].closed, true);
f.sources[0].emit("ready", {}); assert.equal(f.window.DartChanges.active, false, "stale callbacks cannot restore a closed source");
f.fire(1000); await tick(); assert.equal(f.sources.length, 2);
f.sources[1].emit("ready", {}); assert.equal(f.events[2].detail.reconcile, true);
f.document.hidden = true; f.documentEvents.get("visibilitychange")(); assert.equal(f.sources[1].closed, true);
assert.equal(f.timers.size, 0, "hidden tabs leave no stream or reconnect timer");
f.document.hidden = false; f.documentEvents.get("visibilitychange")(); await tick(); assert.equal(f.sources.length, 3);
f.fire(10000); assert.equal(f.window.DartChanges.active, false); assert.equal(f.sources[2].closed, true);

const admin = fixture(true); assert.equal(admin.sources.length, 0);
admin.listeners.get("dart:admin-authenticated")(); await tick(); assert.equal(admin.sources[0].url, "https://dart.test/api/v1/admin/changes");
admin.sources[0].emit("ready", {}); assert.equal(admin.window.DartChanges.active, true);
admin.listeners.get("dart:data-changed")({ detail: { source: "logout" } });
assert.equal(admin.window.DartChanges.active, false); assert.equal(admin.sources[0].closed, true);
admin.listeners.get("online")(); assert.equal(admin.sources.length, 1, "logout cannot reconnect a private stream");
console.log("PASS direct changes: authoritative invalidations, reconnect reconciliation, stale events, startup timeout, hidden tabs and Staff logout isolation");

})().catch(error => { console.error(error); process.exitCode = 1; });
