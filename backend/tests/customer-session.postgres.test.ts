// Customer persistence uses real PostgreSQL session guards, including revocation races.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { hashCsrfToken, parseSessionToken } from "../src/security/session-token.js";
import { embeddedStore } from "./embedded-store.js";

const config = { authPepper: "session-test-pepper-with-at-least-32-characters", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 5) };
const metadata = { requestId: "session-regression", userAgent: "synthetic-test" };
describe("persistent customer sessions", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: IdentityService;
  beforeAll(async () => { store = await embeddedStore(); service = new IdentityService(store.pool, config); }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function customer() {
    const id = randomUUID();
    return service.registerCustomer({ name: "Session Test", email: `${id}@example.test`,
      phone1: `010${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
      birthday: "2000-01-01", password: "test-password" }, metadata);
  }
  it("issues persistent cookies for a year and renews without replacing the session", async () => {
    const session = await customer();
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(364 * 86400000);
    await store.pool.query("UPDATE sessions SET expires_at=now()+interval '1 day' WHERE id=$1", [session.account.sessionId]);
    const renewal = await service.renewCustomerSession(session.account, session.sessionToken);
    expect(renewal.sessionToken).toBe(session.sessionToken);
    expect(renewal.expiresAt.getTime() - Date.now()).toBeGreaterThan(364 * 86400000);
    const token = parseSessionToken(renewal.sessionToken)!;
    expect((await service.authenticate(token.id, token.secret))?.userId).toBe(session.account.userId);
  });
  it("recovers the same CSRF token across parallel tabs without invalidating the family", async () => {
    const session = await customer();
    const [first, second] = await Promise.all([
      service.renewCustomerSession(session.account, session.sessionToken),
      service.renewCustomerSession(session.account, session.sessionToken),
    ]);
    expect(first.csrfToken).toBe(second.csrfToken);
    expect(first.csrfToken).toBe(session.csrfToken);
    const row = (await store.pool.query("SELECT csrf_token_hash,revoked_at FROM sessions WHERE id=$1", [session.account.sessionId])).rows[0];
    expect(row.csrf_token_hash).toBe(hashCsrfToken(first.csrfToken, config.authPepper));
    expect(row.revoked_at).toBeNull();
  });
  it("cannot resurrect logout, expiry, password revocation or a blocked account", async () => {
    for (const sql of [
      "UPDATE sessions SET revoked_at=now(),revoke_reason='logout' WHERE user_id=$1",
      "UPDATE sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",
      "UPDATE users SET session_version=session_version+1 WHERE id=$1",
      "UPDATE users SET status='suspended' WHERE id=$1",
    ]) {
      const session = await customer();
      await store.pool.query(sql, [session.account.userId]);
      await expect(service.renewCustomerSession(session.account, session.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    }
  });
  it("rejects another session token, the wrong secret and non-customer accounts", async () => {
    const session = await customer(), other = await customer();
    await expect(service.renewCustomerSession(session.account, other.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.renewCustomerSession(session.account, `${session.account.sessionId}.${"x".repeat(43)}`)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.renewCustomerSession({ ...session.account, accountType: "staff" }, session.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });
});
