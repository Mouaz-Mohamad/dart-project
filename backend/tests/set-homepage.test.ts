// DART CODE GUIDE | backend/tests/set-homepage.test.ts
// HTTP validation and CRUD round trips for homepage Set presentation; real auth middleware is retained.
import cookieParser from "cookie-parser";
import express from "express";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../src/middleware/error-handler.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { createSetRouter } from "../src/modules/sets/set.routes.js";
import { SetService } from "../src/modules/sets/set.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";

const input = {
  setId: "SET-CAMPUS", name: "Campus Look", description: "Full Set description",
  shortDescription: "Short homepage copy", showOnHomepage: true, homepageOrder: 4,
  basePriceMinor: 100000, discountPercent: 10, images: ["/Photos/set.webp"],
  components: [{ modelId: "MODEL-1", quantity: 2 }],
};
const config = { sessionCookieName: "dart_session", authPepper: "test-set-homepage-auth-pepper" };
const csrf = "test-csrf";
const sessionId = "123e4567-e89b-12d3-a456-426614174000";
const sessionCookie = `dart_session=${sessionId}.${"a".repeat(43)}`;

function fixture(permissions = ["sets.read", "sets.manage"]) {
  let stored: Record<string, unknown> | null = null;
  const audits: Array<Record<string, unknown>> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM catalog_models")) return { rows: [{
      model_id: "MODEL-1", name: "Shirt", category: "Shirts", description: "Cotton",
      cost_minor: "20000", selling_minor: "65000", active: true, is_archived: false,
      is_deleted: false, size_options: [{ name: "M" }], color_options: [{ name: "Black" }],
    }] };
    if (sql.includes("FROM catalog_set_components")) return { rows: [{ model_id: "MODEL-1", quantity: 2 }] };
    if (sql.includes("INSERT INTO catalog_sets") || sql.includes("UPDATE catalog_sets")) {
      stored = {
        set_id: values[0], name: values[1], description: values[2],
        base_price_minor: String(values[3]), discount_percent: String(values[4]),
        images: JSON.parse(String(values[5])), short_description: values[6],
        show_on_homepage: values[7], homepage_order: values[8],
        active: true, is_archived: false, is_deleted: false,
        version: String(Number(stored?.version || 0) + 1),
        created_at: new Date("2026-10-01"), updated_at: new Date("2026-10-01"),
      };
      return { rows: [stored] };
    }
    if (sql.includes("FROM catalog_sets")) return { rows: stored ? [stored] : [] };
    if (sql.includes("INSERT INTO audit_logs")) {
      audits.push(JSON.parse(String(values.at(-1))));
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  const sets = new SetService(pool);
  const account = {
    userId: "123e4567-e89b-12d3-a456-426614174002", accountType: "staff",
    status: "active", email: "staff@example.com", emailVerified: true,
    mustChangePassword: false, sessionId, sessionFamilyId: sessionId,
    csrfTokenHash: hashCsrfToken(csrf, config.authPepper), mfaRequired: false,
    mfaSatisfied: true, permissions,
  } as AuthenticatedAccount;
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use("/api/v1", createSetRouter(sets, identity, config));
  app.use(createErrorHandler());
  return { app, sets, query, audits, record: () => stored };
}

describe("homepage Set presentation", () => {
  it("persists homepage fields, returns them publicly, and keeps money calculated by the service", async () => {
    const db = fixture();
    const created = await request(db.app).post("/api/v1/admin/sets")
      .set("Cookie", sessionCookie).set("X-CSRF-Token", csrf).send(input).expect(201);
    expect(created.body.set).toMatchObject({
      shortDescription: input.shortDescription, showOnHomepage: true, homepageOrder: 4,
      pricing: { componentsSellingTotalMinor: 130000, finalMinor: 90000 },
    });
    const publicResult = await request(db.app).get("/api/v1/sets/SET-CAMPUS").expect(200);
    expect(publicResult.body.set).toMatchObject({ shortDescription: input.shortDescription, showOnHomepage: true });
    expect(publicResult.body.set.pricing).not.toHaveProperty("costTotalMinor");
    expect(db.audits[0]).toHaveProperty("homepage.showOnHomepage", true);
    expect(db.query.mock.calls.some(([sql]) => /(?:INSERT|UPDATE|DELETE).*inventory_items/s.test(sql))).toBe(false);
  });

  it("updates visibility/order/copy with audit before/after values and preserves them for older clients", async () => {
    const db = fixture();
    await db.sets.createSet("actor", input, "request");
    const updated = await db.sets.updateSet("actor", input.setId, 1, {
      ...input, shortDescription: "Updated short copy", showOnHomepage: false, homepageOrder: 9,
    }, "request");
    expect(updated.set).toMatchObject({ shortDescription: "Updated short copy", showOnHomepage: false, homepageOrder: 9 });
    expect(db.audits[1]).toHaveProperty("homepage.before.showOnHomepage", true);
    expect(db.audits[1]).toHaveProperty("homepage.after.showOnHomepage", false);
    const legacyInput = {
      name: input.name, description: input.description, basePriceMinor: input.basePriceMinor,
      discountPercent: input.discountPercent, images: input.images, components: input.components,
    };
    const legacyUpdate = await db.sets.updateSet("actor", input.setId, 2, legacyInput, "request");
    expect(legacyUpdate.set).toMatchObject({ shortDescription: "Updated short copy", showOnHomepage: false, homepageOrder: 9 });
  });

  it("rejects stale writes without overwriting homepage presentation", async () => {
    const db = fixture();
    await db.sets.createSet("actor", input, "request");
    await expect(db.sets.updateSet("actor", input.setId, 2, {
      ...input, shortDescription: "Stale edit",
    }, "request")).rejects.toMatchObject({ statusCode: 409, code: "SET_VERSION_CONFLICT" });
    expect(db.record()?.short_description).toBe(input.shortDescription);
    expect(db.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });

  it.each([
    { shortDescription: "x".repeat(281) },
    { homepageOrder: -1 }, { homepageOrder: 0.5 }, { homepageOrder: 10000 },
    { showOnHomepage: "true" },
  ])("validates homepage input on the server: %j", async (invalid) => {
    const db = fixture();
    await request(db.app).post("/api/v1/admin/sets")
      .set("Cookie", sessionCookie).set("X-CSRF-Token", csrf)
      .send({ ...input, ...invalid }).expect(422);
    expect(db.record()).toBeNull();
  });

  it("requires a Set image for a visible homepage card", async () => {
    const db = fixture();
    const result = await request(db.app).post("/api/v1/admin/sets")
      .set("Cookie", sessionCookie).set("X-CSRF-Token", csrf)
      .send({ ...input, images: [] }).expect(422);
    expect(result.body.error.code).toBe("SET_HOMEPAGE_IMAGE_REQUIRED");
    expect(db.record()).toBeNull();
  });

  it("denies homepage writes without sets.manage or CSRF", async () => {
    const db = fixture(["sets.read"]);
    await request(db.app).post("/api/v1/admin/sets")
      .set("Cookie", sessionCookie).set("X-CSRF-Token", csrf).send(input).expect(403);
    await request(fixture().app).post("/api/v1/admin/sets")
      .set("Cookie", sessionCookie).send(input).expect(403);
    expect(db.record()).toBeNull();
  });
});
