import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { CustomerEmailLinkService } from "../src/modules/identity/customer-email-link.service.js";
import { digest } from "../src/security/crypto.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";

const config = {
  authPepper: "unit-test-only", mfaEncryptionKey: Buffer.alloc(32),
  emailOtpTtlMinutes: 10,
};
const challengeId = "b6bb9ef3-83e5-4c4a-ab39-455b39d3ab10";
const targetUserId = "c7728b91-b056-46d0-9887-b944fe92822a";
const staffUserId = "aac4e90b-3cb7-4ff9-9497-c028b68d4997";
const row = () => ({
  id: challengeId,
  customer_user_id: targetUserId,
  phone_normalized: "+201012345678",
  email: "new@example.com",
  email_normalized: "new@example.com",
  code_hash: digest("customer-email-link:" + challengeId + ":123456", config.authPepper),
  attempts_remaining: 5, expires_at: new Date(Date.now() + 600000),
  verified_at: null, status: "unverified",
});
const owner = {
  userId: staffUserId, accountType: "staff", mfaSatisfied: true,
  permissions: ["staff.manage"],
} as AuthenticatedAccount;

describe("phone-only account email link review", () => {
  it("does not send an OTP or create a session for an unknown phone", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT u.id::text FROM users u")) return { rows: [] };
        if (sql.includes("SELECT EXISTS")) return { rows: [{ present: false }] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const service = new CustomerEmailLinkService(pool as unknown as Pool, config);
    const result = await service.start("01012345678", "person@example.com");
    expect(result.sent).toBe(false);
    expect(result.challengeId).toBeTruthy();
    expect(statements.some(sql => sql.includes("INSERT INTO outbox_events"))).toBe(false);
    expect(statements.some(sql => sql.includes("INSERT INTO customer_email_link_requests"))).toBe(false);
  });

  it("sends only a verification email, never a login session", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT u.id::text FROM users u")) return { rows: [{ id: targetUserId }] };
        if (sql.includes("SELECT EXISTS")) return { rows: [{ present: false }] };
        if (sql.includes("FROM customer_email_link_requests") && sql.includes("created_at")) return { rows: [] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    const service = new CustomerEmailLinkService({ connect: vi.fn(async () => client) } as unknown as Pool, config);
    const result = await service.start("01012345678", "new@example.com");
    expect(result.sent).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO customer_email_link_requests"))).toBe(true);
    expect(statements.some(sql => sql.includes("CUSTOMER_EMAIL_LINK_OTP_REQUESTED"))).toBe(true);
    expect(statements.some(sql => /INSERT INTO sessions|UPDATE users SET/.test(sql))).toBe(false);
  });

  it("bad OTP decreases attempts but cannot make an account accessible", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT * FROM customer_email_link_requests")) return { rows: [row()] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    const service = new CustomerEmailLinkService({ connect: vi.fn(async () => client) } as unknown as Pool, config);
    await expect(service.verify(challengeId, "654321")).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(statements.some(sql => sql.includes("attempts_remaining=GREATEST"))).toBe(true);
    expect(statements.some(sql => sql.includes("status='pending_review'"))).toBe(false);
    expect(statements.some(sql => sql.includes("INSERT INTO admin_notifications"))).toBe(false);
    expect(statements.some(sql => sql.includes("UPDATE users"))).toBe(false);
  });

  it("valid OTP makes a pending request only, not an authenticated customer", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT * FROM customer_email_link_requests")) return { rows: [row()] };
        if (sql.includes("SELECT u.id::text FROM users u")) return { rows: [{ id: targetUserId }] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    const service = new CustomerEmailLinkService({ connect: vi.fn(async () => client) } as unknown as Pool, config);
    expect(await service.verify(challengeId, "123456")).toEqual({ reviewPending: true });
    expect(statements.some(sql => sql.includes("status='pending_review'"))).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO admin_notifications"))).toBe(true);
    expect(statements.some(sql => sql.includes("UPDATE users"))).toBe(false);
    expect(statements.some(sql => sql.includes("INSERT INTO sessions"))).toBe(false);
  });

  it("rejects staff and unverified Owner approval before opening a database transaction", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ is_owner: false }] }), connect: vi.fn() };
    const service = new CustomerEmailLinkService(pool as unknown as Pool, config);
    await expect(service.review({ ...owner, mfaSatisfied: false }, challengeId, true,
      "I checked the identity", true, { requestId: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.review(owner, challengeId, true,
      "I checked the identity", true, { requestId: "test" })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("requires a manual phone check; approved links are audited and invalidate old sessions", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT * FROM customer_email_link_requests")) return {
          rows: [{ ...row(), status: "pending_review", verified_at: new Date() }],
        };
        if (sql.includes("SELECT id::text,email,status,deleted_at FROM users")) return { rows: [{ id: targetUserId, email: null, status: "active", deleted_at: null }] };
        if (sql.includes("FROM account_phones") && sql.includes("AS present")) return { rows: [{ present: true }] };
        if (sql.includes("SELECT EXISTS(SELECT 1 FROM users")) return { rows: [{ present: false }] };
        return { rows: [] };
      }), release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ is_owner: true }] }),
      connect: vi.fn(async () => client),
    };
    const service = new CustomerEmailLinkService(pool as unknown as Pool, config);
    await expect(service.review(owner, challengeId, true, "verified phone by direct call",
      false, { requestId: "test" })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await service.review(owner, challengeId, true, "verified phone by direct call",
      true, { requestId: "test" })).toEqual({ approved: true });
    expect(statements.some(sql => sql.includes("UPDATE users SET email=$2,email_normalized=$3"))).toBe(true);
    expect(statements.some(sql => sql.includes("session_version=session_version+1"))).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("keeps client scripts separate and shows the typed email after OTP request", () => {
    const page = readFileSync(new URL("../../Js/dart-email-link.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../../Sign Up modern.html", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../../Eye/dart-email-links.js", import.meta.url), "utf8");
    expect(() => new Script(page)).not.toThrow();
    expect(() => new Script(dashboard)).not.toThrow();
    expect(html).toContain("Js/dart-email-link.js");
    expect(page).toContain("data-link-recipient");
    expect(page).toContain("result.reviewPending");
    expect(page).not.toContain("sessionToken");
    expect(dashboard).toContain("confirmedPhoneOwner");
  });

  it("keeps the customer email dialog centered in the viewport", () => {
    const css = readFileSync(new URL("../../CSS/dart-auth.css", import.meta.url), "utf8");
    expect(css).toContain(".dart-auth-page .dart-email-link-dialog {");
    expect(css).toMatch(/\.dart-auth-page \.dart-email-link-dialog\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.dart-auth-page \.dart-email-link-dialog\s*\{[^}]*inset:\s*0/s);
    expect(css).toMatch(/\.dart-auth-page \.dart-email-link-dialog\s*\{[^}]*margin:\s*auto/s);
  });
});
