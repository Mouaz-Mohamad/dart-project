"use strict";
// Small DOM fixture: verifies actual handlers/renderers, not pixel layout or a live DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("Eye/Dart Eye.html", "utf8");
const callbacks = new Map(), nodes = new Map();
const rootCallbacks = new Map();
let document;
function node(id = "") {
  const classes = new Set();
  return {
    id, dataset: {}, style: {}, hidden: false, disabled: false, value: "", textContent: "", innerHTML: "",
    classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s), contains: (s) => classes.has(s), toggle(s, on) { on ? classes.add(s) : classes.delete(s); } },
    focus() { document.activeElement = this; }, reset() {}, replaceChildren() {}, appendChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], node(match[1]));
const tabs = [...html.matchAll(/id="(finance-tab-[^"]+)"[^>]*data-finance-tab="([^"]+)"/g)].map((m) => {
  const button = nodes.get(m[1]); button.dataset.financeTab = m[2]; return button;
});
const fieldsets = [...html.matchAll(/<fieldset[^>]*data-finance-form-resource="([^"]+)"[^>]*>([\s\S]*?)<\/fieldset>/g)].map((m) => {
  const section = node(m[1]); section.dataset.financeFormResource = m[1];
  const controls = [...m[2].matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"[^>]*name="([^"]+)"/g)].map((input) => {
    const control = nodes.get(input[1]); control.name = input[2]; return control;
  });
  section.querySelectorAll = () => controls;
  section.querySelector = (selector = "") => selector.startsWith('[name="')
    ? controls.find((control) => selector === `[name="${control.name}"]`) || null
    : controls[0];
  return section;
});
const modal = nodes.get("dart-finance-modal"), form = nodes.get("dart-finance-form");
const submit = nodes.get("dart-finance-form-submit"), error = nodes.get("dart-finance-form-error");
form.querySelector = (selector) => selector === '[type="submit"]' ? submit : error;
document = {
  readyState: "loading", hidden: false, activeElement: node("trigger"),
  getElementById(id) { return ["brand", "customers-draw-entry-header"].includes(id) ? null : nodes.get(id) || null; },
  querySelector(selector) { return fieldsets.find((s) => selector === `[data-finance-form-resource="${s.dataset.financeFormResource}"]`) || null; },
  querySelectorAll(selector) { return selector === "[data-finance-tab]" ? tabs : selector === "[data-finance-form-resource]" ? fieldsets : []; },
  createElement: () => node(), addEventListener(name, handler) { callbacks.set(name, handler); },
};
let failSummary = false, requests = 0;
const window = {
  document, structuredClone, dispatchEvent() {}, addEventListener(name, handler) {
    const list = rootCallbacks.get(name) || []; list.push(handler); rootCallbacks.set(name, list);
  }, setTimeout() { return 1; },
  localStorage: { getItem() { return null; }, setItem() {} },
  DartAdminAccess: { can() { return true; }, list() { return ["finance.read"]; } },
  DartAdminApi: { async request(url) {
    requests++;
    if (failSummary) throw new Error("offline");
    const data = window.DartFinance.dashboardData();
    return reportPayload(url, (range) => window.DartFinance.calculateSummary(data, range));
  } },
};
function reportPayload(url, makeSummary) {
  const query = new URLSearchParams(url.split("?")[1]);
  const range = { start: new Date(`${query.get("start")}T12:00:00`), end: new Date(`${query.get("end")}T12:00:00`) };
  const previous = { start: new Date(`${query.get("previousStart")}T12:00:00`), end: new Date(`${query.get("previousEnd")}T12:00:00`) };
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { allowedSections: ["revenue", "cost", "profit", "cashflow", "inventory", "marketing"],
    periods: [range, previous, ...window.DartFinance.bucketRanges(range)].map((period) =>
      ({ start: key(period.start), end: key(period.end), summary: makeSummary(period) })) };
}
const context = vm.createContext({ window, globalThis: window, document, console, CustomEvent: class {}, clearTimeout() {}, URLSearchParams, FormData: class { constructor(f) { this.f = f; } entries() { return Object.entries(this.f.payload); } } });
vm.runInContext(fs.readFileSync("Js/dart-state.js", "utf8"), context);
let finance = fs.readFileSync("Eye/dart-finance.js", "utf8");
finance = finance.replace('})(typeof window !== "undefined" ? window : globalThis);', 'root.__financeUi = { state, openResourceModal, closeFinanceModal, renderFinanceSection, saveFinanceForm, invalidateAuthoritativeFinance, financialBuckets, replaceChart }; })(typeof window !== "undefined" ? window : globalThis);');
vm.runInContext(finance, context);
const ui = window.__financeUi;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function main() {
  await window.DartFinance.hydrateAuthoritativeFinance();
  assert.equal(requests, 1, "current, previous and chart buckets use one HTTP request");
  const headerlessTabs = new Set(["expenses", "budgets", "invoices", "cod", "models", "drawlog"]);
  for (const tab of tabs) {
    await callbacks.get("click")({ target: { closest(selector) { return selector === "[data-finance-tab]" ? tab : null; } } });
    assert.equal(ui.state.financeTab, tab.dataset.financeTab);
    const markup = nodes.get("dart-finance-content").innerHTML;
    assert.ok(markup.length > 50, tab.dataset.financeTab + " renderer must produce content");
    if (headerlessTabs.has(tab.dataset.financeTab)) {
      assert.doesNotMatch(markup, /<thead\b/i, tab.dataset.financeTab + " must not render a thead");
      assert.match(markup, /<tbody>/i, tab.dataset.financeTab + " must retain its table body");
    } else if (tab.dataset.financeTab === "marketing") {
      assert.match(markup, /<thead\b/i, "Marketing retains its original headings");
    }
  }
  assert.equal(tabs.length, 12);
  const thumbRule = fs.readFileSync("Eye/dart.css", "utf8").match(/\.dart-item-thumb\s*\{([^}]*)\}/)?.[1] || "";
  for (const property of ["width: 48px !important;", "height: 60px !important;", "max-width: 48px;", "margin: 0;"]) {
    assert.ok(thumbRule.includes(property), "Item thumbnail must retain " + property);
  }
  const trigger = document.activeElement;
  for (const section of fieldsets) {
    ui.openResourceModal(section.dataset.financeFormResource);
    assert.equal(modal.style.display, "block");
    assert.ok(modal.classList.contains("active"));
    assert.equal(fieldsets.filter((s) => !s.hidden && !s.disabled).length, 1, "only the selected form must be enabled");
    assert.equal(form.dataset.resource, section.dataset.financeFormResource);
    assert.equal(document.activeElement, section.querySelector());
    submit.disabled = true; ui.closeFinanceModal();
    assert.ok(modal.classList.contains("active"), "do not dismiss an in-flight mutation");
    submit.disabled = false; ui.closeFinanceModal();
    assert.equal(modal.style.display, "none");
    assert.equal(document.activeElement, trigger);
  }
  assert.equal(fieldsets.length, 6, "five record forms plus COD receipt");
  // Submit the real handler while the persistence service fails: retain the form.
  ui.openResourceModal("goals");
  const today = new Date().toISOString().slice(0, 10);
  form.payload = { name: "Goal", metric: "revenue", target: "100", startDate: today, endDate: today, status: "Active" };
  await ui.saveFinanceForm(form);
  assert.ok(error.classList.contains("is-visible"));
  assert.ok(modal.classList.contains("active"));
  assert.equal(submit.disabled, false);
  window.DartDomainState = {
    domainForStorageKey(key) { return key.startsWith("dart_finance_") ? key.slice(5) : null; },
    version() { return 1; }, async hydrateDomain() {},
    write(key, rows) { window.DartState.write(key, rows); },
    async writeAndSync(key, rows) { window.DartState.write(key, rows); return rows; },
  };
  const records = {
    expenses: { date: today, category: "Other", amount: "100", status: "Unpaid" },
    budgets: { name: "Budget fixture", category: "All", amount: "100", warningPercent: "80", startDate: today, endDate: today },
    invoices: { number: "INV-TEST", type: "Supplier", issueDate: today, dueDate: today, total: "100", amountPaid: "0" },
    goals: form.payload,
    marketing: { date: today, channel: "Meta", campaign: "Campaign fixture", spend: "100", impressions: "1000", clicks: "10", orders: "1", attributedRevenue: "200" },
  };
  for (const [resource, payload] of Object.entries(records)) {
    ui.openResourceModal(resource); form.payload = payload;
    await ui.saveFinanceForm(form);
    assert.equal(modal.style.display, "none", resource + " success must close the form");
    assert.equal(window.DartFinance.repository.list(resource).length, 1);
    assert.equal(submit.disabled, false);
  }
  // Removing thead must keep labels available to the compact Details/status adapter.
  for (const key of ["expenses", "budgets", "invoices"]) {
    ui.state.financeTab = key;
    ui.renderFinanceSection();
    const markup = nodes.get("dart-finance-content").innerHTML;
    assert.doesNotMatch(markup, /<thead\b/i, key + " keeps thead removed when records exist");
    assert.match(markup, /<td data-column-label="[^"]+"/, key + " keeps field names on body cells");
    assert.match(markup, /data-finance-(?:edit|delete)=/, key + " record actions remain available");
  }
  // A failing report must display Retry and stop immediate error/re-render loops.
  ui.state.financeTab = "pnl";
  await window.DartFinance.hydrateAuthoritativeFinance(undefined, true);
  ui.renderFinanceSection();
  const priorMarkup = nodes.get("dart-finance-content").innerHTML;
  failSummary = true; ui.invalidateAuthoritativeFinance();
  ui.state.financeTab = "pnl"; ui.renderFinanceSection();
  await tick(); await tick();
  const requestCount = requests;
  ui.renderFinanceSection(); await tick();
  assert.equal(requests, requestCount, "rendering an error must not hammer the API");
  assert.match(nodes.get("dart-finance-content").innerHTML, /data-finance-retry/);
  failSummary = false;
  await callbacks.get("click")({ target: { closest(selector) { return selector === "[data-finance-retry]" ? {} : null; } } });
  await tick(); await tick();
  assert.match(nodes.get("dart-finance-content").innerHTML, /Profit &amp; Loss|Profit & Loss/);
  assert.equal(nodes.get("dart-finance-content").innerHTML, priorMarkup, "recovery must replace an error even when successful markup is unchanged");
  // A summary requested before a finance edit must not replace the newer totals.
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const summary = window.DartFinance.calculateSummary(window.DartFinance.dashboardData(), window.DartFinance.periodRange("this_month"));
  window.DartAdminApi.request = async (url) => { await oldGate; return reportPayload(url, () => ({ ...summary, netRevenue: 100 })); };
  ui.invalidateAuthoritativeFinance();
  const oldRefresh = window.DartFinance.hydrateAuthoritativeFinance();
  await tick();
  window.DartAdminApi.request = async (url) => reportPayload(url, () => ({ ...summary, netRevenue: 200 }));
  ui.invalidateAuthoritativeFinance();
  await window.DartFinance.hydrateAuthoritativeFinance();
  releaseOld(); await oldRefresh;
  assert.equal(window.DartFinance.authoritativeSummary(window.DartFinance.periodRange("this_month")).netRevenue, 200);

  // Reuse canvas/chart instances. Previous-period callback changes must not be lost in JSON signatures.
  let created = 0, updated = 0, destroyed = 0;
  window.Chart = class { constructor(_context, config) { created++; this.options = config.options; } update() { updated++; } destroy() { destroyed++; } };
  nodes.get("dart-financial-chart").getContext = () => ({});
  const config = (prior) => ({ type: "line", data: { labels: ["Oct"], datasets: [{ data: [200] }] },
    options: { plugins: { tooltip: { callbacks: { label: () => String(prior) } } } } });
  ui.replaceChart("financial", "dart-financial-chart", config(7));
  ui.replaceChart("financial", "dart-financial-chart", config(7));
  assert.equal(created, 1); assert.equal(updated, 0); assert.equal(destroyed, 0);
  await window.DartFinance.hydrateAuthoritativeFinance(undefined, true);
  ui.replaceChart("financial", "dart-financial-chart", config(7));
  assert.equal(updated, 0, "unchanged reports must not redraw the chart");
  window.DartAdminApi.request = async (url) => reportPayload(url, () => ({ ...summary, netRevenue: 201 }));
  await window.DartFinance.hydrateAuthoritativeFinance(undefined, true);
  ui.replaceChart("financial", "dart-financial-chart", config(8));
  assert.equal(updated, 1); assert.equal(created, 1); assert.equal(destroyed, 0);
  assert.equal(ui.state.charts.financial.options.plugins.tooltip.callbacks.label(), "8");

  // A previous API can fall back once; permanent bucket failures never restart on each render.
  const range = window.DartFinance.periodRange("this_month"), previous = range.previous;
  const day = (value) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  let legacyCalls = 0;
  window.DartAdminApi.request = async (url) => {
    legacyCalls++;
    if (url.includes("/report?")) throw Object.assign(new Error("old deployment"), { status: 404 });
    const query = new URLSearchParams(url.split("?")[1]);
    if ([range, previous].some(period => query.get("start") === day(period.start) && query.get("end") === day(period.end))) return { summary };
    throw Object.assign(new Error("offline bucket"), { status: 503 });
  };
  ui.invalidateAuthoritativeFinance(); await window.DartFinance.hydrateAuthoritativeFinance();
  ui.financialBuckets({}, range); await tick(); await tick();
  const failedBucketCalls = legacyCalls;
  ui.financialBuckets({}, range); await tick();
  assert.equal(legacyCalls, failedBucketCalls, "legacy failed buckets must stop until timed/manual retry");

  // Logout invalidates pending reports before their response can populate memory.
  let releaseLoggedOut;
  const logoutGate = new Promise(resolve => { releaseLoggedOut = resolve; });
  window.DartAdminApi.request = async () => { await logoutGate; return { summary }; };
  ui.invalidateAuthoritativeFinance();
  const pendingAtLogout = window.DartFinance.hydrateAuthoritativeFinance();
  await tick();
  rootCallbacks.get("dart:admin-logged-out").forEach(handler => handler({}));
  releaseLoggedOut(); await pendingAtLogout;
  assert.equal(window.DartFinance.authoritativeSummary(range), null);
  console.log("PASS Finance UI runtime: all 12 tabs, six forms, focus/close, pending-save guard, failed save, summary error/retry without request loop");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
