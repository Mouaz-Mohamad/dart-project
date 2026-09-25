// DART CODE GUIDE | tests/finance-dashboard-contract.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Eye", "Dart Eye.html"), "utf8");
const finance = fs.readFileSync(path.join(root, "Eye", "dart-finance.js"), "utf8");
const financeStyles = fs.readFileSync(path.join(root, "Eye", "dart-finance.css"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "Eye", "dart.js"), "utf8");

assert(html.includes('href="dart-finance.css"'), "Dashboard must load finance styles.");
assert(html.includes('src="dart-finance.js"'), "Dashboard must load finance behavior.");
assert.strictEqual((html.match(/id="myChart"/g) || []).length, 1, "The original Brand chart must remain singular.");
assert(!finance.includes("myChart"), "Finance code must not address or replace the original Brand chart.");
for (const protectedId of ["updates-feed", "birthday-feed", "top-clients-feed", "analyticsChartTow"]) {
  assert.strictEqual((html.match(new RegExp(`id="${protectedId}"`, "g")) || []).length, 1, `${protectedId} must remain intact.`);
}

for (const key of [
  "dart_finance_expenses",
  "dart_finance_budgets",
  "dart_finance_invoices",
  "dart_finance_goals",
  "dart_finance_marketing",
  "dart_finance_cod_settlements",
  "dart_draw_eligibility_audit",
]) assert(finance.includes(key), `Missing backend-ready storage boundary: ${key}`);

for (const report of ["Profit & Loss", "Cash Flow", "Cash on Delivery", "Model Profitability", "Marketing Analytics", "Alerts"]) {
  assert(finance.includes(report), `Finance section is missing ${report}.`);
}

for (const canvas of ["dart-returning-chart", "dart-goals-chart", "dart-financial-chart"]) {
  assert(html.includes(`id="${canvas}"`), `Brand is missing static ${canvas} markup.`);
}

for (const staticId of [
  "dart-brand-finance",
  "dart-brand-insights",
  "dart-analytics-grid",
  "finance",
  "finance-tabs",
  "dart-finance-modal",
  "dart-finance-form",
  "brand-in-stock-selling-value",
  "brand-in-stock-cost-value",
  "dashboard-return-row-template",
  "return-approval-modal",
  "return-rejection-modal",
  "return-rep-assignment-modal",
]) assert(html.includes(`id="${staticId}"`), `Static HTML structure is missing #${staticId}.`);

assert(html.includes("Compared with the previous equivalent period"), "Unified period comparison copy is missing.");

