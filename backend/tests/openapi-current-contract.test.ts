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
  it("documents immediate customer signup and the unified strong password", async () => {
    const text = await spec();
    expect(text).toContain("Register a customer and create the customer session immediately");
    expect(text).toContain('"201": { $ref: "#/components/responses/Authenticated" }');
    expect(text).toContain("minLength: 12");
    expect(text).not.toContain("Register a customer and queue a six-digit Email OTP");
    expect(text).not.toContain("minLength: 4");
    expect(text).not.toContain("Sessions\\n");
  });

  it("documents the server-authoritative promotions, Dart Card draw and strict Settings surfaces", async () => {
    const text = await spec();
    for (const path of [
      "/admin/promotions:",
      "/admin/promotions/{id}/analytics:",
      "/admin/dart-card/draws/{period}/preview:",
      "/admin/dart-card/draws/{period}/run:",
      "/internal/dart-card/monthly-draw:",
      "/admin/site-settings:",
    ]) expect(text).toContain(path);
    expect(text).toContain("Unknown root keys are rejected by the Zod contract");
    expect(text).toContain("highest purchased piece count");
  });
});
