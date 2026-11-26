"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(configured = true, neonAvailable = false) {
  const nodes = new Map(), listeners = new Map(), requests = [];
  function element() {
    return { value: "", checked: false, disabled: false, hidden: false, textContent: "", dataset: {}, children: [], events: new Map(),
      addEventListener(name, callback) { this.events.set(name, callback); }, reportValidity: () => true,
      replaceChildren(...items) { this.children = items.flatMap(item => item.children || [item]); },
      append(...items) { this.children.push(...items); }, click() { return this.events.get("click")?.(); }, reset() {} };
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let allowed = true, confirm = true, failure = null, pending = null;
  let payload = { revision: 0, schedulerConfigured: configured, settings: {
    schedule: { enabled: true, intervalMinutes: 15, quietEnabled: true, quietStart: "01:00", quietEnd: "12:00" },
    calculator: { plan: "paid", computeCu: 0.25, computeRateUsd: 0.106, freeAllowanceCuHours: 100, hostingBudgetUsd: 25 } } };
  const document = { getElementById: node, createElement: element, createDocumentFragment: element, addEventListener: (name, callback) => listeners.set("doc:" + name, callback) };
  const window = { DartAdminAccess: { can: () => allowed }, DartSettingsTabs: { refresh() {} }, DartSiteSettings: { hydrate: async () => {} },
    DartDialog: { confirm: async () => confirm }, addEventListener: (name, callback) => listeners.set(name, callback), dispatchEvent() {},
    DartAdminApi: { request: async (path, options) => {
      requests.push({ path, options }); if (pending) return pending;
      if (failure) throw failure;
      if (path.endsWith("/process")) return { published: 2, failed: 0 };
      if (path.endsWith("/usage/database")) return neonAvailable ? {available:true,usedCuHours:0.3,compute:{state:"active",suspendSeconds:0},asOf:"2026-11-26T00:00:00Z"} : { available: false };
      if (path.endsWith("/usage/hosting")) return { available: true, billedUsd: 8, requests: 17, deployments: [{ available: true, complete: true, count: 4 }], periodStart: "2026-11-01T00:00:00Z", asOf: "2026-11-26T00:00:00Z" };
      if (options?.method === "PUT") payload = { ...payload, revision: payload.revision + 1, settings: options.body.settings };
      return structuredClone(payload);
    } } };
  vm.runInNewContext(fs.readFileSync("src/dashboard/infrastructure.js", "utf8"), { window, document, Intl, Date, Object, Number, String,
    CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } } });
  const clickTab = () => listeners.get("doc:click")({ target: { closest: () => ({ dataset: { settingsTab: "database" } }) } });
  const event = id => node(id).events.get("click")();
  const submit = () => node("infrastructure-form").events.get("submit")({ preventDefault() {} });
  return { node, listeners, requests, clickTab, event, submit, setConfirm: value => { confirm = value; },
    setFailure: value => { failure = value; }, setPending: value => { pending = value; }, logout() { allowed = false; listeners.get("dart:admin-logged-out")(); } };
}
(async () => {
  const neon = fixture(true, true); neon.clickTab(); await tick();
  assert(JSON.stringify(neon.node("infrastructure-database-usage").children).includes("5 دقيقة"), "Neon zero timeout means the default five-minute sleep; minus one disables sleep");
  const f = fixture();
  assert.equal(f.requests.length, 0, "No infrastructure API request until a tab is opened");
  f.clickTab(); await tick();
  assert.equal(f.node("infra-interval").value, 15);
  assert.match(f.node("infrastructure-estimate").textContent, /52.*1560.*32.5.*3.45/);
  f.node("infra-interval").value = 30;
  f.node("infrastructure-form").events.get("input")();
  assert.match(f.node("infrastructure-estimate").textContent, /26.*780/);
  await f.submit();
  const save = f.requests.find(item => item.options?.method === "PUT");
  assert.equal(save.options.body.settings.schedule.intervalMinutes, 30);
  assert.equal(save.options.body.expectedRevision, 0);
  assert.match(f.node("infrastructure-status").textContent, /تم حفظ/);
  await f.event("infrastructure-hosting-refresh");
  assert(JSON.stringify(f.node("infrastructure-hosting-usage").children).includes("17"));
  await f.event("infrastructure-database-refresh");
  assert(JSON.stringify(f.node("infrastructure-database-usage").children).includes("غير مربوط"));
  f.setConfirm(false); const before = f.requests.length; await f.event("infrastructure-process");
  assert.equal(f.requests.length, before, "Cancelled manual send never calls API");
  f.setConfirm(true); await f.event("infrastructure-process");
  assert.match(f.node("infrastructure-status").textContent, /2 منشور/);
  f.node("infra-interval").value = 45; f.node("infrastructure-form").events.get("input")();
  f.setFailure({ status: 409 }); await f.submit();
  assert.equal(f.node("infra-interval").value, 45, "Conflict retains unsaved input");
  assert.match(f.node("infrastructure-status").textContent, /جهاز آخر/);
  const disabled = fixture(false); disabled.clickTab(); await tick();
  assert.equal(disabled.node("infrastructure-save").disabled, true);
  assert.equal(disabled.node("infrastructure-process").disabled, false, "Missing scheduler credentials do not disable audited manual processing");
  const stale = fixture(); let resolve;
  stale.setPending(new Promise(done => { resolve = done; })); stale.clickTab(); stale.logout();
  resolve({ revision: 0, schedulerConfigured: true, settings: {} }); await tick();
  assert.equal(stale.node("infrastructure-fields").disabled, true, "Stale responses cannot restore a logged-out settings form");
  assert.equal(stale.node("settings-database-card").hidden, true);
  console.log("PASS infrastructure UI: lazy reads, estimates, save, conflict retention, unavailable metrics, manual confirmation and logout races");
})().catch(error => { console.error(error); process.exitCode = 1; });
