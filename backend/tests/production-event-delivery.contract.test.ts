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

describe("production event delivery contracts", () => {
  it("attempts immediate delivery for customer and representative identity events", () => {
    expect(identityRoutes.match(/outbox\?\.processBatch\(5\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("attempts immediate delivery for checkout and courier workflow events", () => {
    expect(commerceRoutes.match(/outbox\?\.processBatch\(10\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("targets immediate direct delivery for the exact Staff invitation", () => {
    expect(staffManagementRoutes).toContain(
      "processBatch(1, `staff-invited:${invitation.invitationId}`)",
    );
  });

  it("requires confirmed delivery of the exact Staff onboarding OTP event", () => {
    expect(staffOnboardingRoutes).toContain(
      "`staff-onboarding-code:${result.challengeId}`",
    );
    expect(staffOnboardingRoutes).toContain("WHATSAPP_DELIVERY_FAILED");
    expect(staffOnboardingRoutes).toContain("delivery.published !== 1");
  });
});


describe("optional production delivery boundary", () => {
  it("keeps non-critical delivery calls optional without an external workflow engine", () => {
    expect(identityRoutes).toContain("outbox?.processBatch");
    expect(commerceRoutes).toContain("outbox?.processBatch");
  });
});
