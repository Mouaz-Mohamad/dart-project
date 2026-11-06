import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createCommerceRouter } from "../src/modules/commerce/commerce.routes.js";
import type { CommerceService } from "../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { createErrorHandler } from "../src/middleware/error-handler.js";
function app() {
  const server = express(); server.use(express.json());
  server.use(createCommerceRouter({} as CommerceService, {} as IdentityService,
    { sessionCookieName: "synthetic", authPepper: "synthetic-geography-test-pepper", nodeEnv: "test" }));
  server.use(createErrorHandler()); return server;
}
const path = "/shipping/validate-point";
describe("provider-independent pin validation", () => {
  it.each([
    ["Cairo", 30.05, 31.35, true], ["Alexandria", 31.20, 29.92, true],
    ["Cairo", 31.20, 29.92, false], ["Cairo", 51.50, -0.12, false],
    ["Giza", 30.05, 31.35, false],
  ])("checks %s coordinates %s,%s using local administrative geometry", async (governorate, latitude, longitude, valid) => {
    const response = await request(app()).post(path).send({ governorate, latitude, longitude });
    expect(response.status).toBe(200); expect(response.body).toEqual({ valid });
    expect(response.headers["cache-control"]).toBe("private,no-store");
  });
  it("rejects missing, string, foreign, nonfinite and extra fields", async () => {
    const server = app();
    for (const body of [{}, { governorate: "Cairo", latitude: "30", longitude: 31 },
      { governorate: "London", latitude: 51, longitude: 0 },
      { governorate: "Cairo", latitude: null, longitude: 31 },
      { governorate: "Cairo", latitude: 30, longitude: 31, valid: true }]) {
      expect((await request(server).post(path).send(body)).status).toBe(422);
    }
  });
  it("bounds public geometry checks and never requires a provider or customer-data lookup", async () => {
    const server = app();
    for (let count = 0; count < 20; count++) expect((await request(server).post(path).send({ governorate: "Cairo", latitude: 30.05, longitude: 31.35 })).status).toBe(200);
    const limited = await request(server).post(path).send({ governorate: "Cairo", latitude: 30.05, longitude: 31.35 });
    expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBeTruthy();
  });
});
