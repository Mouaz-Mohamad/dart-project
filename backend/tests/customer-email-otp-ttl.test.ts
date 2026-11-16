import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { CustomerEmailAuthService } from "../src/modules/identity/customer-email-auth.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";

describe("customer email OTP lifetime", () => {
  it("uses the configured 10-minute TTL in the challenge, response, and queued email", async () => {
    const statements: Array<{ sql: string; args: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, args?: unknown[]) => {
        statements.push({ sql, args });
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ present: false }] }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new CustomerEmailAuthService(
      pool as unknown as Pool,
      { authPepper: "test-pepper", mfaEncryptionKey: Buffer.alloc(32), emailOtpTtlMinutes: 10 },
      {} as IdentityService,
    );
    const startedAt = Date.now();
    const issued = await service.startSignup({
      name: "Dart Tester", phone1: "01012345678", email: "tester@example.com", birthday: "2000-09-02",
    });
    expect(issued.sent).toBe(true);
    const actualExpiry = new Date(issued.expiresAt).getTime();
    expect(actualExpiry).toBeGreaterThanOrEqual(startedAt + 10 * 60_000);
    expect(actualExpiry).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    const challengeInsert = statements.find(({ sql }) => sql.includes("INSERT INTO customer_email_otp_challenges"));
    expect(challengeInsert?.args?.[7]).toBeInstanceOf(Date);
    expect((challengeInsert?.args?.[7] as Date).getTime()).toBe(actualExpiry);
    const queuedEmail = statements.find(({ sql }) => sql.includes("INSERT INTO outbox_events"));
    const emailPayload = JSON.parse(String(queuedEmail?.args?.[2])) as { expiresAt: string; encryptedParameters: Record<string, string> };
    expect(emailPayload.expiresAt).toBe(issued.expiresAt);
    expect(emailPayload.encryptedParameters.otp).toBeDefined();
  });
});
