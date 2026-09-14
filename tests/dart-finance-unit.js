"use strict";

const assert = require("assert");
const finance = require("../Eye/dart-finance.js");

function range(start, end) {
  return { start: finance.parseDate(start), end: new Date(finance.parseDate(end).setHours(23, 59, 59, 999)) };
}

function baseData(overrides = {}) {
  return {
    orders: [], returns: [], items: [], models: [], customers: [], reviews: [], damage: [], expenses: [], budgets: [], invoices: [], goals: [], marketing: [], settlements: [],
    ...overrides,
  };
}

const empty = finance.calculateSummary(baseData(), range("2026-09-01", "2026-09-30"));
assert.strictEqual(empty.netRevenue, 0, "Empty records must produce zero revenue.");
assert.strictEqual(empty.netProfit, 0, "Empty records must produce zero profit.");
assert.strictEqual(empty.repeatRate, 0, "Empty records must not create a customer rate.");

const deliveredOrder = {
  id: "ORDER-1",
  orderId: "K-1",
  clientId: "DA-1",
  status: "Delivered",
  deliveredAt: "2026-09-02T10:00:00+03:00",
  paymentMethod: "Cash on Delivery",
  paymentStatus: "Unpaid",
  amountRefunded: 0,
  priceSnapshot: [{ itemCode: "I-1", modelCode: "M-1", qty: 1, finalUnitPrice: 1000, costSnapshot: 400 }],
};

