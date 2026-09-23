// DART CODE GUIDE | backend/src/modules/monitoring/sentry-scrub.ts
// الغرض: إزالة الأسرار والبيانات الحساسة من أحداث Sentry قبل خروجها من الخادم.
const SENSITIVE_KEY = /(?:authorization|cookie|password|passcode|token|secret|api[-_]?key|otp|mfa|session|credential)/i;
const KEY_VALUE_SECRET = /\b(authorization|cookie|password|passcode|token|secret|api[-_]?key|otp|mfa|session|credential)\b\s*[:=]\s*([^\s,;&]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const EGYPT_PHONE = /\b(?:\+?20|0)?1(?:0|1|2|5)\d{8}\b/g;

export interface SanitizableSentryEvent {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    url?: string;
    query_string?: unknown;
  };
  message?: string;
  exception?: {
    values?: Array<{ value?: string }>;
  };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
  }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(JWT_TOKEN, "[REDACTED_JWT]")
    .replace(KEY_VALUE_SECRET, "$1=[REDACTED]")
    .replace(EMAIL_ADDRESS, "[REDACTED_EMAIL]")
    .replace(EGYPT_PHONE, "[REDACTED_PHONE]");
}

function scrubValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        scrubValue(nestedValue, nestedKey),
      ]),
    );
  }
  return value;
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveText(value),
    ]),
  );
}

function scrubUrl(value: string): string {
  return redactSensitiveText(value).replace(
    /([?&](?:password|passcode|token|secret|api[-_]?key|otp|mfa|session|credential)=)[^&#]*/gi,
    "$1[REDACTED]",
  );
}

export function scrubSentryEvent<T extends SanitizableSentryEvent>(event: T): T {
  if (event.request) {
    event.request.data = undefined;
    event.request.cookies = undefined;
    if (event.request.headers) {
      event.request.headers = scrubHeaders(event.request.headers);
    }
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    event.request.query_string = scrubValue(event.request.query_string);
  }

  if (event.message) event.message = redactSensitiveText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactSensitiveText(exception.value);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = redactSensitiveText(breadcrumb.message);
    if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  return event;
}

export function scrubSentryBreadcrumb<T extends {
  message?: string;
  data?: Record<string, unknown>;
}>(breadcrumb: T): T {
  if (breadcrumb.message) breadcrumb.message = redactSensitiveText(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
  return breadcrumb;
}
