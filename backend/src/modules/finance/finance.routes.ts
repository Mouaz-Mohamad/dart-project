// DART CODE GUIDE | backend/src/modules/finance/finance.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { Router } from "express";
import { AppError } from "../../http/app-error.js";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  requireAccountType,
  requireMfa,
  requireAnyPermission,
  requirePermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { FinanceService, FinanceSummary } from "./finance.service.js";

const querySchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .refine((value) => value.start <= value.end, {
    message: "start must be on or before end",
    path: ["end"],
  });


export const FINANCE_SECTION_PERMISSIONS = Object.freeze({
  revenue: "finance.view_revenue",
  cost: "finance.view_cost",
  profit: "finance.view_profit",
  cashflow: "finance.view_cashflow",
  inventory: "finance.view_inventory_value",
  marketing: "finance.view_marketing",
} as const);

type FinanceSection = keyof typeof FINANCE_SECTION_PERMISSIONS;

const exportQuerySchema = querySchema.and(z.object({
  section: z.enum(["revenue", "cost", "profit", "cashflow", "inventory", "marketing"]),
}));

export function financeSummarySection(
  summary: FinanceSummary,
  section: FinanceSection,
): Record<string, unknown> {
  if (section === "revenue") {
    return {
      grossRevenue: summary.grossRevenue,
      refunds: summary.refunds,
      netRevenue: summary.netRevenue,
      deliveredOrders: summary.deliveredOrders,
      grossSoldUnits: summary.grossSoldUnits,
      returnedUnits: summary.returnedUnits,
      soldUnits: summary.soldUnits,
      averageOrderValue: summary.averageOrderValue,
      uniqueCustomers: summary.uniqueCustomers,
      returningCustomers: summary.returningCustomers,
      oneTimeCustomers: summary.oneTimeCustomers,
      orderFrequencyBuckets: summary.orderFrequencyBuckets,
      repeatRate: summary.repeatRate,
    };
  }
  if (section === "cost") {
    return {
      grossCogs: summary.grossCogs,
      cogsReversal: summary.cogsReversal,
      netCogs: summary.netCogs,
      operatingExpenses: summary.operatingExpenses,
      codFees: summary.codFees,
      damageLoss: summary.damageLoss,
      returnCourierCosts: summary.returnCourierCosts,
      deliveryCosts: summary.deliveryCosts,
      totalOperatingExpenses: summary.totalOperatingExpenses,
      totalCost: summary.totalCost,
    };
  }
  if (section === "profit") {
    return {
      grossProfit: summary.grossProfit,
      netProfit: summary.netProfit,
      brandNetProfit: summary.brandNetProfit,
      margin: summary.margin,
      grossMargin: summary.grossMargin,
      marginApplicable: summary.marginApplicable,
    };
  }
  if (section === "cashflow") {
    return {
      cashIn: summary.cashIn,
      cashOut: summary.cashOut,
      netCashFlow: summary.netCashFlow,
      paidExpenseCashOut: summary.paidExpenseCashOut,
      inventoryPurchaseCashOut: summary.inventoryPurchaseCashOut,
      refundCashOut: summary.refundCashOut,
    };
  }
  if (section === "inventory") {
    return {
      physicalItemCost: summary.physicalItemCost,
      incrementalDamage: summary.incrementalDamage,
      damageValue: summary.damageValue,
    };
  }
  return { marketing: summary.marketing };
}

function csvCell(value: unknown): string {
  const text = typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function summarySectionCsv(section: FinanceSection, data: Record<string, unknown>): string {
  return ["Metric,Value", ...Object.entries(data).map(([key, value]) => `${csvCell(key)},${csvCell(value)}`)].join("\n");
}

export function createFinanceRouter(
  finance: FinanceService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper">,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);

  router.get(
    "/admin/finance/summary",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("finance.read"),
    async (request, response) => {
      const query = querySchema.parse(request.query);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({
        start: query.start,
        end: query.end,
        summary: await finance.summary(query.start, query.end),
      });
    },
  );


  for (const [section, permission] of Object.entries(FINANCE_SECTION_PERMISSIONS) as Array<
    [FinanceSection, (typeof FINANCE_SECTION_PERMISSIONS)[FinanceSection]]
  >) {
    router.get(
      `/admin/finance/${section}`,
      signedIn,
      requireAccountType("staff"),
      requireMfa,
      requireAnyPermission("finance.read", permission),
      async (request, response) => {
        const query = querySchema.parse(request.query);
        const summary = await finance.summary(query.start, query.end);
        response.setHeader("Cache-Control", "no-store");
        response.status(200).json({
          start: query.start,
          end: query.end,
          section,
          summary: financeSummarySection(summary, section),
        });
      },
    );
  }

  router.get(
    "/admin/finance/export",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("finance.export"),
    async (request, response) => {
      const query = exportQuerySchema.parse(request.query);
      const requiredView = FINANCE_SECTION_PERMISSIONS[query.section];
      const permissions = request.auth!.permissions;
      if (!permissions.includes("finance.read") && !permissions.includes(requiredView)) {
        throw new AppError(403, "FORBIDDEN", "You do not have permission to export this finance section");
      }
      const summary = await finance.summary(query.start, query.end);
      const selected = financeSummarySection(summary, query.section);
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="dart-finance-${query.section}-${query.start}-${query.end}.csv"`,
      );
      response.status(200).send(`\uFEFF${summarySectionCsv(query.section, selected)}`);
    },
  );

  return router;
}
