import { describe, expect, it } from "vitest";
import { shouldRunRuntimeMigrations, shouldStartHttpListener } from "../src/config/runtime.js";

describe("HTTP runtime selection", () => {
  it("exports the Express application without opening a listener on Vercel", () => {
    expect(shouldStartHttpListener({ VERCEL: "1" })).toBe(false);
  });

  it("opens the HTTP listener outside Vercel", () => {
    expect(shouldStartHttpListener({})).toBe(true);
  });

  it("runs schema migrations at Vercel cold start only", () => {
    expect(shouldRunRuntimeMigrations({ VERCEL: "1" })).toBe(true);
    expect(shouldRunRuntimeMigrations({})).toBe(false);
  });
});
