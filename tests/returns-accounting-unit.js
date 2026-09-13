"use strict";

const assert = require("assert");
const returns = require("../Js/dart-returns.js");

const order = {
  orderId: "K-1",
  totalPrice: 1000,
  discount: 30,
  orderLevelDiscountAmount: 300,
  priceSnapshot: [
    { itemCode: "I-600", modelCode: "M-1", finalUnitPrice: 600, costSnapshot: 400, qty: 1 },
    { itemCode: "I-400", modelCode: "M-2", finalUnitPrice: 400, costSnapshot: 220, qty: 1 },
  ],
};

assert.strictEqual(returns.allocatedNetAmount(order, "I-600"), 420, "A proportional 30% order discount must allocate 180 EGP to the 600 EGP line.");
assert.strictEqual(returns.allocatedNetAmount(order, "I-400"), 280, "The remaining 120 EGP discount must allocate to the 400 EGP line.");
assert.strictEqual(returns.allocatedNetAmount(order, "I-600") + returns.allocatedNetAmount(order, "I-400"), 700);

assert.deepStrictEqual(
  returns.courierPolicy("Refund", 0),
  { customerFee: 100, brandFee: 0, payer: "Customer", label: "Customer pays the representative 100 EGP" },
);
assert.strictEqual(returns.courierPolicy("Exchange", 0).brandFee, 50, "The first completed exchange is paid by Dart.");
assert.strictEqual(returns.courierPolicy("Exchange", 1).customerFee, 50, "Later exchanges are paid directly by the customer.");

const chain = [
  { id: "PENDING", requestType: "Exchange", exchangeChainId: "CHAIN-1", status: "Pending Request" },
  { id: "REJECTED", requestType: "Exchange", exchangeChainId: "CHAIN-1", status: "Rejected" },
  { id: "DONE", requestType: "Exchange", exchangeChainId: "CHAIN-1", status: "Completed", completedAt: "2026-09-05" },
];
assert.strictEqual(returns.completedExchangeCount(chain, "CHAIN-1"), 1, "Only completed exchanges consume the free exchange.");
assert.strictEqual(returns.publicStatus(chain[0]), "Under Review");
assert.strictEqual(returns.publicStatus({ status: "Representative Assigned" }), "Approved");
assert.strictEqual(returns.publicStatus(chain[1]), "Rejected");
assert.strictEqual(returns.publicStatus(chain[2]), "Return Completed");

console.log("PASS return accounting and workflow rules");
