// DART CODE GUIDE | backend/src/modules/dashboard/dashboard-finance.validation.ts
// الغرض: تحقق خادمي صارم لسجلات Finance قبل حفظها في PostgreSQL.
import { z } from "zod";
import type { DashboardDomain } from "./dashboard-state.service.js";

const idSchema = z.string().trim().min(1).max(200).optional();
const textSchema = z.string().trim().max(500);
const optionalText = textSchema.optional();
const dateSchema = z.iso.date();
const optionalDate = z.union([dateSchema, z.literal("")]).optional();
const moneyPositive = z.number().finite().positive();
const moneyNonNegative = z.number().finite().nonnegative();

const expenseSchema = z.object({
  id: idSchema,
  date: dateSchema,
  category: z.string().trim().min(1).max(120),
  vendor: optionalText,
  description: z.string().max(4000).optional(),
  status: z.enum(["Unpaid", "Paid", "Void"]),
  amount: moneyPositive,
  paidAt: optionalDate,
  paymentMethod: optionalText,
  invoiceNumber: optionalText,
  notes: z.string().max(4000).optional(),
}).passthrough().superRefine((row, context) => {
  if (row.status === "Paid" && !row.paidAt) {
    context.addIssue({
      code: "custom",
      path: ["paidAt"],
      message: "paidAt is required when a finance expense is Paid",
    });
  }
});

const budgetSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  amount: moneyPositive,
  warningPercent: z.number().finite().min(1).max(100),
  startDate: dateSchema,
  endDate: dateSchema,
}).passthrough().refine((row) => row.startDate <= row.endDate, {
  message: "Budget endDate must be on or after startDate",
  path: ["endDate"],
});

const invoiceSchema = z.object({
  id: idSchema,
  number: z.string().trim().min(1).max(200),
  type: z.enum(["Supplier", "Customer"]),
  issueDate: dateSchema,
  dueDate: dateSchema,
  linkedId: optionalText,
  total: moneyPositive,
  amountPaid: moneyNonNegative,
  status: optionalText,
  notes: z.string().max(4000).optional(),
}).passthrough()
  .refine((row) => row.issueDate <= row.dueDate, {
    message: "Invoice dueDate must be on or after issueDate",
    path: ["dueDate"],
  })
  .refine((row) => row.amountPaid <= row.total, {
    message: "Invoice amountPaid cannot exceed total",
    path: ["amountPaid"],
  });

const goalSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(200),
  metric: z.enum([
    "revenue",
    "units",
    "orders",
    "net_profit",
    "repeat_rate",
    "marketing_roas",
    "expense_limit",
  ]),
  target: moneyPositive,
  startDate: dateSchema,
  endDate: dateSchema,
  status: z.enum(["Active", "Paused"]),
}).passthrough().refine((row) => row.startDate <= row.endDate, {
  message: "Goal endDate must be on or after startDate",
  path: ["endDate"],
});

const marketingSchema = z.object({
  id: idSchema,
  date: dateSchema,
  channel: z.string().trim().min(1).max(120),
  campaign: z.string().max(500),
  spend: moneyNonNegative,
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  attributedRevenue: moneyNonNegative,
  linkedExpenseId: optionalText,
}).passthrough().refine(
  (row) => row.impressions === 0 || row.clicks <= row.impressions,
  { message: "Marketing clicks cannot exceed impressions", path: ["clicks"] },
);

const settlementSchema = z.object({
  id: idSchema,
  orderId: z.string().trim().min(1).max(200),
  settlementDate: dateSchema,
  amountReceived: moneyPositive,
  fee: moneyNonNegative,
  reference: optionalText,
  status: z.enum(["Received"]).optional(),
  notes: z.string().max(4000).optional(),
}).passthrough().refine((row) => row.fee <= row.amountReceived, {
  message: "Settlement fee cannot exceed amountReceived",
  path: ["fee"],
});

const FINANCE_DOMAIN_SCHEMAS: Partial<Record<DashboardDomain, z.ZodType>> = {
  finance_expenses: expenseSchema,
  finance_budgets: budgetSchema,
  finance_invoices: invoiceSchema,
  finance_goals: goalSchema,
  finance_marketing: marketingSchema,
  finance_settlements: settlementSchema,
};

export function validateFinanceDomainData(
  domain: DashboardDomain,
  data: unknown[],
): unknown[] {
  const schema = FINANCE_DOMAIN_SCHEMAS[domain];
  if (!schema) return data;
  return z.array(schema).max(20_000).parse(data);
}
