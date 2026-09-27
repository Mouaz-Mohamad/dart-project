// DART CODE GUIDE | tests/finance-persistence-contract.js
// الغرض: منع رجوع حفظ Finance الوهمي أو تجاوز مسار تحصيل المندوب الخادمي.
const fs = require("node:fs");
const assert = require("node:assert/strict");

const finance = fs.readFileSync("Eye/dart-finance.js", "utf8");
const state = fs.readFileSync("Eye/dart-domain-state.js", "utf8");
const routes = fs.readFileSync("backend/src/modules/finance/finance.routes.ts", "utf8");
const dashboardRoutes = fs.readFileSync(
  "backend/src/modules/dashboard/dashboard-state.routes.ts",
  "utf8",
);

assert.match(finance, /async function saveFinanceForm/);
assert.match(finance, /await persistFinanceRecord\(resource, normalized\)/);
assert.match(finance, /await root\.DartDomainState\.createFinanceSettlement\(normalized\)/);
assert.match(finance, /form\.dataset\.pendingId = normalized\.id/);
assert.match(finance, /submit\.textContent = "Saving\.\.\."/);
assert.match(state, /async function writeAndSync/);
assert.match(state, /await syncNow\(domain\)/);
assert.match(state, /\/api\/v1\/admin\/finance\/settlements/);
assert.match(routes, /router\.post\(\s*"\/admin\/finance\/settlements"/);
assert.match(dashboardRoutes, /SETTLEMENT_ENDPOINT_REQUIRED/);

console.log("Finance persistence contract passed.");
