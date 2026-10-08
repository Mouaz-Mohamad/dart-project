import cookieParser from "cookie-parser";
import express from "express";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../src/middleware/error-handler.js";
import type { CatalogAssetService } from "../src/modules/catalog/catalog.asset.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { createNewsRouter } from "../src/modules/news/news.routes.js";
import { NewsService } from "../src/modules/news/news.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";

const config = { sessionCookieName: "dart_session", authPepper: "test-news-auth-pepper" };
const csrf = "test-news-csrf", actor = "123e4567-e89b-12d3-a456-426614174002";
const cookie = `dart_session=123e4567-e89b-12d3-a456-426614174000.${"a".repeat(43)}`;
const input = { title: "Dart News", excerpt: "Short copy", body: "First paragraph.\n\nSecond paragraph.",
  coverAssetId: "NEWSIMG-cover1234", status: "draft" as const, sortOrder: null };

function fixture(permissions = ["news.read", "news.manage"], accountType = "staff") {
  const records = new Map<string, Record<string, unknown>>(), audits: unknown[] = [];
  let clock = 0;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM catalog_assets WHERE")) return { rows: values[0] === "NEWSIMG-missing1234" ? [] : [{ exists: true }] };
    if (sql.includes("INSERT INTO news_articles")) {
      const date = new Date(Date.UTC(2026, 9, 8, 0, 0, clock++));
      records.set(String(values[0]), { news_id: values[0], title: values[1], excerpt: values[2], body: values[3],
        cover_asset_id: values[4], status: values[5], sort_order: values[6], created_by: values[7],
        is_archived: false, sha256: "a".repeat(64), version: "1", created_at: date, updated_at: date,
        published_at: values[5] === "published" ? date : null });
      return { rows: [] };
    }
    if (sql.includes("UPDATE news_articles")) {
      const row = records.get(String(values[0]))!;
      if (sql.includes("is_archived=$2")) row.is_archived = values[1];
      else {
        if (values[5] === "published" && row.status === "draft") row.published_at = new Date(Date.UTC(2026, 9, 8, 0, 0, clock++));
        Object.assign(row, { title: values[1], excerpt: values[2], body: values[3], cover_asset_id: values[4], status: values[5], sort_order: values[6] });
      }
      row.version = String(Number(row.version) + 1); return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs")) { audits.push(JSON.parse(String(values[4]))); return { rows: [] }; }
    if (sql.includes("FROM news_articles n")) {
      let output = [...records.values()];
      if (sql.includes("n.news_id=$1")) output = output.filter(row => row.news_id === values[0]);
      if (sql.includes("n.status='published' AND NOT n.is_archived")) output = output.filter(row => row.status === "published" && !row.is_archived);
      if (sql.includes("$1='all'")) {
        output = output.filter(row => (values[0] === "all" || row.status === values[0]) &&
          (values[1] === "all" || Boolean(row.is_archived) === (values[1] === "archived")) &&
          `${row.title} ${row.excerpt} ${row.body}`.toLowerCase().includes(String(values[2]).toLowerCase()));
      }
      if (sql.includes("count(*)")) return { rows: [{ total: String(output.length) }] };
      output.sort((a, b) => Number(a.sort_order ?? 10000) - Number(b.sort_order ?? 10000) ||
        Number(b.published_at || b.created_at) - Number(a.published_at || a.created_at));
      if (sql.includes("LIMIT")) output = output.slice(Number(values.at(-1)), Number(values.at(-1)) + Number(values.at(-2)));
      return { rows: output.map(row => ({ ...row })) };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  const news = new NewsService(pool);
  const account = { userId: actor, accountType, permissions, mfaRequired: false, mfaSatisfied: true,
    csrfTokenHash: hashCsrfToken(csrf, config.authPepper) } as AuthenticatedAccount;
  const identity = { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService;
  const assets = { put: vi.fn().mockResolvedValue({ id: "NEWSIMG-asset1234" }) } as unknown as CatalogAssetService;
  const app = express(); app.use(express.json(), cookieParser());
  app.use("/api/v1", createNewsRouter(news, assets, identity, config)); app.use(createErrorHandler());
  return { app, news, records, query, audits, assets };
}
function post(db: ReturnType<typeof fixture>, data: object) {
  return request(db.app).post("/api/v1/admin/news").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(data);
}
describe("News HTTP and server authority", () => {
  it("keeps drafts private, publishes plain text, orders manually, archives and restores with audit", async () => {
    const db = fixture();
    await post(db, { newsId: "NEWS-1", ...input }).expect(201);
    await request(db.app).get("/api/v1/news/NEWS-1").expect(404);
    expect((await request(db.app).get("/api/v1/news")).body.news).toEqual([]);
    const update = await request(db.app).put("/api/v1/admin/news/NEWS-1").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ ...input, status: "published", expectedVersion: 1 }).expect(200);
    expect(update.body.news.version).toBe(2);
    await post(db, { newsId: "NEWS-2", ...input, status: "published" }).expect(201);
    let publicList = await request(db.app).get("/api/v1/news").expect(200);
    expect(publicList.body.news.map((row: { newsId: string }) => row.newsId)).toEqual(["NEWS-2", "NEWS-1"]);
    expect(publicList.body.news[0]).not.toHaveProperty("body");
    expect(publicList.body.news[0]).not.toHaveProperty("status");
    expect(publicList.body.news[0]).not.toHaveProperty("created_by");
    await request(db.app).put("/api/v1/admin/news/NEWS-1").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ ...input, status: "published", sortOrder: 0, expectedVersion: 2 }).expect(200);
    publicList = await request(db.app).get("/api/v1/news").expect(200);
    expect(publicList.body.news[0].newsId).toBe("NEWS-1");
    expect((await request(db.app).get("/api/v1/news/NEWS-1")).body.news.body).toBe(input.body);
    await request(db.app).post("/api/v1/admin/news/NEWS-1/state").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ action: "archive", expectedVersion: 3 }).expect(200);
    await request(db.app).get("/api/v1/news/NEWS-1").expect(404);
    expect((await request(db.app).get("/api/v1/admin/news?archive=archived").set("Cookie", cookie)).body.news).toHaveLength(1);
    await request(db.app).post("/api/v1/admin/news/NEWS-1/state").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ action: "restore", expectedVersion: 4 }).expect(200);
    await request(db.app).get("/api/v1/news/NEWS-1").expect(200);
    expect(db.audits.at(-1)).toMatchObject({ before: { isArchived: true }, after: { isArchived: false } });
    expect(db.query.mock.calls.some(([sql]) => /(?:INSERT|UPDATE|DELETE).*inventory_items/s.test(sql))).toBe(false);
  });

  it("rejects stale edits/archive, duplicate mismatched creates, and safely retries identical creates/states", async () => {
    const db = fixture(); await db.news.save(actor, "NEWS-1", input, null, "r1");
    await db.news.save(actor, "NEWS-1", input, null, "retry"); expect(db.audits).toHaveLength(1);
    await expect(db.news.save(actor, "NEWS-1", { ...input, title: "Different" }, null, "r2")).rejects.toMatchObject({ statusCode: 409 });
    await db.news.save(actor, "NEWS-1", { ...input, title: "Latest" }, 1, "r2");
    await expect(db.news.save(actor, "NEWS-1", input, 1, "r3")).rejects.toMatchObject({ code: "NEWS_VERSION_CONFLICT" });
    await expect(db.news.state(actor, "NEWS-1", "archive", 1, "r4")).rejects.toMatchObject({ code: "NEWS_VERSION_CONFLICT" });
    await db.news.state(actor, "NEWS-1", "archive", 2, "r5");
    await db.news.state(actor, "NEWS-1", "archive", 2, "retry"); expect(db.audits).toHaveLength(3);
    await expect(db.news.save(actor, "NEWS-1", input, 3, "r6")).rejects.toMatchObject({ code: "NEWS_ARCHIVED" });
    expect(db.records.get("NEWS-1")?.title).toBe("Latest");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE OF n"))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });

  it.each([{ permissions: [] }, { permissions: ["news.read"] }, { permissions: ["catalog.manage"] }])("denies writes without News manage: %j", async ({ permissions }) => {
    const db = fixture(permissions); await post(db, { newsId: "NEWS-1", ...input }).expect(403);
    expect(db.records.size).toBe(0);
  });
  it("allows read-only staff to preview drafts but rejects customers, guests and missing CSRF", async () => {
    const db = fixture(["news.read"]); await db.news.save(actor, "NEWS-1", input, null, "r1");
    await request(db.app).get("/api/v1/admin/news/NEWS-1").set("Cookie", cookie).expect(200);
    await request(db.app).get("/api/v1/admin/news").expect(401);
    await request(fixture(["news.manage"], "customer").app).get("/api/v1/admin/news").set("Cookie", cookie).expect(403);
    await request(fixture().app).post("/api/v1/admin/news").set("Cookie", cookie).send({ newsId: "NEWS-1", ...input }).expect(403);
  });
  it.each([{ title: " " }, { body: "" }, { excerpt: "x".repeat(281) }, { sortOrder: -1 },
    { sortOrder: 1.2 }, { sortOrder: 10000 }, { status: "archived" }, { isArchived: false }, { coverAssetId: "https://external/image" }])(
    "validates News fields and rejects unknown input: %j", async invalid => {
      const db = fixture(); await post(db, { newsId: "NEWS-1", ...input, ...invalid }).expect(422); expect(db.records.size).toBe(0);
    });
  it("checks uploaded asset existence, pagination and staff filters", async () => {
    const db = fixture(); await post(db, { newsId: "NEWS-1", ...input, coverAssetId: "NEWSIMG-missing1234" }).expect(422);
    for (let i = 0; i < 3; i++) await db.news.save(actor, `NEWS-${i}`, { ...input, title: `Story ${i}`, status: "published" }, null, "r");
    const list = await request(db.app).get("/api/v1/news?limit=2").expect(200);
    expect(list.body.news).toHaveLength(2); expect(list.body.nextOffset).toBe(2);
    expect((await request(db.app).get("/api/v1/admin/news?q=Story%201&status=published").set("Cookie", cookie)).body.news).toHaveLength(1);
    await request(db.app).get("/api/v1/news?limit=1000").expect(422);
  });
  it("gates News image uploads independently of catalog access and restricts the asset namespace", async () => {
    const db = fixture(["news.manage"]);
    const upload = { assetId: "NEWSIMG-asset1234", originalName: "cover.webp", contentType: "image/webp", base64: "AAAA" };
    await request(db.app).put("/api/v1/admin/news/assets").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(upload).expect(200);
    expect(db.assets.put).toHaveBeenCalledWith({ ...upload, actorId: actor });
    await request(db.app).put("/api/v1/admin/news/assets").set("Cookie", cookie).set("X-CSRF-Token", csrf)
      .send({ ...upload, assetId: "PRODUCT-cover1234" }).expect(422);
  });
});
