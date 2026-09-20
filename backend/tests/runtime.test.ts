import { describe, expect, it } from "vitest";
import { shouldStartHttpListener } from "../src/config/runtime.js";

describe("HTTP runtime selection", () => {
  it("exports the Express application without opening a listener on Vercel", () => {
    expect(shouldStartHttpListener({ VERCEL: "1" })).toBe(false);
  });

  it("opens the HTTP listener outside Vercel", () => {
    expect(shouldStartHttpListener({})).toBe(true);
  });
});
