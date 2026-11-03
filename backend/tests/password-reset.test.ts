// Isolated database coverage of the existing customer password-recovery contract.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { decryptSecret } from "../src/security/crypto.js";

const config = { authPepper: "synthetic-password-reset-test-pepper-32", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 8) };
const metadata = { requestId: "synthetic-reset-test", userAgent: "vitest", ipAddress: "127.0.0.1" };
describe("customer password recovery", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, identity: IdentityService;
  beforeAll(async () => { store = await embeddedStore(true); identity = new IdentityService(store.pool, config); }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function fixture() {
    const email = `${randomUUID()}@example.test`, phone = `010${String(randomInt(0, 100000000)).padStart(8, "0")}`;
    const session = await identity.registerCustomer({ name: "Synthetic Customer", email, phone1: phone, birthday: "2000-01-02", password: "before-reset" }, metadata);
    return { email, phone, session };
  }
  async function request(identifier: string) {
    const challenge = await identity.requestPasswordReset("customer", identifier, metadata);
    const event = (await store.pool.query("SELECT payload FROM outbox_events WHERE deduplication_key=$1", [`password-reset-code:${challenge.challengeId}`])).rows[0];
    const code = event ? decryptSecret(Buffer.from(event.payload.encryptedParameters.otp, "base64"), config.mfaEncryptionKey) : "";
    return { ...challenge, event, code };
  }
  it("resets via the registered email, accepts the six-character customer policy, revokes sessions and prevents replay", async () => {
    const f = await fixture(), reset = await request(f.email);
    expect(reset.event.payload.to).toBe(f.email); expect(reset.code).toMatch(/^\d{6}$/);
    expect(reset.event.payload.otp).toBeUndefined();
    await identity.resetPasswordWithOtp(reset.challengeId, reset.code, "new123", metadata);
    const [id, secret] = f.session.sessionToken.split(".");
    expect(await identity.authenticate(id!, secret!)).toBeNull();
    await expect(identity.login("customer", f.email, "before-reset", metadata)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await identity.login("customer", f.email, "new123", metadata)).account.userId).toBe(f.session.account.userId);
    await expect(identity.resetPasswordWithOtp(reset.challengeId, reset.code, "other123", metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    const audit = await store.pool.query("SELECT id FROM audit_logs WHERE action='PASSWORD_RESET_COMPLETED' AND entity_id=$1", [f.session.account.userId]);
    expect(audit.rows).toHaveLength(1);
  });
  it("uses phone/account ID only to locate the registered email and invalidates the old code on resend", async () => {
    const f = await fixture(), first = await request(f.phone);
    const customer = (await store.pool.query("SELECT client_code FROM customers WHERE user_id=$1", [f.session.account.userId])).rows[0];
    const next = await request(customer.client_code as string);
    expect(first.event.payload.to).toBe(f.email); expect(next.event.payload.to).toBe(f.email);
    await expect(identity.resetPasswordWithOtp(first.challengeId, first.code, "another123", metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    await expect(identity.resetPasswordWithOtp(next.challengeId, next.code, "another123", metadata)).resolves.toBeUndefined();
  });
  it("limits incorrect attempts and rejects expired codes", async () => {
    const f = await fixture(), reset = await request(f.email);
    const wrong = reset.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(identity.resetPasswordWithOtp(reset.challengeId, wrong, "another123", metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    }
    await expect(identity.resetPasswordWithOtp(reset.challengeId, reset.code, "another123", metadata)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    const expired = await request(f.email);
    await store.pool.query("UPDATE password_reset_requests SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.challengeId]);
    await expect(identity.resetPasswordWithOtp(expired.challengeId, expired.code, "another123", metadata)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });
  it("keeps account existence private and enforces password policy/history", async () => {
    const unknown = await request(`${randomUUID()}@example.test`);
    expect(unknown.challengeId).toBeTruthy(); expect(unknown.event).toBeUndefined();
    await expect(identity.resetPasswordWithOtp(unknown.challengeId, "123456", "another123", metadata)).rejects.toMatchObject({ code: "OTP_INVALID" });
    const f = await fixture(), reset = await request(f.email);
    await expect(identity.resetPasswordWithOtp(reset.challengeId, reset.code, "12345", metadata)).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(identity.resetPasswordWithOtp(reset.challengeId, reset.code, "before-reset", metadata)).rejects.toMatchObject({ code: "PASSWORD_REUSED" });
    await expect(identity.resetPasswordWithOtp(reset.challengeId, reset.code, "valid123", metadata)).resolves.toBeUndefined();
  });
});
