import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: booleanFromString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: z.string().default("http://localhost:4173"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  ALLOW_DEVELOPMENT_SEED: booleanFromString,
  AUTH_PEPPER: z.string().min(32).default("development-only-auth-pepper-change-me"),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("dart_session"),
  SESSION_COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("strict"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EMAIL_OTP_TTL_MINUTES: z.coerce.number().int().min(3).max(30).default(10),
  MFA_ENCRYPTION_KEY: z
    .string()
    .default("ZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5LTMyYnl0ZSE="),
  AUTOMATION_WEBHOOK_URL: z.union([z.url(), z.literal("")]).default(""),
  AUTOMATION_WEBHOOK_SECRET: z.string().default(""),
  OUTBOX_CRON_SECRET: z.string().default(""),
  CRON_SECRET: z.string().default(""),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databasePoolMax: number;
  corsOrigins: string[];
  trustProxyHops: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  allowDevelopmentSeed: boolean;
  authPepper: string;
  sessionCookieName: string;
  sessionCookieSameSite: "strict" | "lax" | "none";
  sessionTtlDays: number;
  emailOtpTtlMinutes: number;
  mfaEncryptionKey: Buffer;
  automationWebhookUrl: string | null;
  automationWebhookSecret: string | null;
  outboxCronSecret: string | null;
  outboxBatchSize: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
  }

  const corsOrigins = parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsed.data.NODE_ENV === "production" && corsOrigins.length === 0) {
    throw new Error("Invalid environment configuration: CORS_ORIGINS");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.ALLOW_DEVELOPMENT_SEED) {
    throw new Error("Invalid environment configuration: development seed cannot run in production");
  }
  const mfaEncryptionKey = Buffer.from(parsed.data.MFA_ENCRYPTION_KEY, "base64");
  if (mfaEncryptionKey.length !== 32) {
    throw new Error("Invalid environment configuration: MFA_ENCRYPTION_KEY");
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.AUTH_PEPPER === "development-only-auth-pepper-change-me"
  ) {
    throw new Error("Invalid environment configuration: AUTH_PEPPER");
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.MFA_ENCRYPTION_KEY === "ZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5LTMyYnl0ZSE="
  ) {
    throw new Error("Invalid environment configuration: MFA_ENCRYPTION_KEY");
  }
  const outboxCronSecret = parsed.data.OUTBOX_CRON_SECRET || parsed.data.CRON_SECRET;
  if (
    parsed.data.NODE_ENV === "production" &&
    (!parsed.data.AUTOMATION_WEBHOOK_URL ||
      parsed.data.AUTOMATION_WEBHOOK_SECRET.length < 32 ||
      outboxCronSecret.length < 32)
  ) {
    throw new Error(
      "Invalid environment configuration: AUTOMATION_WEBHOOK_URL, AUTOMATION_WEBHOOK_SECRET, OUTBOX_CRON_SECRET/CRON_SECRET",
    );
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    databaseSsl: parsed.data.DATABASE_SSL,
    databasePoolMax: parsed.data.DATABASE_POOL_MAX,
    corsOrigins,
    trustProxyHops: parsed.data.TRUST_PROXY_HOPS,
    rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: parsed.data.RATE_LIMIT_MAX,
    logLevel: parsed.data.LOG_LEVEL,
    allowDevelopmentSeed: parsed.data.ALLOW_DEVELOPMENT_SEED,
    authPepper: parsed.data.AUTH_PEPPER,
    sessionCookieName: parsed.data.SESSION_COOKIE_NAME,
    sessionCookieSameSite: parsed.data.SESSION_COOKIE_SAME_SITE,
    sessionTtlDays: parsed.data.SESSION_TTL_DAYS,
    emailOtpTtlMinutes: parsed.data.EMAIL_OTP_TTL_MINUTES,
    mfaEncryptionKey,
    automationWebhookUrl: parsed.data.AUTOMATION_WEBHOOK_URL || null,
    automationWebhookSecret: parsed.data.AUTOMATION_WEBHOOK_SECRET || null,
    outboxCronSecret: outboxCronSecret || null,
    outboxBatchSize: parsed.data.OUTBOX_BATCH_SIZE,
  };
}
