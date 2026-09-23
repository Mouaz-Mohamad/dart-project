// DART CODE GUIDE | backend/src/config/env.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
import { z } from "zod";

export class EnvironmentConfigError extends Error {
  public readonly fields: string[];

  public constructor(fields: string[]) {
    const unique = [...new Set(fields.filter(Boolean))];
    super(`Invalid environment configuration: ${unique.join(", ")}`);
    this.name = "EnvironmentConfigError";
    this.fields = unique;
  }
}

function invalidEnvironment(...fields: string[]): never {
  throw new EnvironmentConfigError(fields);
}

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
  EMAIL_PROVIDER: z.enum(["disabled", "smtp"]).default("disabled"),
  SMTP_HOST: z.string().trim().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: booleanFromString,
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  EMAIL_FROM: z.string().trim().default(""),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(120).default("Dart | for you"),
  MONITORING_ALERT_EMAIL: z.string().trim().default(""),
  MONITORING_ALERT_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(300_000),
  WHATSAPP_CLOUD_API_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).or(z.literal("")).default(""),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().min(2).max(20).default("ar"),
  WHATSAPP_OWNER_PHONE: z.string().default(""),
  WHATSAPP_STAFF_OTP_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).default("dart_staff_otp"),
  WHATSAPP_STAFF_INVITE_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).default("dart_staff_invite"),
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
  emailProvider: "disabled" | "smtp";
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  emailFrom: string | null;
  emailFromName?: string;
  monitoringAlertEmail?: string | null;
  monitoringAlertCooldownMs?: number;
  whatsappAccessToken?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappGraphApiVersion?: string;
  whatsappTemplateLanguage?: string;
  whatsappOwnerPhone?: string | null;
  whatsappStaffOtpTemplate?: string;
  whatsappStaffInviteTemplate?: string;
  outboxCronSecret: string | null;
  outboxBatchSize: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new EnvironmentConfigError(fields);
  }

  const corsOrigins = parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsed.data.NODE_ENV === "production" && corsOrigins.length === 0) {
    invalidEnvironment("CORS_ORIGINS");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.ALLOW_DEVELOPMENT_SEED) {
    invalidEnvironment("ALLOW_DEVELOPMENT_SEED");
  }
  const mfaEncryptionKey = Buffer.from(parsed.data.MFA_ENCRYPTION_KEY, "base64");
  if (mfaEncryptionKey.length !== 32) {
    invalidEnvironment("MFA_ENCRYPTION_KEY");
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.AUTH_PEPPER === "development-only-auth-pepper-change-me"
  ) {
    invalidEnvironment("AUTH_PEPPER");
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.MFA_ENCRYPTION_KEY === "ZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5LTMyYnl0ZSE="
  ) {
    invalidEnvironment("MFA_ENCRYPTION_KEY");
  }

  // Dart Eye Staff/Owner authentication is email-OTP only. A production API
  // without a configured email provider would appear healthy while locking every
  // administrator out, so production must fail closed until SMTP is configured.
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.EMAIL_PROVIDER !== "smtp"
  ) {
    invalidEnvironment("EMAIL_PROVIDER");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_PROVIDER === "smtp") {
    const missingEmailFields = [
      !parsed.data.SMTP_HOST && "SMTP_HOST",
      !parsed.data.SMTP_USER && "SMTP_USER",
      !parsed.data.SMTP_PASS && "SMTP_PASS",
      !parsed.data.EMAIL_FROM && "EMAIL_FROM",
    ].filter((field): field is string => Boolean(field));
    if (missingEmailFields.length) throw new EnvironmentConfigError(missingEmailFields);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.EMAIL_FROM)) {
      invalidEnvironment("EMAIL_FROM");
    }
  }
  if (
    parsed.data.MONITORING_ALERT_EMAIL &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.MONITORING_ALERT_EMAIL)
  ) {
    invalidEnvironment("MONITORING_ALERT_EMAIL");
  }

  const outboxCronSecret = parsed.data.OUTBOX_CRON_SECRET || parsed.data.CRON_SECRET;
  const whatsappOwnerPhone = parsed.data.WHATSAPP_OWNER_PHONE.replace(/\D/g, "");
  if (whatsappOwnerPhone && !/^201(?:0|1|2|5)\d{8}$/.test(whatsappOwnerPhone)) {
    invalidEnvironment("WHATSAPP_OWNER_PHONE");
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
    emailProvider: parsed.data.EMAIL_PROVIDER,
    smtpHost: parsed.data.SMTP_HOST || null,
    smtpPort: parsed.data.SMTP_PORT,
    smtpSecure: parsed.data.SMTP_SECURE,
    smtpUser: parsed.data.SMTP_USER || null,
    smtpPass: parsed.data.SMTP_PASS || null,
    emailFrom: parsed.data.EMAIL_FROM || null,
    emailFromName: parsed.data.EMAIL_FROM_NAME,
    monitoringAlertEmail: parsed.data.MONITORING_ALERT_EMAIL || null,
    monitoringAlertCooldownMs: parsed.data.MONITORING_ALERT_COOLDOWN_MS,
    whatsappAccessToken: parsed.data.WHATSAPP_CLOUD_API_TOKEN || null,
    whatsappPhoneNumberId: parsed.data.WHATSAPP_PHONE_NUMBER_ID || null,
    whatsappGraphApiVersion: parsed.data.WHATSAPP_GRAPH_API_VERSION,
    whatsappTemplateLanguage: parsed.data.WHATSAPP_TEMPLATE_LANGUAGE,
    whatsappOwnerPhone: whatsappOwnerPhone || null,
    whatsappStaffOtpTemplate: parsed.data.WHATSAPP_STAFF_OTP_TEMPLATE,
    whatsappStaffInviteTemplate: parsed.data.WHATSAPP_STAFF_INVITE_TEMPLATE,
    outboxCronSecret: outboxCronSecret || null,
    outboxBatchSize: parsed.data.OUTBOX_BATCH_SIZE,
  };
}
