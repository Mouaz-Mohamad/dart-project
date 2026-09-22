import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/security/crypto.js";
import { normalizeEgyptianPhone } from "../src/security/normalization.js";
import {
  hashPassword,
  validateCustomerPasswordPolicy,
  validatePasswordPolicy,
  verifyPassword,
} from "../src/security/password.js";
import { parseSessionToken, serializeSessionToken } from "../src/security/session-token.js";

describe("identity security primitives", () => {
  it("hashes passwords with Argon2id and rejects the wrong password", async () => {
    const hash = await hashPassword("StrongPassword123");
    expect(hash).toContain("$argon2id$");
    await expect(verifyPassword(hash, "StrongPassword123")).resolves.toBe(true);
    await expect(verifyPassword(hash, "WrongPassword123")).resolves.toBe(false);
  });

  it("keeps representative passwords strong while allowing 4+ character customer passwords", () => {
    expect(validateCustomerPasswordPolicy("abc")).not.toHaveLength(0);
    expect(validateCustomerPasswordPolicy("abcd")).toEqual([]);
    expect(validatePasswordPolicy("short")).not.toHaveLength(0);
    expect(validatePasswordPolicy("StrongPassword123")).toEqual([]);
  });

  it("normalizes Egyptian mobile numbers and rejects unsupported numbers", () => {
    expect(normalizeEgyptianPhone("010 1234 5678")).toBe("201012345678");
    expect(() => normalizeEgyptianPhone("12345")).toThrow("INVALID_EGYPTIAN_PHONE");
  });

  it("round-trips session tokens and encrypted application secrets", () => {
    const token = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      secret: "a".repeat(43),
    };
    expect(parseSessionToken(serializeSessionToken(token))).toEqual(token);
    expect(parseSessionToken("invalid")).toBeNull();

    const key = Buffer.alloc(32, 9);
    const ciphertext = encryptSecret("otp-secret", key);
    expect(ciphertext.toString()).not.toContain("otp-secret");
    expect(decryptSecret(ciphertext, key)).toBe("otp-secret");
  });
});
