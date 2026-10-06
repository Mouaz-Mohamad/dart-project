"use strict";
// Small DOM fixture: verifies actual handlers/renderers, not pixel layout or a live DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("Eye/Dart Eye.html", "utf8");
const callbacks = new Map(), nodes = new Map();
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
  document, structuredClone, dispatchEvent() {}, addEventListener() {}, setTimeout() { return 1; },
  localStorage: { getItem() { return null; }, setItem() {} },
  DartAdminAccess: { can() { return true; }, list() { return ["finance.read"]; } },
  DartAdminApi: { async request() {
    requests++;
    if (failSummary) throw new Error("offline");
    const data = window.DartFinance.dashboardData();
    return { summary: window.DartFinance.calculateSummary(data, window.DartFinance.periodRange("this_month")) };
  } },
};
const context = vm.createContext({ window, globalThis: window, document, console, CustomEvent: class {}, clearTimeout() {}, URLSearchParams, FormData: class { constructor(f) { this.f = f; } entries() { return Object.entries(this.f.payload); } } });
vm.runInContext(fs.readFileSync("Js/dart-state.js", "utf8"), context);
let finance = fs.readFileSync("Eye/dart-finance.js", "utf8");
finance = finance.replace('})(typeof window !== "undefined" ? window : globalThis);', 'root.__financeUi = { state, openResourceModal, closeFinanceModal, renderFinanceSection, saveFinanceForm, invalidateAuthoritativeFinance }; })(typeof window !== "undefined" ? window : globalThis);');
vm.runInContext(finance, context);
const ui = window.__financeUi;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function main() {
  await window.DartFinance.hydrateAuthoritativeFinance();
  for (const tab of tabs) {
    await callbacks.get("click")({ target: { closest(selector) { return selector === "[data-finance-tab]" ? tab : null; } } });
    assert.equal(ui.state.financeTab, tab.dataset.financeTab);
    assert.ok(nodes.get("dart-finance-content").innerHTML.length > 50, tab.dataset.financeTab + " renderer must produce content");
  }
  assert.equal(tabs.length, 12);
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
  // A failing report must display Retry and stop immediate error/re-render loops.
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
  // A summary requested before a finance edit must not replace the newer totals.
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const summary = window.DartFinance.calculateSummary(window.DartFinance.dashboardData(), window.DartFinance.periodRange("this_month"));
  window.DartAdminApi.request = async () => { await oldGate; return { summary: { ...summary, netRevenue: 100 } }; };
  ui.invalidateAuthoritativeFinance();
  const oldRefresh = window.DartFinance.hydrateAuthoritativeFinance();
  await tick();
  window.DartAdminApi.request = async () => ({ summary: { ...summary, netRevenue: 200 } });
  ui.invalidateAuthoritativeFinance();
  await window.DartFinance.hydrateAuthoritativeFinance();
  releaseOld(); await oldRefresh;
  assert.equal(window.DartFinance.authoritativeSummary(window.DartFinance.periodRange("this_month")).netRevenue, 200);
  console.log("PASS Finance UI runtime: all 12 tabs, six forms, focus/close, pending-save guard, failed save, summary error/retry without request loop");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
