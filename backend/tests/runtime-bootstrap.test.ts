// DART CODE GUIDE | backend/tests/runtime-bootstrap.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createMisconfiguredApplication } from "../src/app.js";

describe("misconfigured production boot", () => {
  it("returns a safe 503 liveness response without exposing field names or values", async () => {
    const app = createMisconfiguredApplication();
    const response = await request(app).get("/api/v1/health/live");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "misconfigured" });
    expect(JSON.stringify(response.body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(response.body)).not.toContain("AUTH_PEPPER");
  });
});
