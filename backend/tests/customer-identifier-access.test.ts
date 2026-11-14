// Customer access must require a verified email or passkey; privileged realms remain separate.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { SocialAuthService, loadSocialAuthConfig } from "../src/modules/identity/social-auth.service.js";
import { checkoutSchema } from "../src/modules/commerce/commerce.routes.js";
import { digest } from "../src/security/crypto.js";
import { hashPassword } from "../src/security/password.js";
import { parseSessionToken } from "../src/security/session-token.js";
import { embeddedStore } from "./embedded-store.js";

const config = { authPepper: "identifier-test-pepper-with-at-least-32-characters", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 5) };
const metadata = { requestId: "identifier-regression", userAgent: "synthetic-test" };
const phone = () => `010${String(randomInt(0, 100000000)).padStart(8, "0")}`;

describe("customer identifier access", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: IdentityService, social: SocialAuthService;
  beforeAll(async () => {
    store = await embeddedStore(); service = new IdentityService(store.pool, config);
    social = new SocialAuthService(store.pool, service, loadSocialAuthConfig({}, {
      ...config, port: 4000, corsOrigins: ["http://localhost:4173"],
    }));
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  async function customer(email?: string) {
    const phone1 = phone();
    const session = await service.registerCustomer({ name: "Identifier Test", phone1, birthday: "2000-01-01", ...(email ? { email } : {}) }, metadata);
    return { session, phone1 };
  }
  async function socialToken(email: string, subject = randomUUID()) {
    const id = randomUUID(), secret = "s".repeat(43);
    await store.pool.query(`INSERT INTO customer_social_auth_challenges
      (id,provider,state_hash,completion_hash,provider_subject,provider_email,provider_email_normalized,status,expires_at)
      VALUES ($1,'google',$2,$3,$4,$5,$6,'pending_completion',now()+interval '10 minutes')`,
    [id,digest(id,config.authPepper),digest(`social-complete:${id}:${secret}`,config.authPepper),subject,email,email.toLowerCase()]);
    return `${id}.${secret}`;
  }
  it("registers multiple phone-only customers with no password or fake email", async () => {
    const first = await customer(), second = await customer();
    expect(first.session.account.userId).not.toBe(second.session.account.userId);
    const row = (await store.pool.query("SELECT email,email_normalized,password_hash FROM users WHERE id=$1", [first.session.account.userId])).rows[0];
    expect(row).toEqual({ email: null, email_normalized: null, password_hash: null });
    expect((await service.profile(first.session.account)).email).toBe("");
    await expect(service.loginCustomer(`+20 ${first.phone1.slice(1)}`, metadata)).rejects.toMatchObject({code:'EMAIL_OTP_REQUIRED'});
    expect(Number((await store.pool.query("SELECT count(*) FROM outbox_events WHERE aggregate_id=$1", [first.session.account.userId])).rows[0].count)).toBe(0);
  });
  it("preserves existing accounts and ignores retired password locks and temporary flags", async () => {
    const email = `${randomUUID()}@example.test`, f = await customer(email);
    await store.pool.query(`UPDATE users SET password_hash='legacy-hash',must_change_password=true,
      status='pending_verification',failed_login_count=5,locked_until=now()+interval '15 minutes' WHERE id=$1`, [f.session.account.userId]);
    await expect(service.loginCustomer(`  ${email.toUpperCase()}  `, metadata)).rejects.toMatchObject({code:'EMAIL_OTP_REQUIRED'});
    expect((await service.profile(f.session.account)).birthday).toBe("2000-01-01");
    const token = parseSessionToken(f.session.sessionToken)!;
    expect(await service.authenticate(token.id,token.secret)).toBeNull();
  });
  it("rejects names, public account codes, unknown numbers and blocked/deleted accounts", async () => {
    const f = await customer();
    const profile = await service.profile(f.session.account);
    for (const identifier of ["Identifier Test",profile.code,"not-an-email",phone()]) {
      await expect(service.loginCustomer(identifier,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
    }
    await store.pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.session.account.userId]);
    await expect(service.loginCustomer(f.phone1,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
    await store.pool.query("UPDATE users SET status='deleted',deleted_at=now() WHERE id=$1", [f.session.account.userId]);
    await expect(service.loginCustomer(f.phone1,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
  });
  it("cannot use a representative/staff identifier to issue a privileged session", async () => {
    const email = `${randomUUID()}@example.test`, repId = randomUUID();
    const password = "RepresentativePassword123";
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES ($1,'representative',$2,$2,$3,'active',now())`, [repId,email,await hashPassword(password)]);
    await expect(service.loginCustomer(email,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
    await expect(service.login("representative",email,"",metadata)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await service.login("representative",email,password,metadata)).account.accountType).toBe("representative");
    await customer(email);
    await expect(service.loginCustomer(email,metadata)).rejects.toMatchObject({code:'EMAIL_OTP_REQUIRED'});
    const staffEmail = `${randomUUID()}@example.test`;
    await store.pool.query(`INSERT INTO users(account_type,email,email_normalized,status,email_verified_at)
      VALUES ('staff',$1,$1,'active',now())`, [staffEmail]);
    await expect(service.loginCustomer(staffEmail,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
  });
  it("edits a phone-only profile, adds email directly and keeps the current session usable", async () => {
    const f = await customer(), email = `${randomUUID()}@example.test`;
    const saved = await service.updateCustomerProfile(f.session.account, {
      name: "Updated Name",email,phone1:f.phone1,birthday:"2000-01-01",
    }, metadata);
    expect(saved.verification).toBeUndefined();
    expect(saved.profile.email).toBe(email);
    expect(saved.profile.emailVerified).toBe(false);
    const token = parseSessionToken(f.session.sessionToken)!;
    expect(await service.authenticate(token.id,token.secret)).not.toBeNull();
    await expect(service.loginCustomer(email,metadata)).rejects.toMatchObject({code:'EMAIL_OTP_REQUIRED'});
    const cleared = await service.updateCustomerProfile(f.session.account, {
      name:"Updated Name",email:"",phone1:f.phone1,birthday:"2000-01-01",
    },metadata);
    expect(cleared.profile.email).toBe("");
    await expect(service.loginCustomer(email,metadata)).rejects.toMatchObject({ code: "EMAIL_OTP_REQUIRED" });
  });
  it("reuses the existing phone identity and rejects customer password recovery", async () => {
    const f = await customer();
    expect((await service.registerCustomer({name:"Duplicate Test",phone1:f.phone1,birthday:"2000-01-01"},metadata)).account.userId).toBe(f.session.account.userId);
    await expect(service.requestPasswordReset("customer",f.phone1,metadata)).rejects.toMatchObject({code:"CUSTOMER_PASSWORD_RETIRED"});
    expect(Number((await store.pool.query("SELECT count(*) FROM password_reset_requests WHERE user_id=$1",[f.session.account.userId])).rows[0].count)).toBe(0);
  });
  it("links Google to an existing email customer without a Dart password and consumes its capability once", async () => {
    const email = `${randomUUID()}@example.test`, f = await customer(email), token = await socialToken(email);
    expect((await social.challenge(token)).passwordRequired).toBe(false);
    expect((await social.complete({token},metadata)).account.userId).toBe(f.session.account.userId);
    await expect(social.complete({token},metadata)).rejects.toMatchObject({code:"SOCIAL_CHALLENGE_INVALID"});
  });
  it("rejects attempts to claim a phone-only account through a different Google identity", async () => {
    const f = await customer(), email = `${randomUUID()}@example.test`, token = await socialToken(email);
    await expect(social.complete({
      token,phone1:f.phone1,name:"Same Account",birthday:"2001-02-03",
    },metadata)).rejects.toMatchObject({code:"CUSTOMER_ALREADY_EXISTS"});
    const profile=await service.profile(f.session.account);
    expect(profile.email).toBe("");
    expect(profile.birthday).toBe("2000-01-01");
  });
  it("creates a new Google customer with no generated password", async () => {
    const email = `${randomUUID()}@example.test`, token = await socialToken(email);
    const session = await social.complete({token,name:"Google Customer",phone1:phone(),birthday:"2001-02-03"},metadata);
    expect((await service.profile(session.account)).email).toBe(email);
    expect((await store.pool.query("SELECT password_hash FROM users WHERE id=$1",[session.account.userId])).rows[0].password_hash).toBeNull();
  });
  it("does not require an email for checkout", () => {
    const contact = checkoutSchema.shape.contact;
    expect(contact.parse({name:"Customer",phone1:phone()}).email).toBe("");
    expect(contact.parse({name:"Customer",phone1:phone(),email:""}).email).toBe("");
    expect(() => contact.parse({name:"Customer",phone1:phone(),email:"bad"})).toThrow();
  });
});
