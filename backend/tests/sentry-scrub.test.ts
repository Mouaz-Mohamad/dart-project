// DART CODE GUIDE | backend/tests/sentry-scrub.test.ts
// الغرض: يثبت أن مراقبة الأخطاء لا ترسل كلمات مرور أو توكنات أو بيانات تعريف حساسة إلى Sentry.
import { describe, expect, it } from "vitest";
import {
  scrubSentryEvent,
  type SanitizableSentryEvent,
} from "../src/modules/monitoring/sentry-scrub.js";

describe("Sentry sensitive-data scrubbing", () => {
  it("removes request bodies/cookies and redacts common secrets and PII", () => {
    const event: SanitizableSentryEvent = {
      request: {
        data: { password: "super-secret", safe: "value" },
        cookies: { dart_session: "session-secret" },
        headers: {
          authorization: "Bearer abc.def.secret",
          cookie: "dart_session=session-secret",
          "x-request-id": "req-123",
        },
        url: "https://api.example.test/path?token=url-secret&safe=1",
        query_string: { otp: "123456", safe: "1" },
      },
      message: "provider failed for owner@example.com token=message-secret",
      exception: {
        values: [{ value: "OTP=654321 for +201001234567" }],
      },
      breadcrumbs: [
        {
          message: "authorization=breadcrumb-secret",
          data: { apiKey: "key-secret", safe: "visible" },
        },
      ],
      extra: {
        password: "extra-password",
        safe: "visible",
      },
    };

    const result = scrubSentryEvent(event);
    expect(result.request?.data).toBeUndefined();
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers?.authorization).toBe("[REDACTED]");
    expect(result.request?.headers?.cookie).toBe("[REDACTED]");
    expect(result.request?.headers?.["x-request-id"]).toBe("req-123");

    const serialized = JSON.stringify(result);
    for (const sensitiveValue of [
      "super-secret",
      "session-secret",
      "url-secret",
      "123456",
      "654321",
      "owner@example.com",
      "+201001234567",
      "message-secret",
      "breadcrumb-secret",
      "key-secret",
      "extra-password",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
    expect(serialized).toContain("visible");
  });
});
