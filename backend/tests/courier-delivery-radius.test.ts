import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/http/app-error.js";

// Execute the production guard with synthetic distances, without a database mutation.
const source = readFileSync(new URL("../src/modules/commerce/commerce.service.ts", import.meta.url), "utf8");
const start = source.indexOf("        if (hasVerifiedPin) {");
const guard = source.slice(start, source.indexOf('        nextStatus = "Delivered";', start));
function check(distance: number, hasVerifiedPin = true, accuracy: number | null = 5) {
  return runInNewContext(guard, { hasVerifiedPin, distanceKm: () => distance,
    location: {latitude:30, longitude:31,accuracy_meters:accuracy}, destinationLat:30, destinationLng:31, AppError });
}
describe("courier delivery radius", () => {
  it("accepts a verified pin at 499m and exactly 500m", () => {
    expect(() => check(0.499)).not.toThrow();
    expect(() => check(0.5)).not.toThrow();
  });
  it("rejects a verified pin at 501m and 750m on the server", () => {
    expect(() => check(0.501)).toThrow(/500 m/);
    expect(() => check(0.75)).toThrow(/500 m/);
  });
  it("rejects inaccurate or unknown GPS readings at the destination", () => {
    expect(() => check(0, true, 5000)).toThrow(/accuracy/);
    expect(() => check(0, true, null)).toThrow(/accuracy/);
    expect(() => check(0, true, 100)).not.toThrow();
  });
  it("preserves the separate no-pin manual-address flow", () => {
    expect(() => check(50, false)).not.toThrow();
  });
});
