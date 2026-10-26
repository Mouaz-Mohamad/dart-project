import { randomInt, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { decryptSecret } from "../src/security/crypto.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { createOutboxRouter } from "../src/modules/outbox/outbox.routes.js";

const config = { authPepper: "synthetic-test-auth-pepper-32-characters", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 7), whatsappAccessToken: null,
  whatsappPhoneNumberId: null, whatsappGraphApiVersion: "v26.0", whatsappTemplateLanguage: "ar", outboxBatchSize: 5 };
const metadata = { requestId: "synthetic-council-regression", userAgent: "vitest", ipAddress: "127.0.0.1" };

describe("third Council account and delivery regressions", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, identity: IdentityService, actor: AuthenticatedAccount;
  beforeAll(async () => {
    store = await embeddedStore(true); identity = new IdentityService(store.pool, config);
    const id = randomUUID();
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,status,email_verified_at)
      VALUES($1,'staff',$2,$2,'active',now())`, [id, `${id}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic administrator')", [id]);
    actor = { userId: id, accountType: "staff", mfaSatisfied: true, permissions: ["customers.manage"] } as AuthenticatedAccount;
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function register() {
    const id = randomUUID(), phone = `010${String(randomInt(0, 100000000)).padStart(8, "0")}`;
    const session = await identity.registerCustomer({ name: "Synthetic Customer", email: `${id}@example.test`, phone1: phone, birthday: "2000-01-02", password: "SyntheticPassword123" }, metadata);
    return { session, phone };
  }
  async function emailChange() {
    const f = await register();
    const changed = await identity.updateCustomerProfile(f.session.account, { name: "Synthetic Customer", email: `${randomUUID()}@example.test`, phone1: f.phone }, metadata);
    const challenge = changed.verification!.challengeId;
    const event = (await store.pool.query("SELECT payload FROM outbox_events WHERE deduplication_key=$1", [`email-change-verification:${challenge}`])).rows[0];
    const code = decryptSecret(Buffer.from(event.payload.encryptedParameters.otp, "base64"), config.mfaEncryptionKey);
    return { ...f, challenge, code };
  }

  it("allows an active customer's email change and a normal session rotation", async () => {
    const f = await emailChange();
    const verified = await identity.verifyCustomerEmail(f.challenge, f.code, metadata);
    expect(verified.account.status).toBe("active");
    const rotated = await identity.rotateSession(verified.account, metadata);
    const [id, secret] = rotated.sessionToken.split(".");
    expect(await identity.authenticate(id!, secret!)).toMatchObject({ userId: f.session.account.userId });
  });

  it("invalidates pending verification and sessions on deletion and never revives the identity", async () => {
    const f = await emailChange();
    await identity.adminSetAccountState(actor, f.session.account.userId, "customer", "delete", metadata);
    await expect(identity.verifyCustomerEmail(f.challenge, f.code, metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    const [id, secret] = f.session.sessionToken.split(".");
    expect(await identity.authenticate(id!, secret!)).toBeNull();
    const row = (await store.pool.query("SELECT status,deleted_at FROM users WHERE id=$1", [f.session.account.userId])).rows[0];
    expect(row.deleted_at).not.toBeNull(); expect(row.status).not.toBe("active");
    await expect(identity.updateCustomerProfile(f.session.account, { name: "Stale request", email: "stale@example.test", phone1: f.phone }, metadata)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    expect((await store.pool.query("SELECT consumed_at FROM email_verification_challenges WHERE id=$1", [f.challenge])).rows[0].consumed_at).not.toBeNull();
    await expect(identity.rotateSession(f.session.account, metadata)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a legacy active-but-deleted identity at authentication and session issuance", async () => {
    const f = await register();
    await store.pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [f.session.account.userId]);
    const [id, secret] = f.session.sessionToken.split(".");
    expect(await identity.authenticate(id!, secret!)).toBeNull();
    await expect(identity.rotateSession(f.session.account, metadata)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });

  it("invalidates pre-suspension verification and reset requests", async () => {
    const f = await emailChange();
    // Keep the challenge pending while placing the account in a suspendable state.
    await store.pool.query("UPDATE users SET status='active',email_verified_at=now() WHERE id=$1", [f.session.account.userId]);
    const reset = randomUUID();
    await store.pool.query(`INSERT INTO password_reset_requests(id,user_id,account_type,identifier_hash)
      VALUES($1,$2,'customer',$3)`, [reset, f.session.account.userId, "a".repeat(64)]);
    await identity.adminSetAccountState(actor, f.session.account.userId, "customer", "suspend", metadata);
    await expect(identity.verifyCustomerEmail(f.challenge, f.code, metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect((await store.pool.query("SELECT status,consumed_at FROM password_reset_requests WHERE id=$1", [reset])).rows[0]).toMatchObject({ status: "expired", consumed_at: expect.any(Date) });
    await expect(identity.updateCustomerProfile(f.session.account, { name: "Stale request", email: "stale@example.test", phone1: f.phone }, metadata)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("serializes concurrent verification and deletion without issuing a usable deleted-account session", async () => {
    const f = await emailChange();
    const [verified, deleted] = await Promise.allSettled([
      identity.verifyCustomerEmail(f.challenge, f.code, metadata),
      identity.adminSetAccountState(actor, f.session.account.userId, "customer", "delete", metadata),
    ]);
    expect(deleted.status).toBe("fulfilled");
    if (verified.status === "fulfilled") {
      const [id, secret] = verified.value.sessionToken.split(".");
      expect(await identity.authenticate(id!, secret!)).toBeNull();
    } else expect(verified.reason).toMatchObject({ code: "OTP_INVALID" });
    expect((await store.pool.query("SELECT count(*)::int AS count FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [f.session.account.userId])).rows[0].count).toBe(0);
  });

  async function event() {
    // Keep identity fixtures out of the worker batch exercised below.
    await store.pool.query("UPDATE outbox_events SET available_at=now()+interval '1 day' WHERE status='pending'");
    const id = randomUUID();
    await store.pool.query(`INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,deduplication_key)
      VALUES($1::uuid,'user',$1::text,'order.created',$2::jsonb,$1::text)`, [id, JSON.stringify({ channel: "email", to: "synthetic@example.test", parameters: { orderId: "K-SYNTHETIC", total: "120.75" } })]);
    return id;
  }
  it("retries a definite SMTP connection failure after recovery and sends only once", async () => {
    const id = await event(); let calls = 0, recovered = false;
    const service = new OutboxService(store.pool, config, { configured: () => true, send: async () => {
      calls++; if (!recovered) throw Object.assign(new Error("Synthetic connection failure"), { code: "ESOCKET", originalCode: "ECONNREFUSED", syscall: "connect", command: "CONN" });
    } });
    expect(await service.processBatch(1, id)).toMatchObject({ failed: 1, uncertain: 0 });
    await store.pool.query("UPDATE outbox_events SET available_at=now() WHERE id=$1", [id]); recovered = true;
    expect(await service.processBatch(1, id)).toMatchObject({ published: 1 });
    expect(await service.processBatch(1, id)).toMatchObject({ claimed: 0 }); expect(calls).toBe(2);
  });

  it("quarantines a lost post-DATA acknowledgement and exposes it in every worker response", async () => {
    const id = await event(); let calls = 0;
    const service = new OutboxService(store.pool, config, { configured: () => true, send: async () => {
      calls++; throw Object.assign(new Error("Synthetic lost acknowledgement"), { code: "ESOCKET", command: "DATA" });
    } });
    expect(await service.processBatch(1, id)).toMatchObject({ uncertain: 1 });
    await store.pool.query("UPDATE outbox_events SET available_at=now() WHERE id=$1", [id]);
    expect(await service.processBatch(1, id)).toMatchObject({ claimed: 0 }); expect(calls).toBe(1);
    const secret = "s".repeat(32), app = express(); app.use(createOutboxRouter(service, { outboxCronSecret: secret }));
    const response = await request(app).post("/internal/outbox/process?limit=1").set("Authorization", `Bearer ${secret}`);
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ claimed: 0, health: { uncertain: 1 } });
  });

  it("does not treat a later socket reset labelled CONN as a safe connection retry", async () => {
    const id = await event(); let calls = 0;
    const service = new OutboxService(store.pool, config, { configured: () => true, send: async () => {
      calls++; throw Object.assign(new Error("Synthetic socket reset"), { code: "ESOCKET", originalCode: "ECONNRESET", command: "CONN" });
    } });
    expect(await service.processBatch(1, id)).toMatchObject({ uncertain: 1, failed: 0 });
    await store.pool.query("UPDATE outbox_events SET available_at=now() WHERE id=$1", [id]);
    expect(await service.processBatch(1, id)).toMatchObject({ claimed: 0 }); expect(calls).toBe(1);
  });

  it("reports an expired executing lease even when the worker claims no events", async () => {
    const id = await event();
    await store.pool.query("INSERT INTO outbox_delivery_attempts(id,event_id,state,updated_at) VALUES($1,$2,'executing',now()-interval '10 minutes')", [randomUUID(), id]);
    const service = new OutboxService(store.pool, config, { configured: () => true, send: async () => { throw new Error("Must not send"); } });
    expect(await service.processBatch(1, id)).toMatchObject({ claimed: 0 });
    expect((await service.health()).uncertain).toBe(3);
  });
});
