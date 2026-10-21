import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";

let db: PGlite, service: DashboardStateService;
const review = { id: "review-1", status: "Active", review: "Public review", rating: 5 };
const legacy = { id: "contact-1", recordType: "contact", source: "Contact Us", review: "Private legacy message" };
const contact = { id: "contact-2", review: "Private newer message" };
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE dashboard_domain_state (domain text PRIMARY KEY, version bigint,
    data jsonb, updated_by text, updated_at timestamptz);
    CREATE TABLE audit_logs (actor_type text, actor_id text, action text, entity_type text,
      entity_id text, request_id text, metadata jsonb);`);
  await db.query("INSERT INTO dashboard_domain_state VALUES ('reviews',3,$1::jsonb,NULL,NULL),('contacts',2,$2::jsonb,NULL,NULL)",
    [JSON.stringify([review, legacy]), JSON.stringify([contact])]);
  const query = (sql: string, values: unknown[] = []) => db.query(sql, values);
  service = new DashboardStateService({ query, connect: async () => ({ query, release() {} }) } as unknown as Pool);
}, 20000);
afterEach(async () => { await db?.close(); });

describe("independent reviews and Contact Us projections on actual SQL", () => {
  it("keeps both contact stores out of review reads and public reviews", async () => {
    expect((await service.read("reviews")).data).toEqual([review]);
    expect((await service.publicReviews()).map((row) => (row as { id: string }).id)).toEqual([review.id]);
    const state = await service.read("contacts");
    expect(state.version).toBe(4);
    expect(state.data).toEqual([legacy, { ...contact, recordType: "contact", source: "Contact Us" }]);
    expect((await service.versions()).contacts).toBe(state.version);
  });
  it("review writes preserve unseen contact messages and reject contact injection", async () => {
    const changed = { ...review, status: "Hidden" };
    const result = await service.write("reviews", 3, [changed], "staff", "request-1");
    expect(result.relatedVersions).toEqual({ reviews: 4, contacts: 5 });
    expect((await service.read("reviews")).data).toEqual([changed]);
    expect((await service.read("contacts")).data).toHaveLength(2);
    await expect(service.write("reviews", 4, [legacy], "staff", "request-2")).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.read("contacts")).data).toHaveLength(2);
  });
  it("contact edits consolidate legacy records atomically without editing reviews and audit the change", async () => {
    const changed = { ...legacy, review: "Updated private message" };
    const result = await service.write("contacts", 4, [changed, contact], "staff", "request-1");
    expect(result.version).toBe(6);
    expect(result.relatedVersions).toEqual({ reviews: 4, contacts: 6 });
    expect((await service.read("reviews")).data).toEqual([review]);
    expect((await service.read("contacts")).data).toEqual(result.data);
    expect((await db.query<{ data: unknown[] }>("SELECT data FROM dashboard_domain_state WHERE domain='reviews'")).rows[0]?.data).toEqual([review]);
    expect((await db.query<{ entity_id: string; metadata: { previousVersion: number } }>("SELECT entity_id,metadata FROM audit_logs")).rows)
      .toMatchObject([{ entity_id: "contacts", metadata: { previousVersion: 4 } }]);
    const deleted = await service.write("contacts", 6, [], "staff", "request-2");
    expect(deleted.data).toEqual([]);
    expect((await service.read("reviews")).data).toEqual([review]);
  });
  it("rejects a stale contact snapshot after an incoming message, preserving every row", async () => {
    const incoming = { ...legacy, id: "contact-arrived" };
    await db.query("UPDATE dashboard_domain_state SET data=data || $1::jsonb, version=version+1 WHERE domain='reviews'", [JSON.stringify([incoming])]);
    await expect(service.write("contacts", 4, [], "staff", "request-1")).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.read("contacts")).data).toHaveLength(3);
    expect((await db.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
  });
});
