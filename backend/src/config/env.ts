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
  };
}
