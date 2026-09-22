import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import type { IssuedSession } from "../src/modules/identity/identity.types.js";
import type { VerifiedGoogleIdentity } from "../src/modules/identity/supabase-google.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_google_auth_${randomUUID().replaceAll("-", "")}`;
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
  | "staffInviteOtpTtlHours"
  | "corsOrigins"
> = {
  authPepper: "google-integration-auth-pepper-32-characters-long",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 8),
  staffInviteOtpTtlHours: 48,
  corsOrigins: ["https://dart.example"],
};

const metadata = {
  requestId: "staff-google-integration",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

function identity(
  email: string,
  supabaseUserId: string,
  providerSubject: string,
): VerifiedGoogleIdentity {
  return {
    email,
    emailNormalized: email.trim().toLowerCase(),
    supabaseUserId,
    providerSubject,
    provider: "google",
  };
}

const ownerIdentity = identity(
  "midomoaaz3@gmail.com",
  "10000000-0000-4000-8000-000000000001",
  "google-owner-subject",
);

const employeeIdentity = identity(
  "employee.google@example.com",
  "10000000-0000-4000-8000-000000000002",
  "google-employee-subject",
);

function splitSession(session: IssuedSession): [string, string] {
  const separator = session.sessionToken.indexOf(".");
  if (separator < 1) throw new Error("Invalid test session token");
  return [
    session.sessionToken.slice(0, separator),
    session.sessionToken.slice(separator + 1),
  ];
}

describe.skipIf(!databaseUrl)("Staff Google/Supabase identity integration", () => {
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

  it("seeds the protected Owner allowlist and links Google on first login", async () => {
    const seeded = await testPool!.query<{
      email: string;
      display_name: string;
      phone: string | null;
      access_mode: string;
      is_owner: boolean;
      status: string;
    }>(
      `SELECT email, display_name, phone, access_mode, is_owner, status
         FROM staff_invitations
        WHERE is_owner=true
          AND status='pending'`,
    );
    expect(seeded.rows).toEqual([
      expect.objectContaining({
        email: "midomoaaz3@gmail.com",
        display_name: "Mouaz Mohamad",
        phone: "01104193534",
        access_mode: "google",
        is_owner: true,
        status: "pending",
      }),
    ]);

    ownerSession = await service!.exchangeStaffGoogleIdentity(
      ownerIdentity,
      metadata,
    );
    expect(ownerSession.account.accountType).toBe("staff");
    expect(ownerSession.account.mfaSatisfied).toBe(true);
    expect(ownerSession.account.permissions).toContain("staff.manage");

    const owner = await testPool!.query<{
      email: string;
      password_hash: string | null;
      is_owner: boolean;
      auth_provider: string | null;
      supabase_user_id: string | null;
      provider_subject: string | null;
    }>(
      `SELECT u.email, u.password_hash, s.is_owner, s.auth_provider,
              s.supabase_user_id::text, s.provider_subject
         FROM users u
         JOIN staff_users s ON s.user_id=u.id
        WHERE s.is_owner=true`,
    );
    expect(owner.rows).toHaveLength(1);
    expect(owner.rows[0]).toMatchObject({
      email: "midomoaaz3@gmail.com",
      password_hash: null,
      is_owner: true,
      auth_provider: "google",
      supabase_user_id: ownerIdentity.supabaseUserId,
      provider_subject: ownerIdentity.providerSubject,
    });
  });

  it("reuses the same Owner record on later Google logins", async () => {
    const next = await service!.exchangeStaffGoogleIdentity(
      ownerIdentity,
      metadata,
    );
    expect(next.account.userId).toBe(ownerSession!.account.userId);

    const owners = await testPool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM staff_users WHERE is_owner=true",
    );
    expect(owners.rows[0]?.count).toBe("1");
  });

  it("rejects an unlisted Google account without creating Staff", async () => {
    await expect(
      service!.exchangeStaffGoogleIdentity(
        identity(
          "not-allowed@example.com",
          "10000000-0000-4000-8000-000000000099",
          "not-allowed-subject",
        ),
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "DASHBOARD_ACCESS_DENIED",
      statusCode: 403,
    });

    const count = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM users
        WHERE account_type='staff'
          AND email_normalized='not-allowed@example.com'`,
    );
    expect(count.rows[0]?.count).toBe("0");
  });

  it("allows active Staff, prevents duplicate first-login rows and rejects identity conflicts", async () => {
    const firstAllowance = await service!.createStaffGoogleAllowance(
      ownerSession!.account,
      {
        email: employeeIdentity.email,
        displayName: "Google Employee",
        phone: "",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );
    const retriedAllowance = await service!.createStaffGoogleAllowance(
      ownerSession!.account,
      {
        email: employeeIdentity.email,
        displayName: "Google Employee",
        phone: "",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );
    expect(retriedAllowance.allowanceId).toBe(firstAllowance.allowanceId);
    const pendingAllowances = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM staff_invitations
        WHERE email_normalized=$1
          AND access_mode='google'
          AND status='pending'`,
      [employeeIdentity.emailNormalized],
    );
    expect(pendingAllowances.rows[0]?.count).toBe("1");

    const concurrentIdentity = identity(
      "race.google@example.com",
      "10000000-0000-4000-8000-000000000003",
      "google-race-subject",
    );
    await service!.createStaffGoogleAllowance(
      ownerSession!.account,
      {
        email: concurrentIdentity.email,
        displayName: "Race Employee",
        phone: "",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );

    const concurrent = await Promise.all([
      service!.exchangeStaffGoogleIdentity(concurrentIdentity, metadata),
      service!.exchangeStaffGoogleIdentity(concurrentIdentity, metadata),
    ]);
    expect(concurrent[0].account.userId).toBe(concurrent[1].account.userId);

    const raceRows = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM users
        WHERE account_type='staff'
          AND email_normalized='race.google@example.com'`,
    );
    expect(raceRows.rows[0]?.count).toBe("1");

    staffSession = await service!.exchangeStaffGoogleIdentity(
      employeeIdentity,
      metadata,
    );
    expect(staffSession.account.permissions).toContain("orders.read");
    expect(staffSession.account.permissions).not.toContain("staff.manage");

    await expect(
      service!.exchangeStaffGoogleIdentity(
        {
          ...employeeIdentity,
          providerSubject: "different-google-subject",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "DASHBOARD_ACCESS_DENIED" });

    await service!.createStaffGoogleAllowance(
      ownerSession!.account,
      {
        email: "subject-conflict@example.com",
        displayName: "Subject Conflict",
        phone: "",
        permissionKeys: ["orders.read"],
      },
      metadata,
    );
    await expect(
      service!.exchangeStaffGoogleIdentity(
        identity(
          "subject-conflict@example.com",
          "10000000-0000-4000-8000-000000000004",
          employeeIdentity.providerSubject,
        ),
        metadata,
      ),
    ).rejects.toMatchObject({ code: "DASHBOARD_ACCESS_DENIED" });
  });

  it("revokes sessions when permissions change and immediately applies the new permission set", async () => {
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

    const fresh = await service!.exchangeStaffGoogleIdentity(
      employeeIdentity,
      metadata,
    );
    expect(fresh.account.permissions).toContain("orders.manage");

    const permissionAudit = await testPool!.query<{
      old_values: { permissions: string[] };
      new_values: { permissions: string[] };
    }>(
      `SELECT old_values, new_values
         FROM audit_logs
        WHERE action='STAFF_PERMISSIONS_UPDATED'
          AND entity_id=$1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [fresh.account.userId],
    );
    expect(permissionAudit.rows[0]?.old_values.permissions).toContain(
      "orders.read",
    );
    expect(permissionAudit.rows[0]?.old_values.permissions).not.toContain(
      "orders.manage",
    );
    expect(permissionAudit.rows[0]?.new_values.permissions).toContain(
      "orders.manage",
    );

    const [samePermissionSessionId, samePermissionSecret] = splitSession(fresh);
    await service!.setStaffPermissions(
      ownerSession!.account,
      fresh.account.userId,
      ["orders.read", "orders.manage"],
      metadata,
    );
    await expect(
      service!.authenticate(samePermissionSessionId, samePermissionSecret),
    ).resolves.not.toBeNull();

    staffSession = fresh;
  });

  it("disables Staff immediately, revokes sessions and blocks new Google exchange", async () => {
    const [sessionId, secret] = splitSession(staffSession!);
    await service!.setStaffAccessStatus(
      ownerSession!.account,
      staffSession!.account.userId,
      false,
      "security test disable",
      metadata,
    );
    await expect(service!.authenticate(sessionId, secret)).resolves.toBeNull();
    await expect(
      service!.exchangeStaffGoogleIdentity(employeeIdentity, metadata),
    ).rejects.toMatchObject({ code: "DASHBOARD_ACCESS_DENIED" });

    await service!.setStaffAccessStatus(
      ownerSession!.account,
      staffSession!.account.userId,
      true,
      "reactivated",
      metadata,
    );
    const accessAudit = await testPool!.query<{
      old_values: { status: string };
      new_values: { status: string };
    }>(
      `SELECT old_values, new_values
         FROM audit_logs
        WHERE action='STAFF_ACCOUNT_DISABLED'
          AND entity_id=$1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [staffSession!.account.userId],
    );
    expect(accessAudit.rows[0]?.old_values).toEqual({
      status: "active",
    });
    expect(accessAudit.rows[0]?.new_values).toEqual({
      status: "suspended",
    });

    staffSession = await service!.exchangeStaffGoogleIdentity(
      employeeIdentity,
      metadata,
    );
    expect(staffSession.account.status).toBe("active");

    const [sameStatusSessionId, sameStatusSecret] = splitSession(staffSession);
    await service!.setStaffAccessStatus(
      ownerSession!.account,
      staffSession.account.userId,
      true,
      "duplicate active retry",
      metadata,
    );
    await expect(
      service!.authenticate(sameStatusSessionId, sameStatusSecret),
    ).resolves.not.toBeNull();
  });

  it("supports explicit Staff session revocation and logout", async () => {
    const first = await service!.exchangeStaffGoogleIdentity(
      employeeIdentity,
      metadata,
    );
    const [firstId, firstSecret] = splitSession(first);
    await service!.revokeStaffSessions(
      ownerSession!.account,
      first.account.userId,
      metadata,
    );
    await expect(service!.authenticate(firstId, firstSecret)).resolves.toBeNull();

    const second = await service!.exchangeStaffGoogleIdentity(
      employeeIdentity,
      metadata,
    );
    const [secondId, secondSecret] = splitSession(second);
    await service!.logout(second.account, false, metadata);
    await expect(service!.authenticate(secondId, secondSecret)).resolves.toBeNull();
  });

  it("protects the single Owner against disable, delete, demotion and a second Owner", async () => {
    await expect(
      testPool!.query(
        "UPDATE users SET status='suspended' WHERE id=$1",
        [ownerSession!.account.userId],
      ),
    ).rejects.toThrow("protected Dart Owner");

    await expect(
      testPool!.query(
        "UPDATE staff_users SET is_owner=false WHERE user_id=$1",
        [ownerSession!.account.userId],
      ),
    ).rejects.toThrow("protected Dart Owner");

    await expect(
      testPool!.query(
        "DELETE FROM users WHERE id=$1",
        [ownerSession!.account.userId],
      ),
    ).rejects.toThrow("protected Dart Owner");

    await expect(
      testPool!.query(
        "UPDATE users SET email='other-owner@example.com', email_normalized='other-owner@example.com' WHERE id=$1",
        [ownerSession!.account.userId],
      ),
    ).rejects.toThrow("break-glass recovery");

    const secondOwnerUser = randomUUID();
    const client = await testPool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (
           id, account_type, email, email_normalized, password_hash,
           status, email_verified_at, must_change_password
         ) VALUES (
           $1,'staff','second-owner@example.com','second-owner@example.com',
           NULL,'active',now(),false
         )`,
        [secondOwnerUser],
      );
      await expect(
        client.query(
          `INSERT INTO staff_users (
             user_id, display_name, is_owner, mfa_required
           ) VALUES ($1,'Second Owner',true,false)`,
          [secondOwnerUser],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
