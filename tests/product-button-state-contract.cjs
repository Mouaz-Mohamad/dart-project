const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync(
  path.resolve(__dirname, "../Js/dart-product-button-state.js"),
  "utf8",
);
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

const decide = context.DartProductButtonState?.decide;
assert.equal(typeof decide, "function", "product button-state decision helper must exist");

const inStock = decide({ hasColor: true, hasSize: true, stock: 2, waitingEnabled: true });
assert.equal(inStock.showBuy, true);
assert.equal(inStock.showWaiting, false);

const outOfStock = decide({ hasColor: true, hasSize: true, stock: 0, waitingEnabled: true });
assert.equal(outOfStock.showBuy, false);
assert.equal(outOfStock.showWaiting, true);

const incomplete = decide({ hasColor: true, hasSize: false, stock: 0, waitingEnabled: true });
assert.equal(incomplete.showBuy, true);
assert.equal(incomplete.showWaiting, false);

const waitingDisabled = decide({ hasColor: true, hasSize: true, stock: 0, waitingEnabled: false });
assert.equal(waitingDisabled.showBuy, true);
assert.equal(waitingDisabled.showWaiting, false);

console.log("PASS product Buy/Waiting visibility contract");
