"use strict";
// Execute the actual state/domain/Finance modules, not source-marker contracts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = (path) => fs.readFileSync(path, "utf8");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function runtime(server = new Map()) {
  const calls = [], listeners = new Map();
  let intercept = null;
  const window = {
    structuredClone, dispatchEvent() {}, setInterval() {}, setTimeout() {},
    addEventListener(name, handler) { listeners.set(name, handler); },
    localStorage: { getItem() { return null; }, setItem() { throw new Error("Business persistence forbidden"); } },
  };
  const context = vm.createContext({
    window, globalThis: window, location: { origin: "https://test.invalid" },
    document: { cookie: "", hidden: false, addEventListener() {} },
    console, CustomEvent: class {}, structuredClone, TextEncoder, URLSearchParams,
    crypto: require("node:crypto").webcrypto, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const domain = url.split("/").pop();
      const row = server.get(domain) || { version: 1, data: [] };
      const body = options.body && JSON.parse(options.body);
      const call = { domain, method: options.method, body };
      calls.push(call);
      if (intercept) {
        const response = await intercept(call, structuredClone(row));
        if (response) return response;
      }
      if (options.method === "PUT") {
        if (body.expectedVersion !== row.version) return { ok: false, status: 409, json: async () => ({ error: { code: "VERSION_CONFLICT", message: "Refresh and try again" } }) };
        server.set(domain, { version: row.version + 1, data: body.data });
      }
      return { ok: true, json: async () => structuredClone(server.get(domain) || row) };
    },
  });
  vm.runInContext(source("Js/dart-state.js"), context);
  vm.runInContext(source("Eye/dart-domain-state.js"), context);
  vm.runInContext(source("Eye/dart-finance.js"), context);
  return { window, context, calls, server, listeners, intercept(fn) { intercept = fn; } };
}

