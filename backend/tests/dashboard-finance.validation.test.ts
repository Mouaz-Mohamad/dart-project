// DART CODE GUIDE | backend/tests/dashboard-finance.validation.test.ts
// الغرض: يثبت أن سجلات Finance لا تدخل PostgreSQL بقيم أو بنية غير صالحة.
import { describe, expect, it } from "vitest";
import { validateFinanceDomainData } from "../src/modules/dashboard/dashboard-finance.validation.js";

describe("dashboard finance server validation", () => {
  it("accepts a paid Inventory Acquisition expense while preserving only validated fields", () => {
    const [row] = validateFinanceDomainData("finance_expenses", [{
      id: "EXP-1",
      date: "2026-09-26",
      category: "Inventory Acquisition",
      status: "Paid",
      amount: 400,
      paidAt: "2026-09-26",
      createdAt: "2026-09-26T10:00:00.000Z",
      injectedAdminFlag: true,
    }]) as Array<Record<string, unknown>>;

    expect(row).toBeDefined();
    if (!row) throw new Error("Expected validated finance expense row");
    expect(row.category).toBe("Inventory Acquisition");
    expect(row.amount).toBe(400);
    expect(row.injectedAdminFlag).toBeUndefined();
  });

  it("rejects a paid expense without paidAt", () => {
    expect(() => validateFinanceDomainData("finance_expenses", [{
      id: "EXP-2",
      date: "2026-09-26",
      category: "Packaging",
      status: "Paid",
      amount: 100,
    }])).toThrow();
  });

  it("rejects unsupported expense categories and zero money values", () => {
    expect(() => validateFinanceDomainData("finance_expenses", [{
      id: "EXP-3",
      date: "2026-09-26",
      category: "Inventory Acquistion",
      status: "Unpaid",
      amount: 100,
    }])).toThrow();
    expect(() => validateFinanceDomainData("finance_expenses", [{
      id: "EXP-4",
      date: "2026-09-26",
      category: "Packaging",
      status: "Unpaid",
      amount: 0,
    }])).toThrow();
  });

  it("keeps Inventory Acquisition out of operating budget categories", () => {
    expect(() => validateFinanceDomainData("finance_budgets", [{
      id: "BUD-1",
      name: "Inventory budget",
      category: "Inventory Acquisition",
      amount: 1000,
      warningPercent: 80,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    }])).toThrow();
  });

  it("rejects duplicate ids and duplicate invoice numbers case-insensitively", () => {
    expect(() => validateFinanceDomainData("finance_invoices", [
      {
        id: "INV-1", number: "SUP-100", type: "Supplier",
        issueDate: "2026-09-01", dueDate: "2026-09-10", total: 500, amountPaid: 0,
      },
      {
        id: "INV-1", number: "SUP-101", type: "Supplier",
        issueDate: "2026-09-01", dueDate: "2026-09-10", total: 500, amountPaid: 0,
      },
    ])).toThrow();

    expect(() => validateFinanceDomainData("finance_invoices", [
      {
        id: "INV-2", number: "SUP-200", type: "Supplier",
        issueDate: "2026-09-01", dueDate: "2026-09-10", total: 500, amountPaid: 0,
      },
      {
        id: "INV-3", number: "sup-200", type: "Supplier",
        issueDate: "2026-09-01", dueDate: "2026-09-10", total: 500, amountPaid: 0,
      },
    ])).toThrow();
  });

  it("rejects impossible invoice, marketing and settlement values", () => {
    expect(() => validateFinanceDomainData("finance_invoices", [{
      id: "INV-4", number: "SUP-300", type: "Supplier",
      issueDate: "2026-09-10", dueDate: "2026-09-01", total: 500, amountPaid: 600,
    }])).toThrow();

    expect(() => validateFinanceDomainData("finance_marketing", [{
      id: "MKT-1", date: "2026-09-26", channel: "Meta", campaign: "Launch",
      spend: 100, impressions: 100, clicks: 101, orders: 3, attributedRevenue: 500,
    }])).toThrow();

    expect(() => validateFinanceDomainData("finance_settlements", [{
      id: "SET-1", orderId: "ORD-1", settlementDate: "2026-09-26",
      amountReceived: 100, fee: 101, status: "Received",
    }])).toThrow();
  });
});
