// DART CODE GUIDE | backend/tests/dashboard-finance.validation.test.ts
// الغرض: يثبت أن سجلات Finance لا يمكن حفظها بقيم مالية أو تواريخ غير منطقية.
import { describe, expect, it } from "vitest";
import { validateFinanceDomainData } from "../src/modules/dashboard/dashboard-finance.validation.js";

describe("dashboard finance domain validation", () => {
  it("accepts a valid paid inventory acquisition expense", () => {
    const data = validateFinanceDomainData("finance_expenses", [{
      id: "EXP-1",
      date: "2026-09-26",
      category: "Inventory Acquisition",
      status: "Paid",
      amount: 400,
      paidAt: "2026-09-26",
    }]);
    expect(data).toHaveLength(1);
  });

  it("rejects non-positive expenses and paid expenses without a paid date", () => {
    expect(() => validateFinanceDomainData("finance_expenses", [{
      id: "EXP-2",
      date: "2026-09-26",
      category: "Packaging",
      status: "Paid",
      amount: 0,
      paidAt: "",
    }])).toThrow();
  });

  it("rejects inverted budget and goal date ranges", () => {
    expect(() => validateFinanceDomainData("finance_budgets", [{
      id: "BUD-1", name: "Monthly", category: "All", amount: 1000,
      warningPercent: 80, startDate: "2026-09-30", endDate: "2026-09-01",
    }])).toThrow();
    expect(() => validateFinanceDomainData("finance_goals", [{
      id: "GOAL-1", name: "Revenue", metric: "revenue", target: 1000,
      startDate: "2026-09-30", endDate: "2026-09-01", status: "Active",
    }])).toThrow();
  });

  it("rejects invoice overpayment and impossible settlement fees", () => {
    expect(() => validateFinanceDomainData("finance_invoices", [{
      id: "INV-1", number: "INV-1", type: "Supplier",
      issueDate: "2026-09-01", dueDate: "2026-09-30", total: 500, amountPaid: 600,
    }])).toThrow();
    expect(() => validateFinanceDomainData("finance_settlements", [{
      id: "SET-1", orderId: "K-1", settlementDate: "2026-09-26",
      amountReceived: 500, fee: 600, status: "Received",
    }])).toThrow();
  });

  it("rejects marketing clicks above non-zero impressions", () => {
    expect(() => validateFinanceDomainData("finance_marketing", [{
      id: "MKT-1", date: "2026-09-26", channel: "Meta", campaign: "Test",
      spend: 100, impressions: 10, clicks: 11, orders: 1, attributedRevenue: 500,
    }])).toThrow();
  });
});
