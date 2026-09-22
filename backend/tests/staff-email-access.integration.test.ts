// DART CODE GUIDE | backend/tests/staff-email-access.integration.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import type { IssuedSession } from "../src/modules/identity/identity.types.js";
import { decryptSecret } from "../src/security/crypto.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_staff_email_${randomUUID().replaceAll("-", "")}`;
let adminPool: Pool | undefined;
let testPool: Pool | undefined;
let service: IdentityService | undefined;
let ownerSession: IssuedSession | undefined;
let staffSession: IssuedSession | undefined;

const authConfig: Pick<
  AppConfig,
  | "authPepper"
  | "sessionTtlDays"
  | "emailOtpTtlMinutes"
  | "mfaEncryptionKey"
> = {
  authPepper: "email-integration-auth-pepper-32-characters-long",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 8),
};

const metadata = {
  requestId: "staff-email-integration",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

function splitSession(session: IssuedSession): [string, string] {
  const separator = session.sessionToken.indexOf(".");
  if (separator < 1) throw new Error("Invalid test session token");
  return [
    session.sessionToken.slice(0, separator),
    session.sessionToken.slice(separator + 1),
  ];
}

async function codeFor(challengeId: string): Promise<string> {
  const result = await testPool!.query<{
    payload: {
      encryptedParameters?: { otp?: string };
    };
  }>(
    `SELECT payload
       FROM outbox_events
      WHERE deduplication_key=$1
      ORDER BY created_at DESC
      LIMIT 1`,
    [`staff-email-access-code:${challengeId}`],
  );
  const encoded = result.rows[0]?.payload?.encryptedParameters?.otp;
  if (!encoded) throw new Error("Missing encrypted Staff email OTP in test outbox");
  return decryptSecret(
    Buffer.from(encoded, "base64"),
    authConfig.mfaEncryptionKey,
  );
}

async function signIn(email: string): Promise<IssuedSession> {
  const start = await service!.startStaffEmailAccess(email, metadata);
  expect(start.deliveryQueued).toBe(true);
  const otp = await codeFor(start.challengeId);
  return service!.verifyStaffEmailAccess(start.challengeId, otp, metadata);
}

describe.skipIf(!databaseUrl)("Staff simplified email access integration", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      options: `-c search_path=${schemaName},public`,
    });
    await runMigrations(testPool, resolve(process.cwd(), "migrations"));
    service = new IdentityService(testPool, authConfig);
  });

  afterAll(async () => {
    await testPool?.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  it("seeds protected Owner email access and activates it with one email code", async () => {
    const seeded = await testPool!.query<{
      email: string;
      access_mode: string;
      is_owner: boolean;
      mfa_required: boolean;
      status: string;
    }>(
      `SELECT email, access_mode, is_owner, mfa_required, status
         FROM staff_invitations
        WHERE is_owner=true
          AND status='pending'`,
    );
    expect(seeded.rows).toEqual([
      expect.objectContaining({
        email: "midomoaaz3@gmail.com",
        access_mode: "email_otp",
        is_owner: true,
        mfa_required: false,
        status: "pending",
      }),
    ]);

    ownerSession = await signIn("midomoaaz3@gmail.com");
    expect(ownerSession.account.accountType).toBe("staff");
    expect(ownerSession.account.mfaRequired).toBe(false);
    expect(ownerSession.account.mfaSatisfied).toBe(true);
    expect(ownerSession.account.permissions).toContain("staff.manage");

    const owner = await testPool!.query<{
      email: string;
      password_hash: string | null;
      is_owner: boolean;
      mfa_required: boolean;
      email_verified_at: Date | null;
    }>(
      `SELECT u.email, u.password_hash, s.is_owner, s.mfa_required,
              u.email_verified_at
         FROM users u
         JOIN staff_users s ON s.user_id=u.id
        WHERE s.is_owner=true`,
    );
    expect(owner.rows).toHaveLength(1);
    expect(owner.rows[0]).toMatchObject({
      email: "midomoaaz3@gmail.com",
      password_hash: null,
      is_owner: true,
      mfa_required: false,
    });
    expect(owner.rows[0]!.email_verified_at).not.toBeNull();
  });

  it("keeps unknown emails generic and does not queue a message", async () => {
    const start = await service!.startStaffEmailAccess(
      "not-allowed@example.com",
      metadata,
    );
    expect(start.deliveryQueued).toBe(false);

    const queued = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outbox_events
        WHERE deduplication_key=$1`,
      [`staff-email-access-code:${start.challengeId}`],
    );
    expect(queued.rows[0]?.count).toBe("0");
  });

  it("allows Staff by email + role, activates once, and reuses the same account later", async () => {
    const first = await service!.createStaffEmailAccess(
      ownerSession!.account,
      {
        email: "employee@example.com",
        role: "staff",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );
    const retry = await service!.createStaffEmailAccess(
      ownerSession!.account,
      {
        email: "employee@example.com",
        role: "staff",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );
    expect(retry.accessId).toBe(first.accessId);

    staffSession = await signIn("employee@example.com");
    expect(staffSession.account.permissions).toContain("orders.read");
    expect(staffSession.account.permissions).not.toContain("staff.manage");
    expect(staffSession.account.mfaRequired).toBe(false);

    const firstUserId = staffSession.account.userId;
    const second = await signIn("employee@example.com");
    expect(second.account.userId).toBe(firstUserId);

    const rows = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM users
        WHERE account_type='staff'
          AND email_normalized='employee@example.com'`,
    );
    expect(rows.rows[0]?.count).toBe("1");
    staffSession = second;
  });

  it("revokes sessions immediately when permissions change", async () => {
    const [oldSessionId, oldSecret] = splitSession(staffSession!);
    await service!.setStaffPermissions(
      ownerSession!.account,
      staffSession!.account.userId,
      ["orders.read", "orders.manage"],
      metadata,
    );
    await expect(
      service!.authenticate(oldSessionId, oldSecret),
    ).resolves.toBeNull();

    const fresh = await signIn("employee@example.com");
    expect(fresh.account.permissions).toContain("orders.manage");
    staffSession = fresh;
  });

  it("disables Staff immediately and blocks new verification emails until reactivated", async () => {
    const [sessionId, secret] = splitSession(staffSession!);
    await service!.setStaffAccessStatus(
      ownerSession!.account,
      staffSession!.account.userId,
      false,
      "security test disable",
      metadata,
    );
    await expect(service!.authenticate(sessionId, secret)).resolves.toBeNull();

    const blocked = await service!.startStaffEmailAccess(
      "employee@example.com",
      metadata,
    );
    expect(blocked.deliveryQueued).toBe(false);

    await service!.setStaffAccessStatus(
      ownerSession!.account,
      staffSession!.account.userId,
      true,
      "reactivated",
      metadata,
    );
    const restored = await signIn("employee@example.com");
    expect(restored.account.status).toBe("active");
  });

  it("protects the single Owner", async () => {
    await expect(
      service!.setStaffAccessStatus(
        ownerSession!.account,
        ownerSession!.account.userId,
        false,
        "should fail",
        metadata,
      ),
    ).rejects.toMatchObject({ code: "OWNER_ACCESS_PROTECTED" });

    await expect(
      service!.createStaffEmailAccess(
        ownerSession!.account,
        {
          email: "second-owner@example.com",
          role: "owner",
          permissionKeys: [],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "OWNER_ALREADY_EXISTS" });
  });
});
