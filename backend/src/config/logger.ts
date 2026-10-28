// DART CODE GUIDE | backend/src/config/logger.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
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
        'req.headers["x-hub-signature-256"]',
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
