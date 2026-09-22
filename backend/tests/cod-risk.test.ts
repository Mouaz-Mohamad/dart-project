// DART CODE GUIDE | backend/tests/cod-risk.test.ts
// الغرض: اختبار قواعد COD Risk & Verification الحرجة قبل السماح بمرحلة Preparing.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COD_RISK_POLICY,
  evaluateCodRisk,
  resolveCodRiskPolicy,
} from "../src/modules/commerce/cod-risk.js";

describe("COD risk decision engine", () => {
  it("requires verification for the first order even with a verified phone", () => {
    const result = evaluateCodRisk({
      priorOrderCount: 0,
      refusalsInWindow: 0,
      recentOrderCount: 1,
      verifiedPhone: true,
      orderValueMinor: 60_000,
    });
    expect(result.riskLevel).toBe("Medium");
    expect(result.verificationRequired).toBe(true);
    expect(result.recommendedVerificationStatus).toBe("Required");
    expect(result.riskReasons).toContain("FIRST_ORDER");
  });

  it("keeps a clean returning verified customer low risk", () => {
    const result = evaluateCodRisk({
      priorOrderCount: 3,
      refusalsInWindow: 0,
      recentOrderCount: 1,
      verifiedPhone: true,
      orderValueMinor: 60_000,
    });
    expect(result).toMatchObject({
      riskLevel: "Low",
      riskScore: 0,
      verificationRequired: false,
      recommendedVerificationStatus: "Not Required",
    });
  });

  it("escalates one refusal to stronger verification", () => {
    const result = evaluateCodRisk({
      priorOrderCount: 2,
      refusalsInWindow: 1,
      recentOrderCount: 1,
      verifiedPhone: true,
      orderValueMinor: 60_000,
    });
    expect(result.riskLevel).toBe("High");
    expect(result.verificationRequired).toBe(true);
    expect(result.recommendedVerificationStatus).toBe("Required");
    expect(result.riskReasons).toContain("REFUSAL_HISTORY");
  });

  it("requires manual review after two refusals in the configured window", () => {
    const result = evaluateCodRisk({
      priorOrderCount: 4,
      refusalsInWindow: 2,
      recentOrderCount: 1,
      verifiedPhone: true,
      orderValueMinor: 60_000,
    });
    expect(result.riskLevel).toBe("Restricted");
    expect(result.verificationRequired).toBe(true);
    expect(result.recommendedVerificationStatus).toBe("Manual Review");
    expect(result.riskReasons).toContain("MULTIPLE_REFUSALS_IN_WINDOW");
  });

  it("uses configurable rapid-repeat and order-value thresholds", () => {
    const policy = resolveCodRiskPolicy({
      ...DEFAULT_COD_RISK_POLICY,
      version: 7,
      rapidRepeatOrderCount: 2,
      highOrderValueMinor: 100_000,
    });
    const result = evaluateCodRisk({
      priorOrderCount: 1,
      refusalsInWindow: 0,
      recentOrderCount: 2,
      verifiedPhone: true,
      orderValueMinor: 120_000,
    }, policy);
    expect(policy.version).toBe(7);
    expect(result.riskReasons).toEqual(
      expect.arrayContaining(["RAPID_REPEAT", "HIGH_ORDER_VALUE"]),
    );
    expect(result.verificationRequired).toBe(true);
  });
});
