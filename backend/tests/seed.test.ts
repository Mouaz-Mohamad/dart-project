// DART CODE GUIDE | backend/tests/seed.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { describe, expect, it } from "vitest";
import { assertDevelopmentSeedAllowed } from "../src/database/seed.js";

describe("development seed guard", () => {
  it("requires an explicit opt-in outside production", () => {
    expect(() => assertDevelopmentSeedAllowed("development", false)).toThrow(
      "ALLOW_DEVELOPMENT_SEED=true",
    );
    expect(() => assertDevelopmentSeedAllowed("development", true)).not.toThrow();
  });

  it("never permits synthetic seed data in production", () => {
    expect(() => assertDevelopmentSeedAllowed("production", true)).toThrow(
      "forbidden in production",
    );
  });
});
