import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { decryptSecret } from "../src/security/crypto.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_identity_${randomUUID().replaceAll("-", "")}`;
let adminPool: Pool | undefined;
let testPool: Pool | undefined;
let service: IdentityService | undefined;

const authConfig: Pick<
  AppConfig,
  "authPepper" | "sessionTtlDays" | "emailOtpTtlMinutes" | "mfaEncryptionKey"
> = {
  authPepper: "integration-test-auth-pepper-32-characters-long",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 4),
};

const requestMetadata = {
  requestId: "identity-integration-test",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

describe.skipIf(!databaseUrl)("identity service", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    testPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
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

  it("registers, verifies and signs in a customer without exposing the OTP in logs", async () => {
    const registration = await service!.registerCustomer(
      {
        name: "Mouaz Mohammed",
        email: "Mouaz@Example.com",
        phone1: "01012345678",
        birthday: "2008-09-02",
        password: "StrongPassword123",
      },
      requestMetadata,
    );

    await expect(
      service!.login("customer", "mouaz@example.com", "StrongPassword123", requestMetadata),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    const event = await testPool!.query<{ payload: { encryptedParameters: { otp: string } } }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1",
      [registration.userId],
    );
    const otp = decryptSecret(
      Buffer.from(event.rows[0]!.payload.encryptedParameters.otp, "base64"),
      authConfig.mfaEncryptionKey,
    );
    const session = await service!.verifyCustomerEmail(registration.challengeId, otp, requestMetadata);
    expect(session.account.accountType).toBe("customer");
    expect(session.sessionToken).not.toContain(otp);

    const profile = await service!.profile(session.account);
    expect(profile.email).toBe("Mouaz@Example.com");
    expect(profile.code).toMatch(/^DR-/);

    const signedIn = await service!.login(
      "customer",
      "01012345678",
      "StrongPassword123",
      requestMetadata,
    );
    expect(signedIn.account.permissions).toContain("profile.read_own");
  });

  it("rejects duplicate customer identities but permits the same contact in another realm", async () => {
    await expect(
      service!.registerCustomer(
        {
          name: "Duplicate Customer",
          email: "mouaz@example.com",
          phone1: "01099999999",
          password: "StrongPassword123",
        },
        requestMetadata,
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ALREADY_EXISTS" });

    const representative = await service!.registerRepresentative(
      {
        name: "Mouaz Representative",
        email: "mouaz@example.com",
        phone1: "01012345678",
        nationalId: "29901011234567",
        password: "StrongPassword123",
      },
      requestMetadata,
    );
    expect(representative.status).toBe("pending_approval");
    await expect(
      service!.login("representative", representative.representativeCode, "StrongPassword123", requestMetadata),
    ).rejects.toEqual(expect.objectContaining({ code: "REPRESENTATIVE_NOT_APPROVED" }));
  });
});
