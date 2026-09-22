// DART CODE GUIDE | backend/src/modules/commerce/cod-risk.ts
// الغرض: محرك قرار COD خالص وقابل للاختبار؛ الأرقام غير المحددة في الخطة تأتي من Settings وليست Hard-coded Business Rules.

export type CodRiskLevel = "Low" | "Medium" | "High" | "Restricted";
export type CodVerificationStatus =
  | "Not Required"
  | "Required"
  | "Pending"
  | "Verified"
  | "Failed"
  | "Manual Review";

export interface CodRiskPolicy {
  version: number;
  refusalWindowDays: number;
  manualReviewRefusalCount: number;
  rapidRepeatWindowMinutes: number;
  rapidRepeatOrderCount: number;
  highOrderValueMinor: number;
  restrictedOrderValueMinor: number;
  mediumScoreMin: number;
  highScoreMin: number;
  restrictedScoreMin: number;
  requireFirstOrderVerification: boolean;
  requireUnverifiedPhoneVerification: boolean;
}

export interface CodRiskSignals {
  priorOrderCount: number;
  refusalsInWindow: number;
  recentOrderCount: number;
  verifiedPhone: boolean;
  orderValueMinor: number;
}

export interface CodRiskDecision {
  riskLevel: CodRiskLevel;
  riskScore: number;
  riskReasons: string[];
  verificationRequired: boolean;
  recommendedVerificationStatus: CodVerificationStatus;
}

export const DEFAULT_COD_RISK_POLICY: CodRiskPolicy = {
  version: 1,
  refusalWindowDays: 90,
  manualReviewRefusalCount: 2,
  rapidRepeatWindowMinutes: 120,
  rapidRepeatOrderCount: 3,
  highOrderValueMinor: 300_000,
  restrictedOrderValueMinor: 750_000,
  mediumScoreMin: 20,
  highScoreMin: 50,
  restrictedScoreMin: 80,
  requireFirstOrderVerification: true,
  requireUnverifiedPhoneVerification: true,
};

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function resolveCodRiskPolicy(value: unknown): CodRiskPolicy {
  const raw = record(value);
  const mediumScoreMin = integer(raw.mediumScoreMin, DEFAULT_COD_RISK_POLICY.mediumScoreMin, 1, 98);
  const highScoreMin = integer(raw.highScoreMin, DEFAULT_COD_RISK_POLICY.highScoreMin, mediumScoreMin + 1, 99);
  const restrictedScoreMin = integer(
    raw.restrictedScoreMin,
    DEFAULT_COD_RISK_POLICY.restrictedScoreMin,
    highScoreMin + 1,
    100,
  );
  const highOrderValueMinor = integer(
    raw.highOrderValueMinor,
    DEFAULT_COD_RISK_POLICY.highOrderValueMinor,
    0,
    100_000_000,
  );
  const restrictedOrderValueMinor = integer(
    raw.restrictedOrderValueMinor,
    DEFAULT_COD_RISK_POLICY.restrictedOrderValueMinor,
    highOrderValueMinor,
    100_000_000,
  );

  return {
    version: integer(raw.version, DEFAULT_COD_RISK_POLICY.version, 1, 1_000_000),
    refusalWindowDays: integer(raw.refusalWindowDays, 90, 1, 3650),
    manualReviewRefusalCount: integer(raw.manualReviewRefusalCount, 2, 2, 100),
    rapidRepeatWindowMinutes: integer(raw.rapidRepeatWindowMinutes, 120, 1, 10080),
    rapidRepeatOrderCount: integer(raw.rapidRepeatOrderCount, 3, 2, 100),
    highOrderValueMinor,
    restrictedOrderValueMinor,
    mediumScoreMin,
    highScoreMin,
    restrictedScoreMin,
    requireFirstOrderVerification:
      raw.requireFirstOrderVerification !== false,
    requireUnverifiedPhoneVerification:
      raw.requireUnverifiedPhoneVerification !== false,
  };
}

export function evaluateCodRisk(
  signals: CodRiskSignals,
  policy: CodRiskPolicy = DEFAULT_COD_RISK_POLICY,
): CodRiskDecision {
  const priorOrderCount = Math.max(0, Math.floor(signals.priorOrderCount));
  const refusalsInWindow = Math.max(0, Math.floor(signals.refusalsInWindow));
  const recentOrderCount = Math.max(1, Math.floor(signals.recentOrderCount));
  const orderValueMinor = Math.max(0, Math.round(signals.orderValueMinor));
  const firstOrder = priorOrderCount === 0;
  const unverifiedPhone = !signals.verifiedPhone;
  const rapidRepeat = recentOrderCount >= policy.rapidRepeatOrderCount;
  const highOrderValue = orderValueMinor >= policy.highOrderValueMinor;
  const restrictedOrderValue =
    policy.restrictedOrderValueMinor > 0 &&
    orderValueMinor >= policy.restrictedOrderValueMinor;
  const manualReview =
    refusalsInWindow >= policy.manualReviewRefusalCount;

  const reasons: string[] = [];
  let score = 0;
  if (firstOrder) {
    reasons.push("FIRST_ORDER");
    score += 30;
  }
  if (unverifiedPhone) {
    reasons.push("PHONE_NOT_VERIFIED");
    score += 20;
  }
  if (refusalsInWindow === 1) {
    reasons.push("REFUSAL_HISTORY");
    score += 50;
  } else if (refusalsInWindow > 1) {
    reasons.push("MULTIPLE_REFUSALS_IN_WINDOW");
    score += Math.min(100, 50 + ((refusalsInWindow - 1) * 25));
  }
  if (rapidRepeat) {
    reasons.push("RAPID_REPEAT");
    score += 20;
  }
  if (highOrderValue) {
    reasons.push("HIGH_ORDER_VALUE");
    score += 20;
  }
  if (restrictedOrderValue) {
    reasons.push("RESTRICTED_ORDER_VALUE");
    score += 40;
  }
  score = Math.min(100, score);

  let riskLevel: CodRiskLevel = "Low";
  if (manualReview || score >= policy.restrictedScoreMin) {
    riskLevel = "Restricted";
  } else if (refusalsInWindow === 1 || score >= policy.highScoreMin) {
    riskLevel = "High";
  } else if (
    firstOrder ||
    unverifiedPhone ||
    rapidRepeat ||
    highOrderValue ||
    score >= policy.mediumScoreMin
  ) {
    riskLevel = "Medium";
  }

  const verificationRequired =
    manualReview ||
    riskLevel === "Restricted" ||
    (policy.requireFirstOrderVerification && firstOrder) ||
    (policy.requireUnverifiedPhoneVerification && unverifiedPhone) ||
    refusalsInWindow > 0 ||
    rapidRepeat ||
    highOrderValue;

  return {
    riskLevel,
    riskScore: score,
    riskReasons: [...new Set(reasons)],
    verificationRequired,
    recommendedVerificationStatus: manualReview || riskLevel === "Restricted"
      ? "Manual Review"
      : verificationRequired
        ? "Required"
        : "Not Required",
  };
}
