// DART CODE GUIDE | backend/tests/production-event-delivery.contract.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const identityRoutes = readFileSync(
  new URL("../src/modules/identity/identity.routes.ts", import.meta.url),
  "utf8",
);
const commerceRoutes = readFileSync(
  new URL("../src/modules/commerce/commerce.routes.ts", import.meta.url),
  "utf8",
);
const staffOnboardingRoutes = readFileSync(
  new URL("../src/modules/identity/staff-onboarding.routes.ts", import.meta.url),
  "utf8",
);
const outboxService = readFileSync(
  new URL("../src/modules/outbox/outbox.service.ts", import.meta.url),
  "utf8",
);

describe("production event delivery contracts", () => {
  it("attempts immediate delivery for identity events that still require external notification", () => {
    expect(identityRoutes.match(/outbox\?\.processBatch\(5\)/g)?.length).toBeGreaterThanOrEqual(3);
    const registerStart = identityRoutes.indexOf('router.post("/auth/register"');
    const registerEnd = identityRoutes.indexOf('router.post("/auth/verify-email"', registerStart);
    expect(identityRoutes.slice(registerStart, registerEnd)).not.toContain("processBatch");
    expect(identityRoutes.slice(registerStart, registerEnd)).not.toContain("verification_required");
  });

  it("attempts immediate delivery for checkout and courier workflow events", () => {
    expect(commerceRoutes.match(/outbox\?\.processBatch\(10\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("targets the exact Staff email verification event", () => {
    expect(staffOnboardingRoutes).toContain(
      "const eventKey = `staff-email-access-code:${result.challengeId}`",
    );
    expect(staffOnboardingRoutes).toContain("outbox.processBatch(1, eventKey)");
  });

  it("keeps Staff email access anti-enumeration generic when delivery fails", () => {
    expect(staffOnboardingRoutes).toContain("/admin/auth/email/resend");
    expect(staffOnboardingRoutes).toContain("remains queued");
    expect(staffOnboardingRoutes).toContain(
      "If this email is allowed, a verification code has been sent.",
    );
    expect(staffOnboardingRoutes).not.toContain("WHATSAPP_DELIVERY_FAILED");
  });

  it("dispatches both email and WhatsApp channels from the transactional outbox", () => {
    expect(outboxService).toContain("payload->>'channel' IN ('email','whatsapp')");
    expect(outboxService).toContain("publishEmail");
    expect(outboxService).toContain("publishWhatsApp");
  });
});
