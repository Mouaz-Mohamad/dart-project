import pino, { type Logger } from "pino";
import type { AppConfig } from "./env.js";

export function createLogger(config: Pick<AppConfig, "logLevel" | "nodeEnv">): Logger {
  return pino({
    level: config.logLevel,
    base: {
      service: "dart-backend",
      environment: config.nodeEnv,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "password",
        "token",
        "accessToken",
        "refreshToken",
        "req.body.accessToken",
        "req.body.refreshToken",
        "req.body.credential",
        "body.accessToken",
        "body.refreshToken",
      ],
      censor: "[REDACTED]",
    },
  });
}
