import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const catalog = readFileSync(new URL("../../src/storefront/catalog.js", import.meta.url), "utf8");
const staffRoutes = readFileSync(new URL("../src/modules/identity/staff-onboarding.routes.ts", import.meta.url), "utf8");
const cookieNames = readFileSync(new URL("../src/security/account-cookies.ts", import.meta.url), "utf8");

function apiWithCookies(admin: boolean, cookies: string) {
  const start = catalog.indexOf("  async function api(path, options = {}) {");
  const end = catalog.indexOf("  async function syncAdminState()", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const fetch = vi.fn(async (_url: string, _options: Record<string, unknown>) => ({
    ok: true, json: async () => ({ ok: true }),
  }));
  const api = runInNewContext(
    `const API_BASE = "https://example.test"; const IS_ADMIN = ${admin}; let csrfMemory = "";
     ${catalog.slice(start, end)}
     api;`,
    { fetch, document: { cookie: cookies } },
  ) as (path: string, options: Record<string, unknown>) => Promise<unknown>;
  return { api, fetch };
}

describe("catalogue admin CSRF isolation", () => {
  it("matches the actual staff cookie issued at staff login, not the customer cookie", () => {
    expect(cookieNames).toContain('STAFF_CSRF_COOKIE_NAME = "dart_staff_csrf"');
    expect(staffRoutes).toContain("response.cookie(STAFF_CSRF_COOKIE_NAME, session.csrfToken");
    expect(catalog).toContain('const csrfCookieName = IS_ADMIN ? "dart_staff_csrf" : "dart_csrf"');
  });

  it("uses the staff cookie for PATCH when both customer and staff are logged in", async () => {
    const { api, fetch } = apiWithCookies(true, "dart_csrf=customer-token; dart_staff_csrf=staff-token");
    await api("/api/v1/admin/catalog-state", { method: "PATCH", body: { items: [] } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      headers: { "X-CSRF-Token": "staff-token" },
    });
  });

  it("never falls back to the customer cookie for an admin operation", async () => {
    const { api, fetch } = apiWithCookies(true, "dart_csrf=customer-token");
    await api("/api/v1/admin/catalog-state", { method: "PATCH", body: { items: [] } });
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("continues to use the customer cookie for storefront writes", async () => {
    const { api, fetch } = apiWithCookies(false, "dart_staff_csrf=staff-token; dart_csrf=customer-token");
    await api("/api/v1/me", { method: "PATCH", body: { name: "Customer" } });
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      headers: { "X-CSRF-Token": "customer-token" },
    });
  });
});
