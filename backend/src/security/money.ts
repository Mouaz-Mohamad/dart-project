// DART CODE GUIDE | backend/src/security/money.ts
// Exact-piastre validation for compatibility APIs that accept pounds.
import { z } from "zod";

// JSON numbers must have an exact decimal representation in piastres.
const preciseMoney = z.number().finite().max(Number.MAX_SAFE_INTEGER / 100).refine(value =>
  /^-?\d+(?:\.\d{1,2})?$/.test(String(value)) && Number.isSafeInteger(Math.round(value * 100)),
  "Money must contain at most two decimal places");
export const moneyPositive = preciseMoney.refine(value => value >= 0.01, "Amount must be at least one piastre");
export const moneyNonNegative = preciseMoney.refine(value => value >= 0, "Amount cannot be negative");