const returnedData = baseData({
  orders: [{ ...deliveredOrder, amountRefunded: 1000, refundedAt: "2026-09-05T10:00:00+03:00" }],
  returns: [
    { id: "R-1", orderId: "K-1", itemCode: "I-1", modelId: "M-1", status: "Good", isPostDeliveryReturn: true, refundAmount: 1000, resolvedAt: "2026-09-05T11:00:00+03:00" },
    { id: "R-1-DUPLICATE", orderId: "K-1", itemCode: "I-1", modelId: "M-1", status: "Good", isPostDeliveryReturn: true, refundAmount: 1000, resolvedAt: "2026-09-05T12:00:00+03:00" },
  ],
  expenses: [{ id: "E-1", date: "2026-09-03", amount: 100, status: "Unpaid", category: "Packaging" }],
});
const returnedSummary = finance.calculateSummary(returnedData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(returnedSummary.grossRevenue, 1000);
assert.strictEqual(returnedSummary.refunds, 1000, "Detailed return refunds must not be duplicated by order.amountRefunded.");
assert.strictEqual(returnedSummary.netRevenue, 0);
assert.strictEqual(returnedSummary.netCogs, 0, "A Good return must reverse its immutable COGS snapshot.");
assert.strictEqual(returnedSummary.soldUnits, 0, "Net units sold must subtract completed returns.");
assert.strictEqual(returnedSummary.operatingExpenses, 100, "Unpaid recognized expenses belong in accrual P&L.");
assert.strictEqual(returnedSummary.netProfit, -100);
assert.strictEqual(returnedSummary.cashOut, 1000, "The completed customer refund must be a cash outflow; the unpaid expense must not add another outflow.");

const laterReturnData = baseData({
  orders: [{ ...deliveredOrder, deliveredAt: "2026-08-20", amountRefunded: 1000, refundedAt: "2026-09-05" }],
  returns: [{ id: "R-LATE", orderId: "K-1", itemCode: "I-1", modelId: "M-1", status: "Good", isPostDeliveryReturn: true, refundAmount: 1000, resolvedAt: "2026-09-05" }],
});
const laterReturnSummary = finance.calculateSummary(laterReturnData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(laterReturnSummary.grossRevenue, 0, "An older delivery must not be moved into the return period.");
assert.strictEqual(laterReturnSummary.netRevenue, -1000, "A later-period refund must reduce that later period's revenue.");
assert.strictEqual(laterReturnSummary.netCogs, -400, "A later Good return must reverse COGS in its actual return period.");
assert.strictEqual(laterReturnSummary.netProfit, -600);

const cashData = baseData({
  orders: [{ ...deliveredOrder, paymentStatus: "Unpaid" }],
  expenses: [{ id: "E-2", date: "2026-09-03", paidAt: "2026-09-04", amount: 100, status: "Paid", category: "Packaging" }],
  settlements: [{ id: "S-1", orderId: "K-1", settlementDate: "2026-09-06", amountReceived: 1000, fee: 50, status: "Received" }],
});
const cashSummary = finance.calculateSummary(cashData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(cashSummary.netRevenue, 1000);
assert.strictEqual(cashSummary.netCogs, 400);
assert.strictEqual(cashSummary.codFees, 50);
assert.strictEqual(cashSummary.totalCost, 550);
assert.strictEqual(cashSummary.netProfit, 450);
assert.strictEqual(cashSummary.cashIn, 1000);
assert.strictEqual(cashSummary.cashOut, 150);
assert.strictEqual(cashSummary.netCashFlow, 850);

const paidWithoutSettlement = finance.calculateSummary(baseData({
  orders: [{ ...deliveredOrder, paymentStatus: "Paid", amountPaid: 0, paidAt: "2026-09-02" }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(paidWithoutSettlement.cashIn, 1000, "A paid COD order without a separate receipt record must use its final order amount once.");

const damagedReturnData = baseData({
  orders: [{ ...deliveredOrder, amountRefunded: 1000 }],
  returns: [{ id: "R-2", orderId: "K-1", itemCode: "I-1", modelId: "M-1", status: "Damaged", isPostDeliveryReturn: true, refundAmount: 1000, resolvedAt: "2026-09-05" }],
  damage: [{ id: "D-1", orderId: "K-1", itemCode: "I-1", modelId: "M-1", status: "Damaged", costSnapshot: 400, date: "2026-09-05" }],
});
const damagedReturnSummary = finance.calculateSummary(damagedReturnData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(damagedReturnSummary.netCogs, 400, "Damaged customer returns remain in COGS.");
assert.strictEqual(damagedReturnSummary.damageLoss, 0, "A sold damaged return must not be counted again as pre-sale damage.");
assert.strictEqual(damagedReturnSummary.damageValue, 400, "Damage Value must still show the damaged piece cost even when P&L avoids duplication.");
assert.strictEqual(damagedReturnSummary.netProfit, -400);

const discountedOrder = finance.calculateSummary(baseData({
  orders: [{
    ...deliveredOrder,
    id: "ORDER-DISCOUNT",
    orderId: "K-DISCOUNT",
    finalAmount: 420,
    totalPrice: 600,
    discount: 30,
    orderLevelDiscountAmount: 180,
    priceSnapshot: [{ itemCode: "I-DISCOUNT", modelCode: "M-1", qty: 1, originalUnitPrice: 600, finalUnitPrice: 600, costSnapshot: 400 }],
  }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(discountedOrder.netRevenue, 420, "A 30% order discount must turn a 600 EGP item into 420 EGP selling value.");
assert.strictEqual(discountedOrder.totalCost, 400, "The physical piece keeps its 400 EGP immutable cost.");
assert.strictEqual(discountedOrder.netProfit, 20, "Net profit must be net selling minus cost.");

const priceHistory = finance.calculateSummary(baseData({
  orders: [
    { ...deliveredOrder, id: "PRICE-1", orderId: "K-PRICE-1", finalAmount: 100, deliveredAt: "2026-09-02", priceSnapshot: [{ itemCode: "PRICE-I-1", modelCode: "M-HISTORY", qty: 1, finalUnitPrice: 100, costSnapshot: 50 }] },
    { ...deliveredOrder, id: "PRICE-2", orderId: "K-PRICE-2", finalAmount: 120, deliveredAt: "2026-09-10", priceSnapshot: [{ itemCode: "PRICE-I-2", modelCode: "M-HISTORY", qty: 1, finalUnitPrice: 120, costSnapshot: 50 }] },
  ],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(priceHistory.netRevenue, 220, "Sales at 100 then 120 must aggregate to the historical 220, never 200 or 240.");
assert.strictEqual(priceHistory.netProfit, 120);

const firstExchange = finance.calculateSummary(baseData({
  orders: [{ ...deliveredOrder, finalAmount: 600, priceSnapshot: [{ itemCode: "NEW-I", modelCode: "M-1", qty: 1, finalUnitPrice: 600, costSnapshot: 400 }] }],
  returns: [{ id: "EX-1", returnId: "R-EX-1", orderId: "K-1", itemCode: "OLD-I", requestType: "Exchange", status: "Completed", completedAt: "2026-09-05", inspectionStatus: "Good", brandCourierFee: 50, customerCourierFee: 0, isPostDeliveryReturn: true }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(firstExchange.netRevenue, 600, "An exchange must not reduce selling value.");
assert.strictEqual(firstExchange.netCogs, 400, "A normal exchange keeps one sold-piece cost.");
assert.strictEqual(firstExchange.returnCourierCosts, 50, "The first exchange fee is paid by Dart.");
assert.strictEqual(firstExchange.netProfit, 150);

const laterExchange = finance.calculateSummary(baseData({
  orders: [{ ...deliveredOrder, finalAmount: 600, priceSnapshot: [{ itemCode: "NEWER-I", modelCode: "M-1", qty: 1, finalUnitPrice: 600, costSnapshot: 400 }] }],
  returns: [{ id: "EX-2", returnId: "R-EX-2", orderId: "K-1", itemCode: "NEW-I", requestType: "Exchange", status: "Completed", completedAt: "2026-09-06", inspectionStatus: "Good", brandCourierFee: 0, customerCourierFee: 50, isPostDeliveryReturn: true }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(laterExchange.totalCost, 400, "A customer-paid representative fee must not enter Dart costs.");
assert.strictEqual(laterExchange.cashOut, 0, "A customer-paid representative fee must not enter Dart Cash Flow.");

const exchangeDamage = finance.calculateSummary(baseData({
  orders: [{ ...deliveredOrder, finalAmount: 600, priceSnapshot: [{ itemCode: "EX-REPLACEMENT", modelCode: "M-1", qty: 1, finalUnitPrice: 600, costSnapshot: 400 }] }],
  returns: [{ id: "EX-DMG", returnId: "R-EX-DMG", orderId: "K-1", itemCode: "EX-OLD", requestType: "Exchange", status: "Completed", completedAt: "2026-09-05", inspectionStatus: "Damaged", brandCourierFee: 50, isPostDeliveryReturn: true }],
  damage: [{ id: "D-EX", returnId: "R-EX-DMG", orderId: "K-1", itemCode: "EX-OLD", modelId: "M-1", status: "Damaged", costSnapshot: 400, inspectedAt: "2026-09-06" }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(exchangeDamage.damageLoss, 400, "A damaged exchanged original must be written off once in addition to replacement COGS.");
assert.strictEqual(exchangeDamage.totalCost, 850);

const stockRange = range("2026-09-01", "2026-09-30");
const stockData = baseData({
  models: [{ modelId: "M-STOCK", cost: 999, selling: 600, discount: 0 }],
  items: [
    { id: "STOCK-1", itemCode: "STOCK-1", modelId: "M-STOCK", status: "In stock", costSnapshot: 400, createdAt: "2026-09-03" },
    { id: "STOCK-OLD", itemCode: "STOCK-OLD", modelId: "M-STOCK", status: "In stock", costSnapshot: 350, createdAt: "2026-08-03" },
  ],
});
const stockMetrics = finance.brandMetrics(stockData, stockRange, finance.calculateSummary(stockData, stockRange));
assert.strictEqual(stockMetrics.inStockCost, 400, "In Stock Cost Value must use item-entry cost and the unified period.");
assert.strictEqual(stockMetrics.inStockSelling, 600);

const repeatData = baseData({
  orders: [
    deliveredOrder,
    { ...deliveredOrder, id: "ORDER-2", orderId: "K-2", deliveredAt: "2026-09-08", priceSnapshot: [{ itemCode: "I-2", modelCode: "M-1", qty: 1, finalUnitPrice: 800, costSnapshot: 300 }] },
    { ...deliveredOrder, id: "ORDER-3", orderId: "K-3", clientId: "DA-2", deliveredAt: "2026-09-10", priceSnapshot: [{ itemCode: "I-3", modelCode: "M-2", qty: 1, finalUnitPrice: 700, costSnapshot: 250 }] },
  ],
});
const repeatSummary = finance.calculateSummary(repeatData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(repeatSummary.uniqueCustomers, 2);
assert.strictEqual(repeatSummary.returningCustomers, 1);
assert.strictEqual(repeatSummary.repeatRate, 50);

const modelRows = finance.modelProfitability(repeatData, range("2026-09-01", "2026-09-30"));
assert.strictEqual(modelRows[0].modelCode, "M-1");
assert.strictEqual(modelRows[0].revenue, 1800);
assert.strictEqual(modelRows[0].cogs, 700);
assert.strictEqual(modelRows[0].profit, 1100);

const budgetData = baseData({
  expenses: [{ id: "E-3", date: "2026-09-12", amount: 750, status: "Paid", category: "Marketing" }],
  budgets: [{ id: "B-1", name: "Launch ads", category: "Marketing", amount: 1000, warningPercent: 70, startDate: "2026-09-01", endDate: "2026-09-30" }],
});
const budget = finance.budgetRows(budgetData, range("2026-09-01", "2026-09-30"))[0];
assert.strictEqual(budget.actual, 750);
assert.strictEqual(budget.remaining, 250);
assert.strictEqual(budget.utilization, 75);
assert(finance.operationalAlerts(budgetData, range("2026-09-01", "2026-09-30"), finance.calculateSummary(budgetData, range("2026-09-01", "2026-09-30"))).some((alert) => alert.title.includes("Budget near limit")));

const goalData = baseData({
  orders: [deliveredOrder],
  goals: [{ id: "G-1", name: "First revenue goal", metric: "revenue", target: 2000, startDate: "2026-09-01", endDate: "2026-09-30", status: "Active" }],
});
const goal = finance.goalRows(goalData, range("2026-09-01", "2026-09-30"))[0];
assert.strictEqual(goal.actual, 1000);
assert.strictEqual(goal.progress, 50);
assert.strictEqual(goal.achieved, false);

assert.deepStrictEqual(finance.comparison(0, 0), { text: "— 0%", direction: "flat", percent: 0 });
assert.strictEqual(finance.comparison(100, 0).text, "New", "A zero previous base must never display Infinity.");

const september = finance.periodRange("custom", { start: "2026-09-01", end: "2026-09-10" }, new Date("2026-09-13T12:00:00Z"));
assert.strictEqual(september.previous.start.getDate(), 22);
assert.strictEqual(september.previous.end.getDate(), 31);

const ownerCostScenario = finance.calculateSummary(baseData({
  models: [{ id: "M1", modelId: "M-1", cost: 400 }],
  items: [{ id: "I1", itemCode: "I-1", modelId: "M-1", costSnapshot: 400, createdAt: "2026-09-02", status: "Sold" }],
  orders: [{ ...deliveredOrder, totalPrice: 600, finalAmount: 420, discount: 30, orderLevelDiscountAmount: 180, priceSnapshot: [{ itemCode: "I-1", modelCode: "M-1", qty: 1, originalUnitPrice: 600, finalUnitPrice: 600, costSnapshot: 400 }] }],
}), range("2026-09-01", "2026-09-30"));
assert.strictEqual(ownerCostScenario.netRevenue, 420, "A 30% order discount on 600 EGP must produce 420 EGP total selling.");
assert.strictEqual(ownerCostScenario.physicalItemCost, 400, "Brand cost must include every physical piece added in the period.");
assert.strictEqual(ownerCostScenario.brandTotalCost, 400);
assert.strictEqual(ownerCostScenario.brandNetProfit, 20, "Brand profit must be total selling minus complete Brand cost.");
const customerMetric = finance.brandMetrics(baseData({ customers: [{ id: "C1", clientId: "DA-1", registeredAt: "2026-09-12T10:00:00Z" }] }), range("2026-09-01", "2026-09-30"), finance.calculateSummary(baseData(), range("2026-09-01", "2026-09-30")));
assert.strictEqual(customerMetric.customers, 1, "Customer KPI must recognize the registeredAt field used by dashboard-created customers.");

console.log("Dart finance unit tests passed.");