assert(html.includes('id="trafficUniqueVisitorsTow"'), "Traffic analytics must expose a Unique Visitors card.");
assert(html.includes('id="trafficVisitsTow"'), "Traffic analytics must expose total Visits.");
assert(html.includes('id="trafficCartVisitorsTow"'), "Traffic analytics must expose unique cart visitors.");
assert(html.includes('id="trafficAddEventsTow"'), "Traffic analytics must expose detailed Add to Cart events.");
assert(html.includes('id="trafficItemsAddedTow"'), "Traffic analytics must expose the total quantity added to carts.");
assert(html.includes('id="trafficOrdersTow"'), "Traffic analytics must expose successful website orders.");
assert(html.includes('id="trafficVisitorDetailsTow"'), "Traffic analytics must keep per-visitor details in Brand.");
for (const aggregation of ["daily", "weekly", "monthly", "yearly"]) {
  assert(html.includes(`data-chart-period-tow="${aggregation}"`), `Traffic chart must support ${aggregation} aggregation.`);
}
assert(dashboard.includes("/api/v1/admin/analytics/traffic"), "Traffic chart must read authoritative analytics from the admin API.");
assert(!dashboard.includes("dataStoreTow"), "Traffic chart must not retain static/demo visitor arrays.");
assert(finance.includes("currentRangeSelection"), "The Brand general period must be exposed to the traffic chart.");
assert(finance.includes('dart:finance-period-changed'), "Traffic chart must refresh when the Brand general period changes.");
assert(html.includes("Customer Order Frequency"), "Brand must label the five-bucket customer frequency chart clearly.");
for (const label of ["1 Order", "2 Orders", "3 Orders", "4 Orders", "5+ Orders"]) {
  assert(finance.includes(`label: "${label}"`), `Returning-customer chart is missing ${label}.`);
}
for (const color of ["#F2E3E7", "#E3B7C2", "#D18498", "#BF506D", "#AB012B"]) {
  assert(finance.includes(color), `Returning-customer chart is missing brand-compatible bucket color ${color}.`);
}
assert(finance.includes("renderReturningChart(currentFrequency, previousFrequency)"), "Returning-customer chart must compare each bucket with the previous equivalent period.");
assert(finance.includes("orderFrequencyBuckets"), "Finance summary must expose five customer order-frequency buckets.");
assert(!finance.includes("insertAdjacentHTML(\"beforeend\", '<li><a href=\"#\" data-target=\"finance\""), "Finance navigation must live in HTML.");
assert(!finance.includes("document.body.insertAdjacentHTML"), "The Finance modal must live in HTML.");
assert(!finance.includes("periodControlMarkup"), "Period-control structure must live in HTML.");
assert(!finance.includes("dart-brand-chart-grid\">"), "Business Insights structure must live in HTML.");
assert(!html.includes('id="finance-expenses-box"'), "Do not add a second Expenses box; the existing tab already owns this UI.");
assert(finance.includes("function renderExpenses"), "The existing Expenses table must remain available.");
assert(financeStyles.includes("#brand.active-section") && financeStyles.includes("height: 260px"), "Brand must reserve bounded chart space without forcing an inactive section visible.");
for (const formId of ["finance-expense-fields", "finance-budget-fields", "finance-invoice-fields", "finance-goal-fields", "finance-marketing-fields", "finance-settlement-fields"]) {
  assert(html.includes(`id="${formId}"`), `Finance form markup is missing #${formId}.`);
}
const brandMarkup = html.slice(html.indexOf('<section id="brand"'), html.indexOf('<section id="models"'));
assert(
  brandMarkup.indexOf('id="dart-analytics-grid"') < brandMarkup.indexOf('id="dart-brand-insights"') &&
    brandMarkup.indexOf('id="dart-brand-insights"') < brandMarkup.indexOf('class="strok"'),
  "Brand analytics blocks must have stable non-overlapping HTML order.",
);
assert(finance.includes("DART_CARD_DRAW_ELIGIBILITY_CHANGED"), "Draw eligibility changes must be audited.");
assert(
  finance.includes("customer.dartCardDrawEligible !== false"),
  "Draw eligibility UI must reflect the server-authoritative customer flag.",
);
assert(
  finance.includes("/dart-card-draw-eligibility"),
  "Draw eligibility changes must be persisted through the secure admin API.",
);
assert(
  !dashboard.includes("dartEnsureMonthlyDartCardWinners"),
  "The browser must not award monthly Dart Cards authoritatively.",
);
assert(finance.includes("returnCourierCosts"), "Total Cost must include Dart-paid return/exchange representative fees.");
assert(finance.includes("deliveryCosts"), "Finance must expose courier allocation for reconciliation without double-counting it.");
assert(finance.includes("Courier Due") && finance.includes("Due to Dart"), "COD must separate courier entitlement from Dart receivable.");
assert(!finance.includes("returnCourierCosts + deliveryCosts"), "Courier allocation must not be added on top of item COGS.");
assert(html.includes('id="settings-delivery-cost"'), "Settings must expose the per-order courier fee used for future order snapshots.");
assert(html.includes("Courier fee per order"), "Settings must clearly label the courier fee as per-order.");
assert(finance.includes("inStockCost"), "Brand must calculate the filtered In Stock Cost Value.");
assert(dashboard.includes("dartAssignReturnRepresentative"), "Dashboard return requests must support representative assignment.");

for (const page of ["index.html", "products.html", "cart-checkout.html", "profile.html", "track.html", "about.html", "Contact us.html"]) {
  const source = fs.readFileSync(path.join(root, page), "utf8");
  assert(!source.includes("dart-finance"), `${page} must not load dashboard finance code.`);
}

console.log("PASS finance dashboard contracts and protected Brand widgets");