async function main() {
  const r = runtime();
  const state = r.window.DartState, finance = r.window.DartFinance, domains = r.window.DartDomainState;
  for (const resource of ["expenses", "budgets", "invoices", "goals", "marketing"]) {
    const key = finance.STORAGE_KEYS[resource];
    const domain = domains.domainForStorageKey(key);
    r.server.set(domain, { version: 4, data: [{ id: "existing", name: resource }] });
    // Saving before hydration must fetch the existing collection before merging.
    await finance.persistRecord(resource, { id: "new", name: resource, target: 100 });
    assert.equal(r.server.get(domain).data.length, 2, resource + " must preserve existing records");
    assert.equal(finance.repository.list(resource).length, 2);
    await finance.persistRecord(resource, { id: "new", name: resource, target: 200 });
    assert.equal(r.server.get(domain).data.length, 2, "editing must not duplicate");
    await finance.archiveRecord(resource, "new");
    assert.ok(r.server.get(domain).data.find((row) => row.id === "new").archivedAt);
    const reloaded = runtime(r.server);
    await reloaded.window.DartDomainState.hydrateDomain(domain);
    assert.equal(reloaded.window.DartFinance.repository.list(resource).length, 2, "reload must read PostgreSQL projection");
  }
  for (const [key, resource] of [["dart_finance_cod_settlements", "settlements"]]) {
    state.write(key, [{ id: "settlement" }]);
    assert.equal(finance.repository.list(resource).length, 1);
  }
  state.write("dart_draw_eligibility_audit", [{ id: "draw" }]);
  assert.equal(state.isBusinessKey("dart_draw_eligibility_audit"), true);
  state.write("ui_preference", "keep");
  state.clearBusiness();
  assert.equal(state.read("dart_finance_goals", null), null);
  assert.equal(state.read("ui_preference"), "keep");
  state.write("dart_orders", [1]);
  state.remove("dart_orders");
  assert.equal(state.read("dart_orders", null), null);

  const race = runtime();
  await race.window.DartDomainState.hydrateDomain("finance_goals");
  let release, started;
  const blocked = new Promise((resolve) => { release = resolve; });
  const firstStarted = new Promise((resolve) => { started = resolve; });
  let count = 0;
  race.intercept(async (call) => {
    if (call.method === "PUT" && ++count === 1) { started(); await blocked; }
  });
  const a = race.window.DartDomainState.writeAndSync("dart_finance_goals", [{ id: "g", target: 100 }]);
  await firstStarted;
  const b = race.window.DartDomainState.writeAndSync("dart_finance_goals", [{ id: "g", target: 200 }]);
  release();
  await Promise.all([a, b]);
  assert.equal(race.server.get("finance_goals").data[0].target, 200, "old PUT response must not clobber a new edit");
  assert.deepEqual(race.calls.filter((call) => call.method === "PUT").map((call) => call.body.expectedVersion), [1, 2]);

  // A stale GET arriving after a confirmed mutation must not erase it.
  race.intercept(async (call, row) => {
    if (call.method !== "GET") return;
    await blockedRead;
    return { ok: true, json: async () => row };
  });
  let releaseRead;
  const blockedRead = new Promise((resolve) => { releaseRead = resolve; });
  const read = race.window.DartDomainState.hydrateDomain("finance_goals");
  await turn();
  await race.window.DartDomainState.writeAndSync("dart_finance_goals", [{ id: "g", target: 300 }]);
  releaseRead(); await read;
  assert.equal(race.window.DartState.read("dart_finance_goals")[0].target, 300);
  assert.equal(race.window.DartDomainState.version("finance_goals"), 4);

  race.intercept(null);
  race.server.set("finance_goals", { version: 5, data: [{ id: "other-admin", target: 500 }] });
  await assert.rejects(race.window.DartDomainState.writeAndSync("dart_finance_goals", [{ id: "g", target: 600 }]), (error) => error.status === 409);
  assert.equal(race.window.DartState.read("dart_finance_goals")[0].id, "other-admin", "conflict must rehydrate server state");
  race.intercept(async (call) => call.method === "PUT" ? { ok: false, status: 503, json: async () => ({ error: { message: "Service unavailable" } }) } : null);
  await assert.rejects(race.window.DartFinance.persistRecord("goals", { id: "failed" }));
  assert.equal(race.window.DartFinance.repository.list("goals").length, 1, "failed save must roll back the optimistic row");
  const savedAdapter = race.window.DartDomainState;
  delete race.window.DartDomainState;
  await assert.rejects(race.window.DartFinance.persistRecord("goals", { id: "offline" }), /secure finance service/);
  race.window.DartDomainState = savedAdapter;
  const savedState = race.window.DartState;
  delete race.window.DartState;
  await assert.rejects(race.window.DartFinance.persistRecord("goals", { id: "missing-state" }), /could not be loaded safely/);
  race.window.DartState = savedState;
  const receipt = runtime();
  receipt.intercept(async (call) => {
    if (call.method === "POST") return { ok: true, json: async () => ({ version: 3, settlement: { id: "receipt", orderId: "order", amountReceived: 100 } }) };
    return { ok: false, status: 503, json: async () => ({ error: { message: "Refresh unavailable" } }) };
  });
  const confirmedReceipt = await receipt.window.DartDomainState.createFinanceSettlement({ orderId: "order", amountReceived: 100 });
  assert.equal(confirmedReceipt.id, "receipt");
  assert.equal(receipt.window.DartFinance.repository.list("settlements")[0].id, "receipt", "confirmed receipt must survive a failing follow-up GET");

  // Test the real lazy loader with a failed download followed by successful retry.
  const dashboard = source("Eye/dart.js");
  const start = dashboard.indexOf("let dartFinanceLoadPromise = null;");
  const end = dashboard.indexOf("let dartTrafficAnalyticsLoadPromise", start);
  let element = null, appended = 0;
  const loaderWindow = {};
  const loaderDocument = {
    querySelector() { return element; }, getElementById() { return null; },
    createElement() { const e = { dataset: {}, remove() { if (element === e) element = null; } }; return e; },
    body: { appendChild(e) { element = e; appended++; } },
  };
  const loader = vm.createContext({ window: loaderWindow, document: loaderDocument });
  vm.runInContext(dashboard.slice(start, end), loader);
  const failed = loader.dartLoadFinance();
  element.onerror(); await assert.rejects(failed);
  const retried = loader.dartLoadFinance();
  loaderWindow.DartFinance = { ready: true }; element.onload(); await retried;
  assert.equal(appended, 2, "retry must download a new script");
  console.log("PASS Finance state integration: five collections, save/edit/archive/reload, memory cleanup, queued saves, stale GET, 409/503, unavailable adapter, loader retry");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
