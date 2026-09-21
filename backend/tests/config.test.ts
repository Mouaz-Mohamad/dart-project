import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

const baseEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://dart:test@localhost:5432/dart_test",
};

describe("environment configuration", () => {
  it("loads safe defaults without exposing source values in errors", () => {
    const config = loadConfig(baseEnvironment);
    expect(config.nodeEnv).toBe("test");
    expect(config.port).toBe(4000);
    expect(config.allowDevelopmentSeed).toBe(false);
    expect(config.corsOrigins).toEqual(["http://localhost:4173"]);
    expect(config.sessionCookieSameSite).toBe("strict");
  });

  it("accepts an explicit cross-site session-cookie policy", () => {
    const config = loadConfig({
      ...baseEnvironment,
      SESSION_COOKIE_SAME_SITE: "none",
    });
    expect(config.sessionCookieSameSite).toBe("none");
  });

  it("blocks development seed in production", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        CORS_ORIGINS: "https://dart.example",
        ALLOW_DEVELOPMENT_SEED: "true",
      }),
    ).toThrow("development seed cannot run in production");
  });

  it("requires a database URL", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow("DATABASE_URL");
  });

  it("rejects development authentication secrets in production", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        CORS_ORIGINS: "https://dart.example",
      }),
    ).toThrow("AUTH_PEPPER");

    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        CORS_ORIGINS: "https://dart.example",
        AUTH_PEPPER: "production-auth-pepper-with-at-least-32-characters",
      }),
    ).toThrow("MFA_ENCRYPTION_KEY");
  });

  it("keeps production automation disabled when unconfigured and rejects partial secrets", () => {
    const production = {
      ...baseEnvironment,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://dart.example",
      AUTH_PEPPER: "production-auth-pepper-with-at-least-32-characters",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    };
    const disabled = loadConfig(production);
    expect(disabled.automationWebhookUrl).toBeNull();
    expect(disabled.automationWebhookSecret).toBeNull();
    expect(disabled.outboxCronSecret).toBeNull();

    expect(() =>
      loadConfig({
        ...production,
        AUTOMATION_WEBHOOK_URL: "https://automation.example/webhook",
      }),
    ).toThrow("partial automation configuration");

    const config = loadConfig({
      ...production,
      AUTOMATION_WEBHOOK_URL: "https://automation.example/webhook",
      AUTOMATION_WEBHOOK_SECRET: "a".repeat(32),
      CRON_SECRET: "b".repeat(32),
    });
    expect(config.outboxCronSecret).toBe("b".repeat(32));
  });
});
