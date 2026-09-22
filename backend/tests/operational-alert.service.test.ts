// DART CODE GUIDE | backend/tests/operational-alert.service.test.ts
// الغرض: اختبار آلي لتنبيهات الأخطاء التشغيلية، مع منع التسريب والإغراق.
import { describe, expect, it } from "vitest";
import type { EmailMessage, EmailProvider } from "../src/modules/outbox/email-provider.js";
import { OperationalAlertService } from "../src/modules/monitoring/operational-alert.service.js";

class FakeEmailProvider implements EmailProvider {
  public readonly sent: EmailMessage[] = [];

  public configured(): boolean {
    return true;
  }

  public async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe("operational alert service", () => {
  it("sends one sanitized alert and suppresses an identical alert during cooldown", async () => {
    const provider = new FakeEmailProvider();
    const service = new OperationalAlertService(
      provider,
      "alerts@example.com",
      60_000,
    );
    const error = new Error(
      "Checkout failed for alice@example.com phone 201001234567 Bearer super-secret-token",
    );
    const context = {
      source: "request" as const,
      requestId: "req-123",
      method: "POST",
      path: "/api/v1/orders",
    };

    await expect(service.report(error, context)).resolves.toBe(true);
    await expect(service.report(error, context)).resolves.toBe(false);

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe("alerts@example.com");
    expect(provider.sent[0]?.text).toContain("Request ID: req-123");
    expect(provider.sent[0]?.text).not.toContain("alice@example.com");
    expect(provider.sent[0]?.text).not.toContain("201001234567");
    expect(provider.sent[0]?.text).not.toContain("super-secret-token");
  });

  it("stays inactive when email monitoring is not configured", async () => {
    const provider = new FakeEmailProvider();
    const service = new OperationalAlertService(provider, null);

    await expect(
      service.report(new Error("boom"), { source: "database" }),
    ).resolves.toBe(false);
    expect(provider.sent).toHaveLength(0);
  });
});
