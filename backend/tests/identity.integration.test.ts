// DART CODE GUIDE | backend/tests/identity.integration.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
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
  | "authPepper"
  | "sessionTtlDays"
  | "emailOtpTtlMinutes"
  | "mfaEncryptionKey"
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
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

  it("registers and signs in a customer without creating a signup OTP", async () => {
    const registration = await service!.registerCustomer(
      {
        name: "Mouaz Mohammed",
        email: "Mouaz@Example.com",
        phone1: "01012345678",
        birthday: "2008-09-02",
        password: "abcd1234",
      },
      requestMetadata,
    );

    expect(registration.account.accountType).toBe("customer");
    expect(registration.account.status).toBe("active");

    const otpEvents = await testPool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outbox_events
        WHERE aggregate_id = $1
          AND event_type='EMAIL_VERIFICATION_REQUESTED'`,
      [registration.account.userId],
    );
    expect(Number(otpEvents.rows[0]!.count)).toBe(0);

    const profile = await service!.profile(registration.account);
    expect(profile.email).toBe("Mouaz@Example.com");
    expect(profile.code).toMatch(/^DR-/);

    const signedIn = await service!.login(
      "customer",
      "01012345678",
      "abcd1234",
      requestMetadata,
    );
    expect(signedIn.account.permissions).toContain("profile.read_own");
  });

  it("keeps the protected Owner email allowlist authoritative over legacy bootstrap configuration", async () => {
    const stranger = await service!.startStaffEmailAccess(
      "not-allowed@example.com",
      requestMetadata,
    );
    expect(stranger.deliveryQueued).toBe(false);

    const legacyConfiguredOwner = await service!.startStaffEmailAccess(
      "BOOTSTRAP-OWNER@example.com",
      requestMetadata,
    );
    expect(legacyConfiguredOwner.deliveryQueued).toBe(false);

    const invitation = await testPool!.query<{
      display_name: string;
      is_owner: boolean;
      status: string;
      access_mode: string;
      mfa_required: boolean;
    }>(
      `SELECT display_name, is_owner, status, access_mode, mfa_required
         FROM staff_invitations
        WHERE email_normalized='midomoaaz3@gmail.com'`,
    );
    expect(invitation.rows[0]).toMatchObject({
      display_name: "Mouaz Mohamad",
      is_owner: true,
      status: "pending",
      access_mode: "email_otp",
      mfa_required: false,
    });
  });

  it("queues the protected Owner verification code through email without password or TOTP setup", async () => {
    const challenge = await service!.startStaffEmailAccess(
      "midomoaaz3@gmail.com",
      requestMetadata,
    );
    expect(challenge.deliveryQueued).toBe(true);

    const event = await testPool!.query<{
      payload: {
        channel: string;
        to: string;
        encryptedParameters: { otp: string };
      };
    }>(
      `SELECT payload FROM outbox_events WHERE deduplication_key=$1 LIMIT 1`,
      [`staff-email-access-code:${challenge.challengeId}`],
    );
    expect(event.rows[0]!.payload.channel).toBe("email");
    expect(event.rows[0]!.payload.to).toBe("midomoaaz3@gmail.com");
    const otp = decryptSecret(
      Buffer.from(event.rows[0]!.payload.encryptedParameters.otp, "base64"),
      authConfig.mfaEncryptionKey,
    );
    expect(otp).toMatch(/^\d{6}$/);
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
        address: "10 Test Street, Cairo, Egypt",
        password: "StrongPassword123",
        idFrontImage: tinyPng,
        idBackImage: tinyPng,
        faceImage: tinyPng,
      },
      requestMetadata,
    );
    expect(representative.status).toBe("pending_approval");
    const documents = await testPool!.query<{
      document_type: string;
      content_type: string;
      byte_size: number;
      encrypted_payload: Buffer;
    }>(
      `SELECT document_type, content_type, byte_size, encrypted_payload
         FROM representative_documents
        WHERE representative_user_id=$1
        ORDER BY document_type`,
      [representative.userId],
    );
    expect(documents.rows.map((row) => row.document_type)).toEqual([
      "face",
      "id_back",
      "id_front",
    ]);
    for (const row of documents.rows) {
      expect(row.content_type).toBe("image/png");
      expect(row.byte_size).toBeGreaterThan(0);
      expect(Buffer.isBuffer(row.encrypted_payload)).toBe(true);
      expect(row.encrypted_payload.toString("utf8")).not.toContain("data:image");
    }
    await expect(
      service!.login("representative", representative.representativeCode, "StrongPassword123", requestMetadata),
    ).rejects.toEqual(expect.objectContaining({ code: "REPRESENTATIVE_NOT_APPROVED" }));
  });
});
