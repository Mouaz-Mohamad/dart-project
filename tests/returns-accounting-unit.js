// DART CODE GUIDE | tests/returns-accounting-unit.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
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

global.DartSiteSettings = {
  get: () => ({ refundCustomerFee: 125, repeatExchangeCustomerFee: 75 }),
};
assert.strictEqual(
  returns.courierPolicy("Refund", 0).customerFee,
  125,
  "Configured refund fee must flow into new return requests.",
);
assert.strictEqual(
  returns.courierPolicy("Exchange", 2).customerFee,
  75,
  "Configured repeat-exchange fee must flow into later exchange requests.",
);
delete global.DartSiteSettings;

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

const completedAt = "2026-09-14T12:00:00.000Z";
const refundRecord = {
  id: "RET-DB-1", returnId: "RET-1", requestType: "Refund", itemCode: "I-600", orderId: "K-1",
  status: returns.FLOW.ON_THE_WAY, pickupStartedAt: "2026-09-14T11:00:00.000Z",
  inspectionStatus: returns.INSPECTION.PENDING,
};
const soldItem = { itemCode: "I-600", status: "Sold", orderId: "K-1", clientId: "DA-1", returnRequestId: "" };
const refundOrder = {
  orderId: "K-1", items: ["I-600"], priceSnapshot: [{ itemCode: "I-600", finalUnitPrice: 420 }],
  totalPrice: 420, amountPaid: 420, amountRefunded: 0, paymentStatus: "Paid", dartCardId: "CARD-1",
  activityLog: [{ action: "DELIVERED" }],
};
const card = { cardId: "CARD-1", purchasedItems: "2", requestedProducts: ["I-600", "I-400"], status: "Active" };
refundRecord.completionSnapshot = returns.captureCompletionSnapshot(refundRecord, soldItem, null, refundOrder, card, completedAt);
soldItem.status = "Return Inspection";
soldItem.returnRequestId = refundRecord.id;
refundOrder.amountRefunded = 420;
refundOrder.paymentStatus = "Refunded";
refundOrder.refundedAt = completedAt;
refundOrder.activityLog.push({ action: "REFUND_PICKUP_COMPLETED" });
card.purchasedItems = "1";
card.requestedProducts = ["I-400"];
refundRecord.status = returns.FLOW.COMPLETED;
refundRecord.completedAt = completedAt;
refundRecord.financialCompletionApplied = true;
refundRecord.dartCardUsageReversed = true;
const refundRollback = returns.rollbackOneStep(refundRecord, {
  items: [soldItem], orders: [refundOrder], cards: [card], damage: [],
}, "2026-09-14T12:05:00.000Z");
assert(refundRollback.ok && refundRollback.step === "Completion", "Completed refund must roll back one real step");
assert.strictEqual(refundRecord.status, returns.FLOW.ON_THE_WAY);
assert.strictEqual(refundRecord.financialCompletionApplied, undefined);
assert.strictEqual(refundRecord.dartCardUsageReversed, undefined);
assert.strictEqual(soldItem.status, "Sold");
assert.strictEqual(refundOrder.amountRefunded, 0);
assert.strictEqual(refundOrder.paymentStatus, "Paid");
assert.strictEqual(card.purchasedItems, "2");
assert.deepStrictEqual(card.requestedProducts, ["I-600", "I-400"]);
assert.strictEqual(refundOrder.activityLog.at(-1).action, "RETURN_COMPLETION_ROLLED_BACK");

const inspectedRecord = {
  id: "RET-DB-2", returnId: "RET-2", requestType: "Refund", itemCode: "I-700", orderId: "K-2",
  isPostDeliveryReturn: true, status: returns.FLOW.COMPLETED, inspectionStatus: returns.INSPECTION.PENDING,
};
const inspectionItem = { itemCode: "I-700", status: "Return Inspection", orderId: "K-2", clientId: "DA-2", returnRequestId: inspectedRecord.id };
const damageRows = [];
inspectedRecord.completionSnapshot = { version: 1, capturedAt: "before-inspection" };
inspectedRecord.inspectionSnapshot = returns.captureInspectionSnapshot(inspectedRecord, inspectionItem, null, damageRows, completedAt);
inspectionItem.status = "Damaged";
const createdDamage = { id: "DMG-1", itemCode: "I-700", returnId: "RET-2", status: "Damaged" };
damageRows.push(createdDamage);
inspectedRecord.inspectionStatus = returns.INSPECTION.DAMAGED;
inspectedRecord.inspectedAt = completedAt;
inspectedRecord.inspectionDamageId = createdDamage.id;
const inspectionRollback = returns.rollbackOneStep(inspectedRecord, {
  items: [inspectionItem], orders: [], cards: [], damage: damageRows,
}, "2026-09-14T12:10:00.000Z");
assert(inspectionRollback.ok && inspectionRollback.step === "Inspection", "Inspection must be reversible independently");
assert.strictEqual(inspectedRecord.status, returns.FLOW.COMPLETED);
assert.strictEqual(inspectedRecord.inspectionStatus, returns.INSPECTION.PENDING);
assert.strictEqual(inspectionItem.status, "Return Inspection");
assert.strictEqual(damageRows.length, 0, "Only the damage entry created by the reversed inspection is removed");
assert.strictEqual(inspectedRecord.completionSnapshot.capturedAt, "before-inspection", "Undoing inspection must preserve the completion snapshot for a possible second rollback");

const approvedExchange = {
  id: "RET-DB-3", returnId: "RET-3", requestType: "Exchange", itemCode: "I-OLD",
  replacementItemCode: "I-NEW", replacementItemId: "NEW-DB", status: returns.FLOW.APPROVED,
};
const heldReplacement = { id: "NEW-DB", itemCode: "I-NEW", status: "Processing/Held", orderId: "K-3", returnRequestId: "RET-DB-3", exchangeChainId: "I-OLD" };
const approvalRollback = returns.rollbackOneStep(approvedExchange, {
  items: [heldReplacement], orders: [], cards: [], damage: [],
}, "2026-09-14T12:15:00.000Z");
assert(approvalRollback.ok && approvedExchange.status === returns.FLOW.PENDING);
assert.strictEqual(heldReplacement.status, "In stock", "Undoing approval releases the held replacement item");
assert.strictEqual(approvedExchange.replacementItemCode, "");

console.log("PASS return accounting and workflow rules");
