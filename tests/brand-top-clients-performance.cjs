"use strict";
// Verify delivered-order aggregation and guard against quadratic filtering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync("src/dashboard/core/brand-analytics.js", "utf8");
const start = code.indexOf("function renderTopClients()");
const end = code.indexOf("\n\nfunction dartInStockSellingValue()", start);
assert.ok(start >= 0 && end > start);
const now = new Date();
const deliveredAt = now.toISOString();
const rows = [
  { status: "Delivered", clientId: "A", deliveredAt, net: 100, amountRefunded: 20 },
  { status: "Delivered", clientId: "A", deliveredAt, net: 70, amountRefunded: 0 },
  { status: "Delivered", clientId: "B", deliveredAt, net: 250, amountRefunded: 0 },
  { status: "Delivered", clientId: "A", deliveredAt: "2025-01-01T12:00:00.000Z", net: 999 },
  { status: "Preparing", clientId: "A", deliveredAt, net: 999 },
];
let orderFilters = 0;
rows.filter = function (...args) { orderFilters++; return Array.prototype.filter.apply(this, args); };
const feed = { innerHTML: "" };
const monthFilter = { value: "current", dataset: {}, options: [{value: "current"}], innerHTML: "", addEventListener() {} };
const context = vm.createContext({
  document: { getElementById(id) { return id === "top-clients-feed" ? feed : id === "topClientsMonthFilter" ? monthFilter : null; } },
  ordersData: rows,
  customersData: [
    { clientId: "A", clientName: "Alice", birthday: "2000-01-01", registeredAt: deliveredAt },
    { clientId: "B", clientName: "Bob", birthday: "2001-01-01", registeredAt: deliveredAt },
  ],
  dartIsActive: () => true,
  dartOrderNet: row => row.net,
  dartEsc: value => String(value ?? ""),
  dartClientAgeLabel: () => "24",
  dartMoney: value => String(value),
  console, Date, Intl, Map,
});
vm.runInContext(code.slice(start, end), context);
vm.runInContext("renderTopClients()", context);
assert.ok(feed.innerHTML.includes("Alice"));
assert.ok(feed.innerHTML.includes("Bob"));
assert.ok(feed.innerHTML.indexOf("Alice") < feed.innerHTML.indexOf("Bob"), "order count remains primary ranking");
assert.match(feed.innerHTML, /2 Order/);
assert.match(feed.innerHTML, /150/);
assert.ok(orderFilters <= 2, "orders should be scanned a constant number of times, not once per customer");
console.log("PASS brand top-clients: period, delivery, refunds, sorting and linear order scans");
