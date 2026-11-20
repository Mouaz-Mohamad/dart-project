"use strict";
// DART CODE GUIDE | tests/dashboard-refresh-runtime.cjs
// Exercise the actual dashboard scheduler with several changes in the same frame.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync("Eye/dart.js", "utf8");
// Keep chart dependencies blocking only after the dashboard HTML is parsed,
// and loaded before the dashboard runtime that constructs charts.
const html = fs.readFileSync("Eye/Dart Eye.html", "utf8");
const headEnd = html.indexOf("</head>");
const apex = html.indexOf('src="https://cdn.jsdelivr.net/npm/apexcharts"');
const charts = html.indexOf('src="https://cdn.jsdelivr.net/npm/chart.js"');
const appJs = html.indexOf('src="dart.js?');
assert.ok(apex > headEnd && charts > headEnd && appJs > charts, "chart libraries must not block the initial HTML head, but precede dashboard runtime");
const start = source.indexOf("// BEGIN Scoped dashboard refresh");
const end = source.indexOf("// END Scoped dashboard refresh", start);
const frames = [], renders = [], events = new Map();
let active = "orders", loads = 0, orderCards = 0, brand = 0;
const document = { hidden: false, querySelector() { return { id: active }; }, getElementById() { return null; },
  addEventListener(name, fn) { events.set(name, fn); } };
const context = vm.createContext({ document, console, window: { requestAnimationFrame(fn) { frames.push(fn); } },
  sectionsMap: { orders: {}, models: {}, items: {}, customers: {} }, dartRenderSection(key) { renders.push(key); },
  loadAllDataFromStorage() { loads++; }, updateOrderCards() { orderCards++; },
  updateBrandAnalytics() { brand++; }, renderNotifications() {}, setTimeout() { throw new Error("Unexpected background row construction"); } });
vm.runInContext(source.slice(start, end), context);
vm.runInContext("dartDashboardReloadQueued = true; dartRefreshAll(); dartRefreshAll(); dartRefreshAll();", context);
assert.equal(frames.length, 1, "a burst must queue one frame");
frames.shift()();
assert.equal(loads, 1, "reload the memory projection once for the burst");
assert.deepEqual(renders, ["orders"], "hidden Models/Items/Customers must not be built");
assert.equal(orderCards, 1);
active = "models";
vm.runInContext("dartRefreshAll()", context); frames.shift()();
assert.deepEqual(renders, ["orders", "models"], "opening another section builds its current data");
active = "brand";
vm.runInContext("dartRefreshAll()", context); frames.shift()();
assert.equal(brand, 1);
document.hidden = true;
vm.runInContext("dartDashboardReloadQueued = true; dartRefreshAll()", context);
assert.equal(frames.length, 0);
document.hidden = false;
events.get("visibilitychange")(); frames.shift()();
assert.equal(loads, 2, "a hidden change must be reconciled on return");
console.log("PASS dashboard refresh: bursts, scoped visible rows, section changes and hidden-tab reconciliation");
