import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import { CustomerInteractionService } from "../src/modules/commerce/customer-interaction.service.js";
import { reviewSchema } from "../src/modules/commerce/customer-interaction.routes.js";

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

describe("verified customer review input validation", () => {
  it("accepts an empty or omitted optional title, while keeping rating and review validation", () => {
    const values = { rating: 5, review: "Great quality" };
    expect(reviewSchema.safeParse({ ...values, title: "" }).success).toBe(true);
    expect(reviewSchema.safeParse(values).success).toBe(true);
    expect(reviewSchema.safeParse({ ...values, title: "Great fit" }).success).toBe(true);
    expect(reviewSchema.safeParse({ ...values, rating: 6 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...values, review: "x" }).success).toBe(false);
  });
});

describe("customer review submission persistence", () => {
  it("appends unlimited independent reviews without overwriting earlier reviews or visibility", async () => {
    await db.exec(`
      CREATE TABLE users (id text PRIMARY KEY, email text);
      CREATE TABLE customers (user_id text PRIMARY KEY, client_code text, full_name text);
      CREATE TABLE account_phones (id text PRIMARY KEY, user_id text, account_type text,
        phone_display text, is_primary boolean, created_at timestamptz);
      CREATE TABLE orders (customer_user_id text, status text, is_deleted boolean);
      CREATE TABLE notification_records (record_id text PRIMARY KEY, payload jsonb, position integer);
      INSERT INTO users VALUES ('user-1','client@dart.test');
      INSERT INTO customers VALUES ('user-1','DART-01','Dart Customer');
      INSERT INTO account_phones VALUES ('phone-1','user-1','customer','01000000000',true,now());
      INSERT INTO orders VALUES ('user-1','Delivered',false);
      INSERT INTO dashboard_domain_state VALUES ('notifications',1,'[]'::jsonb,NULL,NULL);
    `);
    const query = (sql: string, values: unknown[] = []) => db.query(sql, values);
    const interactions = new CustomerInteractionService({
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    const first = await interactions.submitReview("user-1", {
      rating: 5, title: "", review: "Great fabric",
    }, "first-request");
    const second = await interactions.submitReview("user-1", {
      rating: 4, title: "Second", review: "Fast delivery",
    }, "second-request");
    expect(first.id).not.toBe(second.id);
    const firstRecord = (await service.read("reviews")).data.find(
      (row) => (row as { id: string }).id === first.id,
    ) as Record<string, unknown>;
    expect(firstRecord.title).toBe("Customer feedback");
    expect(firstRecord.source).toBe("Review");
    const state = await service.read("reviews");
    expect(state.data.map((row) => (row as { id: string }).id))
      .toEqual([second.id, first.id, review.id]);
    const moderated = state.data.map((row) => ({
      ...(row as Record<string, unknown>),
      status: (row as { id: string }).id === first.id ? "Active" : (row as { status: string }).status,
    }));
    await service.write("reviews", state.version, moderated, "staff", "moderation-request");
    const third = await interactions.submitReview("user-1", {
      rating: 3, title: "Third", review: "Another independent review",
    }, "third-request");
    const latest = await service.read("reviews");
    expect(latest.data.map((row) => (row as { id: string }).id))
      .toEqual([third.id, second.id, first.id, review.id]);
    expect(latest.data.find((row) => (row as { id: string }).id === first.id))
      .toMatchObject({ status: "Active" });
    expect((await service.publicReviews()).map((row) => (row as { id: string }).id))
      .toEqual([first.id, review.id]);
    expect((await service.read("contacts")).data).toHaveLength(2);
  });
});

describe("public WhatsApp feedback submission", () => {
  it("accepts a guest without an order/account, queues moderation, blocks duplicates and publishes only after approval", async () => {
    await db.exec(`
      CREATE TABLE notification_records (record_id text PRIMARY KEY, payload jsonb, position integer);
      INSERT INTO dashboard_domain_state VALUES ('notifications',1,'[]'::jsonb,NULL,NULL);
    `);
    const query = (sql: string, values: unknown[] = []) => db.query(sql, values);
    const interactions = new CustomerInteractionService({
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    const input = { fullName: "Guest Reviewer", phone1: "01012345678", rating: 5,
      review: "Nice quality", email: "guest@example.com" };
    const saved = await interactions.submitPublicReview(input, "guest-request");
    const rows = await service.read("reviews");
    expect(rows.data[0]).toMatchObject({
      id: saved.id, source: "Public Feedback Link", recordType: "review",
      verifiedPurchase: false, clientId: "-", clientName: "Guest Reviewer",
      status: "Pending", phone1: "01012345678", rating: 5,
    });
    expect((await service.publicReviews()).map((row) => (row as { id: string }).id))
      .not.toContain(saved.id);
    await expect(interactions.submitPublicReview(input, "guest-retry")).rejects
      .toMatchObject({ statusCode: 409 });
    const approved = rows.data.map((row) => ({
      ...(row as Record<string, unknown>),
      status: (row as { id: string }).id === saved.id ? "Active" : (row as { status: string }).status,
    }));
    await service.write("reviews", rows.version, approved, "staff", "approval");
    expect((await service.publicReviews()).map((row) => (row as { id: string }).id))
      .toContain(saved.id);
    expect((await db.query("SELECT * FROM audit_logs WHERE action='PUBLIC_REVIEW_CREATED'")).rows).toHaveLength(1);
  });
});
