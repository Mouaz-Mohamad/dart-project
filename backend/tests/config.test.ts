// DART CODE GUIDE | backend/tests/config.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

const baseEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://dart:test@localhost:5432/dart_test",
};

const productionEmailEnvironment = {
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "dart@example.com",
  SMTP_PASS: "app-password",
  EMAIL_FROM: "dart@example.com",
  EMAIL_FROM_NAME: "Dart | for you",
};

describe("environment configuration", () => {
  it("loads safe defaults without exposing source values in errors", () => {
    const config = loadConfig(baseEnvironment);
    expect(config.nodeEnv).toBe("test");
    expect(config.port).toBe(4000);
    expect(config.allowDevelopmentSeed).toBe(false);
    expect(config.corsOrigins).toEqual(["http://localhost:4173"]);
    expect(config.sessionCookieSameSite).toBe("strict");
    expect(config.emailFromName).toBe("Dart | for you");
    expect(config.monitoringAlertEmail).toBeNull();
    expect(config.monitoringAlertCooldownMs).toBe(300_000);
  });

  it("accepts an explicit cross-site session-cookie policy", () => {
    const config = loadConfig({
      ...baseEnvironment,
      SESSION_COOKIE_SAME_SITE: "none",
    });
    expect(config.sessionCookieSameSite).toBe("none");
  });

  it("blocks development seed in production using only the field name", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        CORS_ORIGINS: "https://dart.example",
        ALLOW_DEVELOPMENT_SEED: "true",
      }),
    ).toThrow("ALLOW_DEVELOPMENT_SEED");
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

  it("requires SMTP email delivery in production and validates its fields", () => {
    const production = {
      ...baseEnvironment,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://dart.example",
      AUTH_PEPPER: "production-auth-pepper-with-at-least-32-characters",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    };

    expect(() => loadConfig(production)).toThrow("EMAIL_PROVIDER");

    expect(() =>
      loadConfig({
        ...production,
        EMAIL_PROVIDER: "smtp",
      }),
    ).toThrow("SMTP_HOST");

    const smtp = loadConfig({
      ...production,
      ...productionEmailEnvironment,
    });
    expect(smtp.emailProvider).toBe("smtp");
    expect(smtp.smtpPort).toBe(587);
    expect(smtp.emailFromName).toBe("Dart | for you");
    expect(smtp.outboxCronSecret).toBeNull();
  });

  it("validates optional operational monitoring alert settings", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        MONITORING_ALERT_EMAIL: "not-an-email",
      }),
    ).toThrow("MONITORING_ALERT_EMAIL");

    const config = loadConfig({
      ...baseEnvironment,
      MONITORING_ALERT_EMAIL: "alerts@example.com",
      MONITORING_ALERT_COOLDOWN_MS: "60000",
    });
    expect(config.monitoringAlertEmail).toBe("alerts@example.com");
    expect(config.monitoringAlertCooldownMs).toBe(60_000);
  });

  it("validates optional direct WhatsApp settings", () => {
    const production = {
      ...baseEnvironment,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://dart.example",
      AUTH_PEPPER: "production-auth-pepper-with-at-least-32-characters",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      ...productionEmailEnvironment,
    };
    expect(() =>
      loadConfig({
        ...production,
        WHATSAPP_OWNER_PHONE: "12345",
      }),
    ).toThrow("WHATSAPP_OWNER_PHONE");

    const config = loadConfig({
      ...production,
      WHATSAPP_CLOUD_API_TOKEN: "meta-system-user-token",
      WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
      WHATSAPP_OWNER_PHONE: "201001234567",
      CRON_SECRET: "b".repeat(32),
    });
    expect(config.whatsappPhoneNumberId).toBe("123456789012345");
    expect(config.whatsappOwnerPhone).toBe("201001234567");
    expect(config.outboxCronSecret).toBe("b".repeat(32));
  });
});
