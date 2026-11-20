import { describe, expect, it } from "vitest";
import { effectiveDatabasePoolMax } from "../src/database/pool.js";

describe("serverless database pool guard", () => {
  it("caps local Vercel pools at two connections", () => {
    expect(effectiveDatabasePoolMax(10, true)).toBe(2);
    expect(effectiveDatabasePoolMax(100, true)).toBe(2);
  });

  it("does not increase deliberately smaller pools", () => {
    expect(effectiveDatabasePoolMax(1, true)).toBe(1);
  });

  it("retains configured capacity outside Vercel", () => {
    expect(effectiveDatabasePoolMax(10, false)).toBe(10);
    expect(effectiveDatabasePoolMax(1, false)).toBe(1);
  });
});
