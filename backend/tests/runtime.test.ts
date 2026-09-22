// DART CODE GUIDE | backend/tests/runtime.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { describe, expect, it } from "vitest";
import { shouldRunRuntimeMigrations, shouldStartHttpListener } from "../src/config/runtime.js";

describe("HTTP runtime selection", () => {
  it("exports the Express application without opening a listener on Vercel", () => {
    expect(shouldStartHttpListener({ VERCEL: "1" })).toBe(false);
  });

  it("opens the HTTP listener outside Vercel", () => {
    expect(shouldStartHttpListener({})).toBe(true);
  });

  it("never runs schema migrations during Vercel cold starts", () => {
    expect(
      shouldRunRuntimeMigrations({
        VERCEL: "1",
        DART_RUN_RUNTIME_MIGRATIONS: "1",
      }),
    ).toBe(false);
  });

  it("runs runtime migrations only when explicitly enabled outside Vercel", () => {
    expect(shouldRunRuntimeMigrations({})).toBe(false);
    expect(
      shouldRunRuntimeMigrations({ DART_RUN_RUNTIME_MIGRATIONS: "1" }),
    ).toBe(true);
  });
});
