import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { generate as generateTotp } from "otplib";
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
  | "staffInviteOtpTtlHours"
  | "corsOrigins"
  | "ownerBootstrapEmail"
  | "ownerBootstrapName"
> = {
  authPepper: "integration-test-auth-pepper-32-characters-long",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 4),
  staffInviteOtpTtlHours: 48,
  corsOrigins: ["https://dart.example"],
  ownerBootstrapEmail: "bootstrap-owner@example.com",
  ownerBootstrapName: "Bootstrap Owner",
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

  it("keeps the protected Owner allowlist authoritative over legacy bootstrap configuration", async () => {
    const stranger = await service!.startStaffOnboarding(
      "not-invited@example.com",
      requestMetadata,
    );
    expect(stranger.deliveryQueued).toBe(false);

    const legacyConfiguredOwner = await service!.startStaffOnboarding(
      "BOOTSTRAP-OWNER@example.com",
      requestMetadata,
    );
    expect(legacyConfiguredOwner.deliveryQueued).toBe(false);

    const invitation = await testPool!.query<{
      display_name: string;
      is_owner: boolean;
      status: string;
      access_mode: string;
    }>(
      `SELECT display_name, is_owner, status, access_mode
         FROM staff_invitations
        WHERE email_normalized='midomoaaz3@gmail.com'`,
    );
    expect(invitation.rows[0]).toMatchObject({
      display_name: "Mouaz Mohamad",
      is_owner: true,
      status: "pending",
      access_mode: "google",
    });
  });

  it("activates the Owner and invited Staff using email OTPs without WhatsApp", async () => {
    const onboarding = await service!.startStaffOnboarding(
      "midomoaaz3@gmail.com",
      requestMetadata,
    );
    const event = await testPool!.query<{
      payload: {
        channel: string;
        to: string;
        encryptedParameters: { otp: string };
      };
    }>(
      `SELECT payload FROM outbox_events WHERE deduplication_key=$1 LIMIT 1`,
      [`staff-onboarding-code:${onboarding.challengeId}`],
    );
    expect(event.rows[0]!.payload.channel).toBe("email");
    expect(event.rows[0]!.payload.to).toBe("midomoaaz3@gmail.com");
    const otp = decryptSecret(
      Buffer.from(event.rows[0]!.payload.encryptedParameters.otp, "base64"),
      authConfig.mfaEncryptionKey,
    );
    const verified = await service!.verifyStaffOnboarding(
      onboarding.challengeId,
      otp,
      requestMetadata,
    );
    const session = await service!.completeStaffOnboarding(
      onboarding.challengeId,
      verified.setupToken,
      "OwnerStrongPassword123",
      requestMetadata,
    );
    expect(session.account.accountType).toBe("staff");
    expect(session.account.mfaRequired).toBe(true);

    const ownerBootstrapAfterActivation = await service!.startStaffOnboarding(
      "bootstrap-owner@example.com",
      requestMetadata,
    );
    expect(ownerBootstrapAfterActivation.deliveryQueued).toBe(false);

    expect(session.account.permissions).toContain("staff.manage");
    await expect(
      service!.createStaffInvitation(
        session.account,
        {
          email: "blocked-before-mfa@example.com",
          phone: "",
          displayName: "Blocked Before MFA",
          permissionKeys: ["orders.read"],
          mfaRequired: false,
        },
        requestMetadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const mfaSetup = await service!.setupMfa(session.account);
    const mfaToken = await generateTotp({ secret: mfaSetup.secret });
    await service!.confirmMfa(session.account, mfaToken, requestMetadata);

    const separator = session.sessionToken.indexOf(".");
    expect(separator).toBeGreaterThan(0);
    const ownerAccount = await service!.authenticate(
      session.sessionToken.slice(0, separator),
      session.sessionToken.slice(separator + 1),
    );
    expect(ownerAccount?.mfaSatisfied).toBe(true);
    expect(ownerAccount?.permissions).toContain("staff.manage");

    const invitation = await service!.createStaffInvitation(
      ownerAccount!,
      {
        email: "staff@example.com",
        phone: "",
        displayName: "Test Staff",
        permissionKeys: ["orders.read"],
        mfaRequired: false,
      },
      requestMetadata,
    );
    const staffEvent = await testPool!.query<{
      payload: { channel: string; to: string; encryptedParameters: { otp: string } };
    }>(
      `SELECT payload FROM outbox_events WHERE deduplication_key=$1`,
      [`staff-onboarding-code:${invitation.challengeId}`],
    );
    expect(staffEvent.rows[0]!.payload).toMatchObject({
      channel: "email",
      to: "staff@example.com",
    });
    const staffOtp = decryptSecret(
      Buffer.from(staffEvent.rows[0]!.payload.encryptedParameters.otp, "base64"),
      authConfig.mfaEncryptionKey,
    );
    const staffVerified = await service!.verifyStaffOnboarding(
      invitation.challengeId,
      staffOtp,
      requestMetadata,
    );
    const staffSession = await service!.completeStaffOnboarding(
      invitation.challengeId,
      staffVerified.setupToken,
      "StaffStrongPassword123",
      requestMetadata,
    );
    expect(staffSession.account.mfaRequired).toBe(false);
    expect(staffSession.account.permissions).toContain("orders.read");
    expect(staffSession.account.permissions).not.toContain("staff.manage");
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
