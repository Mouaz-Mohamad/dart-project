import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import type { Pool } from "pg";
import pino from "pino";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.js";
import { loadConfig } from "../src/config/env.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { BirthdayMessagingService } from "../src/modules/outbox/birthday-messaging.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { SetService } from "../src/modules/sets/set.service.js";
import type { CustomerInteractionService } from "../src/modules/commerce/customer-interaction.service.js";
import { registerSharedRateLimits } from "../src/security/shared-rate-limit.js";
const databases: PGlite[] = [];
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
afterEach(async () => { vi.unstubAllGlobals(); for (const db of databases.splice(0))
    await db.close(); });
function poolFor(db: PGlite, fail?: (sql: string) => boolean): Pool {
    const query = async (sql: string, values: unknown[] = []) => { if (fail?.(sql))
        throw new Error("Synthetic DB acknowledgement failure"); return db.query(sql, values); };
    return { query, connect: async () => ({ query, release() { } }) } as unknown as Pool;
}
const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused/test", LOG_LEVEL: "silent" });
const csrf = "synthetic-csrf", sessionId = randomUUID(), cookie = `dart_session=${sessionId}.${"a".repeat(43)}`;
function appFor(permissions: string[], pendingMfa = false) {
    const account = { userId: randomUUID(), accountType: "staff", status: "active", email: "staff@example.test", emailVerified: true,
        mustChangePassword: false, sessionId, sessionFamilyId: randomUUID(), csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
        mfaRequired: pendingMfa, mfaSatisfied: !pendingMfa, permissions };
    const snapshot = { version: 1, models: [{ modelId: "M1", name: "Model", cost: 320, selling: 600, legacy: { cost_minor: 32000 } }],
        items: [{ id: "I1", costSnapshot: 300, clientName: "Buyer", phone1: "01000000000", email: "buyer@example.test" }] };
    const catalog = { adminState: vi.fn().mockResolvedValue(snapshot), replaceState: vi.fn().mockResolvedValue(snapshot) };
    const sets = { adminSets: vi.fn().mockResolvedValue({ sets: [{ pricing: { costTotalMinor: 32000, marginVsCostMinor: 28000 }, components: [{ costMinor: 32000 }] }] }), discountSettings: vi.fn().mockResolvedValue({}) };
    return { catalog, snapshot, app: createApp(config, { logger: pino({ level: "silent" }), databasePing: async () => { }, startedAt: new Date(), version: "test",
            identityService: { authenticate: vi.fn().mockResolvedValue(account) } as unknown as IdentityService,
            catalogService: catalog as unknown as CatalogService, setService: sets as unknown as SetService }) };
}
describe("staff response fields and MFA", () => {
    it("redacts acquisition costs and buyers from read-only catalog responses without changing source snapshots", async () => {
        const { app, snapshot } = appFor(["catalog.read"]);
        const response = await request(app).get("/api/v1/admin/catalog-state").set("Cookie", cookie);
        expect(response.status).toBe(200);
        expect(response.body.models[0]).toEqual({ modelId: "M1", name: "Model", selling: 600, legacy: {} });
        expect(response.body.items[0]).toEqual({ id: "I1" });
        expect(snapshot.models[0]!.cost).toBe(320);
    });
    it("applies the same projection to catalog mutation replies", async () => {
        const { app } = appFor(["inventory.manage"]);
        const response = await request(app).patch("/api/v1/admin/catalog-state").set("Cookie", cookie).set("X-CSRF-Token", csrf)
            .send({ expectedVersion: 1, models: [], items: [{ id: "I1" }], recordVersions: { models: {}, items: { I1: 1 } } });
        expect(response.status).toBe(200);
        expect(response.body.models[0]).not.toHaveProperty("cost");
        expect(response.body.items[0]).not.toHaveProperty("email");
    });
    it("preserves explicitly authorized financial and customer fields", async () => {
        const { app } = appFor(["catalog.read", "finance.view_cost", "customers.read"]);
        const response = await request(app).get("/api/v1/admin/catalog-state").set("Cookie", cookie);
        expect(response.body.models[0].cost).toBe(320);
        expect(response.body.items[0].email).toBe("buyer@example.test");
    });
    it("rejects pending MFA on both private set reads but preserves ordinary set access", async () => {
        for (const path of ["/api/v1/admin/sets", "/api/v1/admin/sets/settings"]) {
            const { app } = appFor(["sets.read"], true);
            expect((await request(app).get(path).set("Cookie", cookie)).body.error.code).toBe("MFA_REQUIRED");
        }
        const { app } = appFor(["sets.read"]);
        const response = await request(app).get("/api/v1/admin/sets").set("Cookie", cookie);
        expect(response.status).toBe(200);
        expect(response.body.sets[0].pricing).toEqual({});
    });
    it("preserves a hidden model acquisition cost when a catalog editor changes its name", async () => {
        const queries: Array<{
            sql: string;
            values: unknown[];
        }> = [];
        const old = { model_id: "M1", cost_minor: "32000", version: 1, size_options: [], color_options: [], legacy: {} };
        const query = vi.fn(async (sql: string, values: unknown[] = []) => {
            queries.push({ sql, values });
            if (sql.includes("FROM catalog_models"))
                return { rows: [old] };
            if (sql.includes("SELECT EXISTS"))
                return { rows: [{ due: false }] };
            if (sql.includes("domain_state_versions"))
                return { rows: [{ version: "2" }] };
            return { rows: [] };
        });
        const service = new CatalogService({ query, connect: async () => ({ query, release() { } }) } as unknown as Pool);
        await service.replaceState(1, [{ modelId: "M1", name: "Changed", selling: 600, cost: 0 }], [], "staff", "request", { models: { M1: 1 }, items: {} }, false);
        const insert = queries.find(row => row.sql.includes("INSERT INTO catalog_models"));
        expect(insert!.values[4]).toBe(32000);
    });
});
async function messageDatabase() {
    const db = new PGlite();
    databases.push(db);
    await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
    CREATE TABLE customers(user_id uuid PRIMARY KEY REFERENCES users(id),client_code text,full_name text,birthday date);
    CREATE TABLE account_phones(user_id uuid,account_type text,is_primary boolean,phone_normalized text);
    CREATE TABLE outbox_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregate_type text,aggregate_id text,event_type text,
      payload jsonb,deduplication_key text,status text DEFAULT 'pending',attempts integer DEFAULT 0,available_at timestamptz DEFAULT now(),
      locked_at timestamptz,published_at timestamptz,last_error text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX outbox_events_deduplication_key_unique ON outbox_events(deduplication_key) WHERE deduplication_key IS NOT NULL;
    CREATE TABLE dashboard_domain_state(domain text PRIMARY KEY,version bigint DEFAULT 1,data jsonb DEFAULT '[]',updated_by uuid,updated_at timestamptz);
    INSERT INTO dashboard_domain_state(domain) VALUES('birthday_messages'),('message_queue');
    CREATE TABLE message_records(domain text,record_id text,position bigint,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(domain,record_id));
    CREATE TABLE site_settings(id text,data jsonb);INSERT INTO site_settings VALUES('main','{"birthdayDiscountPercent":30}');
    CREATE TABLE audit_logs(actor_type text,actor_id uuid,action text,entity_type text,entity_id text,request_id text,old_values jsonb,new_values jsonb,metadata jsonb);
    CREATE TABLE orders(id uuid PRIMARY KEY,order_code text,customer_user_id uuid,status text,delivered_at timestamptz,is_deleted boolean DEFAULT false);`);
    await db.exec(await readFile(new URL("../migrations/0061_delivery_safety_and_birthday_consent.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../migrations/0066_whatsapp_delivery_status.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../migrations/0067_whatsapp_automations.sql", import.meta.url), "utf8"));
    return db;
}
const deliveryConfig = { whatsappSendEnabled: true, whatsappAccessToken: "synthetic-nonsecret", whatsappPhoneNumberId: "123456789", whatsappGraphApiVersion: "v26.0",
    whatsappTemplateLanguage: "ar", outboxBatchSize: 5, mfaEncryptionKey: Buffer.alloc(32, 7) };
function allowedWhatsAppClock() { const date = new Date(); date.setUTCHours(12, 0, 0, 0); return date; }
async function event(db: PGlite) {
    const id = randomUUID();
    await db.query(`INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,deduplication_key)
    VALUES($1::uuid,'synthetic','synthetic','SYNTHETIC',$2::jsonb,$1::text)`, [id, JSON.stringify({ channel: "whatsapp", to: "201000000000", template: "synthetic" })]);
    return id;
}
function accepted() { return new Response(JSON.stringify({ messages: [{ id: "synthetic-wamid" }] }), { status: 200 }); }
describe("durable external delivery outcomes on PostgreSQL SQL", () => {
    it("does not resend after provider acceptance followed by a database acknowledgement failure", async () => {
        const db = await messageDatabase();
        await event(db);
        let fail = true;
        const pool = poolFor(db, sql => { if (fail && sql.includes("WITH acknowledged")) {
            fail = false;
            return true;
        } return false; });
        const fetch = vi.fn(async () => accepted());
        vi.stubGlobal("fetch", fetch);
        const service = new OutboxService(pool, deliveryConfig, null, null, allowedWhatsAppClock);
        expect(await service.processBatch(5)).toMatchObject({ claimed: 1, published: 0, failed: 0, uncertain: 1 });
        expect(await service.processBatch(5)).toMatchObject({ claimed: 0 });
        expect(fetch).toHaveBeenCalledOnce();
        expect((await db.query("SELECT state,provider_message_id FROM outbox_delivery_attempts")).rows).toMatchObject([{ state: "accepted", provider_message_id: "synthetic-wamid" }]);
        expect((await service.recentEvents())[0]).toMatchObject({ status: "accepted", providerMessageId: "synthetic-wamid", recipient: "***0000" });
    });
    it("quarantines an ambiguous timeout instead of paying for a second send", async () => {
        const db = await messageDatabase();
        await event(db);
        const fetch = vi.fn(async () => { throw new Error("Synthetic timeout after request write"); });
        vi.stubGlobal("fetch", fetch);
        const service = new OutboxService(poolFor(db), deliveryConfig, null, null, allowedWhatsAppClock);
        expect(await service.processBatch(1)).toMatchObject({ uncertain: 1, failed: 0 });
        await db.exec("UPDATE outbox_events SET available_at=now()-interval '1 hour'");
        expect((await service.processBatch(1)).claimed).toBe(0);
        expect(fetch).toHaveBeenCalledOnce();
    });
    it("retries a definite rate-limit rejection and stores the accepted provider identity", async () => {
        const db = await messageDatabase();
        await event(db);
        const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 429 })).mockImplementationOnce(async () => accepted());
        vi.stubGlobal("fetch", fetch);
        const service = new OutboxService(poolFor(db), deliveryConfig, null, null, allowedWhatsAppClock);
        expect(await service.processBatch(1)).toMatchObject({ failed: 1, published: 0 });
        await db.exec("UPDATE outbox_events SET available_at=now()-interval '1 hour'");
        expect(await service.processBatch(1)).toMatchObject({ published: 1, failed: 0 });
        expect((await service.processBatch(1)).claimed).toBe(0);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it("quarantines an expired executing lease and exposes it in queue health", async () => {
        const db = await messageDatabase(), id = await event(db);
        await db.query("INSERT INTO outbox_delivery_attempts(id,event_id,state,updated_at) VALUES($1,$2,'executing',now()-interval '10 minutes')", [randomUUID(), id]);
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const service = new OutboxService(poolFor(db), deliveryConfig, null, null, allowedWhatsAppClock);
        expect((await service.processBatch(1)).claimed).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
        expect(await service.health()).toMatchObject({ uncertain: 1, pending: 0 });
    });
    it("records permanent provider rejection once without blocking other pending events", async () => {
        const db = await messageDatabase();
        await event(db);
        await event(db);
        const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 400 })).mockImplementation(async () => accepted());
        vi.stubGlobal("fetch", fetch);
        const service = new OutboxService(poolFor(db), deliveryConfig, null, null, allowedWhatsAppClock);
        expect(await service.processBatch(2)).toMatchObject({ claimed: 2, published: 1, terminal: 1, failed: 0 });
        expect((await service.processBatch(2)).claimed).toBe(0);
    });
});
async function birthdayCustomer(db: PGlite) {
    const id = randomUUID();
    const today = (await db.query<{
        today: string;
    }>("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS today")).rows[0]!.today;
    await db.query("INSERT INTO users VALUES($1,'active',NULL)", [id]);
    await db.query("INSERT INTO customers VALUES($1,'SYN-C1','Synthetic',$2::date)", [id, `2000-${today.slice(5)}`]);
    await db.query("INSERT INTO account_phones VALUES($1,'customer',true,'201000000000')", [id]);
    return { id, today, actor: randomUUID() };
}
describe("birthday command and explicit opt-in", () => {
    it("refuses missing configuration and consent without inventing a queued message", async () => {
        const db = await messageDatabase(), customer = await birthdayCustomer(db);
        await expect(new BirthdayMessagingService(poolFor(db), "").queue([customer.id], customer.today, customer.actor, "request"))
            .rejects.toMatchObject({ code: "BIRTHDAY_TEMPLATE_NOT_CONFIGURED" });
        const service = new BirthdayMessagingService(poolFor(db), "synthetic_birthday");
        expect(await service.preference(customer.id)).toMatchObject({ birthdayMarketing: false });
        await expect(service.queue([customer.id], customer.today, customer.actor, "request")).rejects.toMatchObject({ code: "BIRTHDAY_RECIPIENTS_NOT_ELIGIBLE" });
        expect((await db.query("SELECT * FROM outbox_events")).rows).toHaveLength(0);
    });
    it("atomically creates one event and two projections, deduplicates, and suppresses after opt-out", async () => {
        const db = await messageDatabase(), customer = await birthdayCustomer(db), pool = poolFor(db);
        const service = new BirthdayMessagingService(pool, "synthetic_birthday");
        await service.setPreference(customer.id, true, "consent");
        expect(await service.queue([customer.id], customer.today, customer.actor, "request")).toMatchObject({ queued: 1, alreadyQueued: 0 });
        expect(await service.queue([customer.id], customer.today, customer.actor, "retry")).toMatchObject({ queued: 0, alreadyQueued: 1 });
        expect((await db.query("SELECT * FROM message_records")).rows).toHaveLength(2);
        await service.setPreference(customer.id, false, "opt-out");
        await db.exec("UPDATE outbox_events SET available_at=now()-interval '1 minute'");
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        expect(await new OutboxService(pool, deliveryConfig, null, null, allowedWhatsAppClock).processBatch(5)).toMatchObject({ published: 1 });
        expect(fetch).not.toHaveBeenCalled();
        expect((await db.query("SELECT state FROM outbox_delivery_attempts")).rows).toMatchObject([{ state: "suppressed" }]);
        expect((await new DashboardStateService(pool).read("birthday_messages")).data[0]).toMatchObject({ status: "Suppressed" });
    });
    it("rolls back the event when either projection fails", async () => {
        const db = await messageDatabase(), customer = await birthdayCustomer(db), service = new BirthdayMessagingService(poolFor(db), "synthetic_birthday");
        await service.setPreference(customer.id, true, "consent");
        const broken = new BirthdayMessagingService(poolFor(db, sql => sql.includes("INSERT INTO message_records")), "synthetic_birthday");
        await expect(broken.queue([customer.id], customer.today, customer.actor, "request")).rejects.toThrow("Synthetic DB");
        expect((await db.query("SELECT * FROM outbox_events")).rows).toHaveLength(0);
        expect((await db.query("SELECT * FROM message_records")).rows).toHaveLength(0);
    });
});
describe("shared route counters", () => {
    function apps(max = 100) {
        const counters = new Map<string, number>();
        const query = vi.fn(async (_sql: string, values: unknown[]) => {
            const key = `${values[0]}:${String(values[1])}`, hits = (counters.get(key) || 0) + 1;
            counters.set(key, hits);
            return { rows: [{ hits: String(hits), expires_at: new Date(Date.now() + 60000) }] };
        });
        const pool = { query } as unknown as Pool;
        const instances = [0, 1].map(() => {
            const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused/test", RATE_LIMIT_MAX: String(max) });
            registerSharedRateLimits(cfg, pool, cfg.authPepper);
            return createApp(cfg, { logger: pino({ level: "silent" }), databasePing: async () => { }, startedAt: new Date(), version: "test",
                identityService: {} as IdentityService, customerInteractionService: { submitContact: async () => ({ ok: true }) } as unknown as CustomerInteractionService });
        });
        return { instances, query };
    }
    it("shares the application limit across instances and leaves liveness independent", async () => {
        const { instances } = apps(2);
        await request(instances[0]!).get("/api/v1/health/ready").expect(200);
        await request(instances[1]!).get("/api/v1/health/ready").expect(200);
        await request(instances[0]!).get("/api/v1/health/ready").expect(429);
        await request(instances[1]!).get("/api/v1/health/live").expect(200);
    });
    it("shares Contact Us limits between instances instead of resetting them on each process", async () => {
        const { instances, query } = apps();
        const contact = { fullName: "Synthetic", email: "synthetic@example.test", phone1: "01000000000", message: "Synthetic test" };
        for (let i = 0; i < 8; i++)
            await request(instances[i % 2]!).post("/api/v1/contact").send(contact).expect(201);
        await request(instances[0]!).post("/api/v1/contact").send(contact).expect(429);
        expect(query.mock.calls.some(([, values]) => values[0] === "contact")).toBe(true);
    });
});
describe("birthday action browser behavior", () => {
    it("prevents a double click, displays failure, and allows a retry without writing a fake queue", async () => {
        const source = await readFile(new URL("../../Eye/dart.js", import.meta.url), "utf8");
        const action = source.split("/* BEGIN Brand — birthday message queue action */")[1]!.split("/* END Brand — birthday message queue action */")[0]!;
        let click: () => Promise<void> = async () => { }, reject: (error: Error) => void = () => { };
        const button = { dataset: {} as Record<string, string>, disabled: false, addEventListener: (_name: string, handler: () => Promise<void>) => { click = handler; } };
        const pending = new Promise((_resolve, no) => { reject = no; });
        const api = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ queued: 1, alreadyQueued: 0, skipped: [] });
        const hydrate = vi.fn().mockResolvedValue(undefined), alert = vi.fn();
        vm.runInNewContext(`${action}\nsetupBirthdayMessageActions();`, {
            window: { DartAdminApi: { request: api }, DartAdminAccess: { can: () => false }, DartDomainState: { hydrateDomain: hydrate }, DartDialog: { alert } },
            document: { getElementById: () => button, querySelectorAll: () => [{ closest: () => ({ dataset: { clientId: "C1", birthdayDate: "2026-10-22" } }) }] },
            renderBirthdayWidget: () => { button.disabled = false; },
        });
        const first = click();
        await click();
        expect(api).toHaveBeenCalledOnce();
        reject(new Error("Synthetic provider unavailable"));
        await first;
        expect(hydrate).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith("Synthetic provider unavailable");
        expect(button.dataset.saving).toBeUndefined();
        await click();
        expect(api).toHaveBeenCalledTimes(2);
        expect(hydrate).toHaveBeenCalledTimes(2);
    });
});
describe("return snapshot adapter", () => {
    it("rejects forged completion without touching stock, and keeps archive/restore operational", async () => {
        const db = new PGlite();
        databases.push(db);
        await db.exec(`CREATE TABLE dashboard_domain_state(domain text PRIMARY KEY,version bigint,data jsonb,updated_by text,updated_at timestamptz);
      CREATE TABLE audit_logs(actor_type text,actor_id text,action text,entity_type text,entity_id text,request_id text,metadata jsonb);
      CREATE TABLE customers(user_id uuid PRIMARY KEY,client_code text);CREATE TABLE orders(id uuid PRIMARY KEY,order_code text);
      CREATE TABLE inventory_items(id text PRIMARY KEY,item_code text,status text);
      INSERT INTO dashboard_domain_state VALUES('returns',1,'[]',NULL,now());`);
        for (const file of ["0024_relational_business_domains.sql", "0025_relational_domains_authoritative.sql", "0026_return_damage_typed_core.sql"])
            await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
        const row = { id: "R1", returnId: "R1", itemCode: "I1", requestType: "Refund", status: "Pending Request" };
        await db.exec("INSERT INTO inventory_items VALUES('I1','I1','Sold')");
        await db.query("INSERT INTO return_requests(record_id,payload) VALUES('R1',$1::jsonb)", [JSON.stringify(row)]);
        const service = new DashboardStateService(poolFor(db));
        await expect(service.write("returns", 1, [{ ...row, status: "Completed", refundAmount: 200 }], "staff", "request")).rejects.toMatchObject({ code: "RETURN_COMMAND_REQUIRED" });
        expect((await db.query("SELECT status FROM inventory_items")).rows).toEqual([{ status: "Sold" }]);
        expect((await service.read("returns")).data).toEqual([row]);
        const archived = await service.write("returns", 1, [{ ...row, isArchived: true, isDeleted: true }], "staff", "archive");
        expect(archived.data[0]).toMatchObject({ status: "Pending Request", isArchived: true });
        await service.write("returns", 2, [{ ...row, isArchived: false, isDeleted: false }], "staff", "restore");
        expect((await service.read("returns")).data[0]).toMatchObject({ status: "Pending Request", isArchived: false });
    });
});
