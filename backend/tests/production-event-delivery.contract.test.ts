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
const staffManagementRoutes = readFileSync(
  new URL("../src/modules/identity/staff-management.routes.ts", import.meta.url),
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
  it("attempts immediate delivery for customer and representative identity events", () => {
    expect(identityRoutes.match(/outbox\?\.processBatch\(5\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("attempts immediate delivery for checkout and courier workflow events", () => {
    expect(commerceRoutes.match(/outbox\?\.processBatch\(10\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("targets the exact Staff invitation email event", () => {
    expect(staffManagementRoutes).toContain(
      "processBatch(1, `staff-onboarding-code:${invitation.challengeId}`)",
    );
    expect(staffManagementRoutes).toContain("emailDelivery");
  });

  it("keeps Staff onboarding anti-enumeration generic when delivery fails", () => {
    expect(staffOnboardingRoutes).toContain("/admin/auth/onboarding/resend");
    expect(staffOnboardingRoutes).toContain("remains queued");
    expect(staffOnboardingRoutes).not.toContain("WHATSAPP_DELIVERY_FAILED");
  });

  it("dispatches both email and WhatsApp channels from the transactional outbox", () => {
    expect(outboxService).toContain("payload->>'channel' IN ('email','whatsapp')");
    expect(outboxService).toContain("publishEmail");
    expect(outboxService).toContain("publishWhatsApp");
  });
});
