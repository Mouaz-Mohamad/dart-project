// DART CODE GUIDE | backend/tests/openapi-current-contract.test.ts
// الغرض: يمنع رجوع OpenAPI إلى عقود Auth/Rewards القديمة المتعارضة مع الكود الحالي.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const openApiPath = fileURLToPath(new URL("../openapi.yaml", import.meta.url));

async function spec(): Promise<string> {
  return readFile(openApiPath, "utf8");
}

describe("OpenAPI current Dart contracts", () => {
  it("documents immediate customer signup, required Birthday and the simple customer password policy", async () => {
    const text = await spec();
    expect(text).toContain("Register a customer and create the customer session immediately");
    expect(text).toContain('"201": { $ref: "#/components/responses/Authenticated" }');
    expect(text).toContain("CustomerPassword:");
    expect(text).toContain("minLength: 6");
    expect(text).toContain("any character composition");
    expect(text).toContain("required: [name, email, phone1, birthday, password]");
    expect(text).toContain("StrongPassword:");
    expect(text).toContain("minLength: 12");
    expect(text).not.toContain("at least one letter and one number");
    expect(text).not.toContain("Register a customer and queue a six-digit Email OTP");
    expect(text).not.toContain("Sessions\\n");
  });

  it("documents first-party traffic event ingestion and the permissioned Brand traffic report", async () => {
    const text = await spec();
    expect(text).toContain("/analytics/events:");
    expect(text).toContain("/admin/analytics/traffic:");
    expect(text).toContain("TrafficAnalyticsEvent:");
    expect(text).toContain("reservationId:");
    expect(text).toContain("enum: [daily, weekly, monthly, yearly]");
  });

  it("documents Google/Facebook customer completion and the multi-winner Dart Card rule", async () => {
    const text = await spec();
    for (const path of [
      "/auth/social/providers:",
      "/auth/social/{provider}/start:",
      "/auth/social/{provider}/callback:",
      "/auth/social/challenge:",
      "/auth/social/complete:",
      "/admin/promotions:",
      "/admin/promotions/{id}/analytics:",
      "/admin/dart-card/draws/{period}/preview:",
      "/admin/dart-card/draws/{period}/run:",
      "/internal/dart-card/monthly-draw:",
      "/admin/site-settings:",
    ]) expect(text).toContain(path);
    expect(text).toContain("Unknown root keys are rejected by the Zod contract");
    expect(text).toContain("up to three exact-tie winners");
    expect(text).toContain("Password + confirmation + Birthday");
  });
});
