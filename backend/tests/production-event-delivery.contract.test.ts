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

describe("production event delivery contracts", () => {
  it("attempts immediate delivery for customer and representative identity events", () => {
    expect(identityRoutes.match(/outbox\?\.processBatch\(5\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("attempts immediate delivery for checkout and courier workflow events", () => {
    expect(commerceRoutes.match(/outbox\?\.processBatch\(10\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("attempts immediate direct delivery for Staff invitations", () => {
    expect(staffManagementRoutes).toContain("outbox?.processBatch(5)");
  });
});


describe("optional production delivery boundary", () => {
  it("keeps delivery calls optional instead of making core API startup depend on n8n", () => {
    expect(identityRoutes).toContain("outbox?.processBatch");
    expect(commerceRoutes).toContain("outbox?.processBatch");
  });
});
