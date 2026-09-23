// DART CODE GUIDE | backend/tests/cod-risk.contract.test.ts
// الغرض: يمنع رجوع COD Risk إلى مجرد واجهة؛ الـgate والصلاحيات والسجل يجب أن تبقى خادمية.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/0039_cod_risk_verification.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/commerce/commerce.service.ts", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../src/modules/commerce/commerce.routes.ts", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/modules/settings/site-settings.service.ts", import.meta.url),
  "utf8",
);
const settingsSchema = readFileSync(
  new URL("../src/modules/settings/site-settings.schema.ts", import.meta.url),
  "utf8",
);
const settingsRoutes = readFileSync(
  new URL("../src/modules/settings/site-settings.routes.ts", import.meta.url),
  "utf8",
);
const siteSettingsBrowser = readFileSync(
  new URL("../../Js/dart-site-settings.js", import.meta.url),
  "utf8",
);

describe("COD risk server-authority contract", () => {
  it("persists customer/order risk, verification state, history and a dedicated permission", () => {
    expect(migration).toContain("cod_risk_level");
    expect(migration).toContain("cod_verification_status");
    expect(migration).toContain("CREATE TABLE cod_verification_events");
    expect(migration).toContain("orders.verify_cod");
    expect(migration).toContain('"manualReviewRefusalCount": 2');
    expect(migration).toContain('"refusalWindowDays": 90');
  });

  it("re-checks COD risk on the server and blocks Preparing until verification passes", () => {
    expect(service).toContain("refreshCodRiskForOrder");
    expect(service).toContain('"COD_VERIFICATION_REQUIRED"');
    expect(service).toContain('target === "Preparing"');
    expect(service).toContain('"Not Required", "Verified"');
    expect(service).toContain("refreshActiveCustomerCodRisk");
  });

  it("exposes a permission-gated manual verification endpoint with optimistic locking", () => {
    expect(routes).toContain('"/admin/orders/:orderRef/cod-verification"');
    expect(routes).toContain('requirePermission("orders.verify_cod")');
    expect(routes).toContain("expectedVersion");
    expect(service).toContain("adminCodVerificationAction");
    expect(service).toContain('"ORDER_VERSION_CONFLICT"');
    expect(service).toContain("'COD_VERIFICATION_UPDATED'");
  });

  it("versions COD thresholds independently when Settings changes", () => {
    expect(settings).toContain("codRiskPolicyVersion");
    expect(settings).toContain("nextSettings.codRisk");
  });

  it("keeps COD risk thresholds private to authenticated Staff settings reads", () => {
    expect(settings).toContain("publicSiteSettings(settings)");
    expect(settingsSchema).toContain("const PUBLIC_KEYS");
    expect(settingsSchema).not.toMatch(/PUBLIC_KEYS\s*=\s*\[[\s\S]*?"codRisk"/);
    expect(settingsRoutes).toContain('"/admin/site-settings"');
    expect(settingsRoutes).toContain("await settings.get(true)");
    expect(siteSettingsBrowser).toContain('IS_ADMIN');
    expect(siteSettingsBrowser).toContain('"/api/v1/admin/site-settings"');
  });
});
