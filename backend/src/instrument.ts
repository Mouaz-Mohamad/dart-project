// DART CODE GUIDE | backend/src/instrument.ts
// الغرض: تهيئة Sentry مبكرًا قبل تحميل Express مع منع إرسال PII أو أسرار حساسة.
import * as Sentry from "@sentry/node";
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  type SanitizableSentryEvent,
} from "./modules/monitoring/sentry-scrub.js";

const dsn = process.env.SENTRY_DSN?.trim() ?? "";

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV || "development",
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend(event) {
    return scrubSentryEvent(
      event as unknown as SanitizableSentryEvent,
    ) as unknown as typeof event;
  },
  beforeBreadcrumb(breadcrumb) {
    return scrubSentryBreadcrumb(breadcrumb);
  },
});
