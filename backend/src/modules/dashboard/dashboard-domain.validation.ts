// DART CODE GUIDE | backend/src/modules/dashboard/dashboard-domain.validation.ts
// Regression-safe data and release boundaries.
import { z } from "zod";
import type { DashboardDomain } from "./dashboard-state.service.js";

const finite = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/)]);
const percent = finite.refine(value => Number(value) >= 0 && Number(value) <= 100, "Percentage must be between 0 and 100");
const count = finite.refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 10, "Dart Card usage must be an integer between 0 and 10");
const card = z.object({
  id: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  purchasedItems: count.optional(), reservedItems: count.optional(),
  itemLimit: finite.refine(value => Number(value) === 10, "Dart Card is limited to ten pieces").optional(),
  purchasedLimit: finite.refine(value => Number(value) === 10, "Dart Card is limited to ten pieces").optional(),
  discountPercent: percent.optional(),
}).passthrough().refine(row => Number(row.purchasedItems || 0) + Number(row.reservedItems || 0) <= 10,
  "Used and reserved pieces cannot exceed ten");
const reward = z.object({ discountPercent: percent.optional(), percent: percent.optional() }).passthrough();

export function validateDashboardDomainData(domain: DashboardDomain, data: unknown[]): unknown[] {
  const records = z.array(z.record(z.string(), z.unknown())).max(20000).parse(data);
  if (domain === "cards") return z.array(card).parse(records);
  if (domain === "birthday_rewards") return z.array(reward).parse(records);
  return records;
}
