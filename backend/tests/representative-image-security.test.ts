// DART CODE GUIDE | backend/tests/representative-image-security.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";

const config: Pick<
  AppConfig,
  "authPepper" | "sessionTtlDays" | "emailOtpTtlMinutes" | "mfaEncryptionKey"
> = {
  authPepper: "representative-image-test-pepper-32-characters",
  sessionTtlDays: 30,
  emailOtpTtlMinutes: 10,
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

const metadata = {
  requestId: "representative-image-security",
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

function service(): IdentityService {
  // Invalid files are rejected before any database connection is attempted.
  return new IdentityService({} as Pool, config);
}

function application(image: string) {
  return service().registerRepresentative(
    {
      name: "Security Test Representative",
      email: "security-rep@example.com",
      phone1: "01012345678",
      nationalId: "29901011234567",
      address: "10 Test Street, Cairo, Egypt",
      password: "StrongPassword123",
      idFrontImage: image,
      idBackImage: image,
      faceImage: image,
    },
    metadata,
  );
}

describe("representative verification image security", () => {
  it("rejects arbitrary bytes even when the data URL claims an allowed MIME type", async () => {
    const fakeWebp = `data:image/webp;base64,${Buffer.from("not-an-image").toString("base64")}`;
    await expect(application(fakeWebp)).rejects.toMatchObject({
      code: "REPRESENTATIVE_IMAGE_SIGNATURE_MISMATCH",
      statusCode: 422,
    });
  });

  it("rejects a valid PNG signature when it is falsely declared as WebP", async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const disguised = `data:image/webp;base64,${pngBytes.toString("base64")}`;
    await expect(application(disguised)).rejects.toMatchObject({
      code: "REPRESENTATIVE_IMAGE_SIGNATURE_MISMATCH",
      statusCode: 422,
    });
  });
});
