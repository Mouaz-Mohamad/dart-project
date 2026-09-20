import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 4000,
  databaseUrl: "postgresql://unused",
  databaseSsl: false,
  databasePoolMax: 1,
  corsOrigins: ["http://localhost:4173"],
  trustProxyHops: 0,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
  logLevel: "silent",
  allowDevelopmentSeed: false,
  authPepper: "test-auth-pepper-with-at-least-32-characters",
  sessionCookieName: "dart_session",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

function appWith(databasePing: () => Promise<void>) {
  return createApp(config, {
    databasePing,
    logger: pino({ level: "silent" }),
    startedAt: new Date("2026-09-19T00:00:00.000Z"),
    version: "test",
  });
}

describe("health API", () => {
  it("reports liveness without depending on PostgreSQL", async () => {
    const response = await request(appWith(async () => Promise.reject(new Error("down")))).get(
      "/api/v1/health/live",
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("reports readiness only when PostgreSQL responds", async () => {
    const ready = await request(appWith(async () => undefined)).get("/api/v1/health/ready");
    const unavailable = await request(
      appWith(async () => Promise.reject(new Error("database unavailable"))),
    ).get("/api/v1/health/ready");

    expect(ready.status).toBe(200);
    expect(ready.body.checks.database).toBe("up");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.checks.database).toBe("down");
    expect(JSON.stringify(unavailable.body)).not.toContain("database unavailable");
  });

  it("rejects unapproved browser origins", async () => {
    const response = await request(appWith(async () => undefined))
      .get("/api/v1/health/live")
      .set("Origin", "https://attacker.example");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("returns a structured 404 without a stack trace", async () => {
    const response = await request(appWith(async () => undefined)).get("/api/v1/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain("at ");
  });

  it("returns a structured error for malformed JSON", async () => {
    const response = await request(appWith(async () => undefined))
      .post("/api/v1/missing")
      .set("Content-Type", "application/json")
      .send('{"broken":');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.error.requestId).toBeTruthy();
  });
});
