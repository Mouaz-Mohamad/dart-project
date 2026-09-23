// DART CODE GUIDE | backend/src/security/password.ts
// الغرض: وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة.
import argon2 from "argon2";

export interface PasswordHashOptions {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

const defaultOptions: PasswordHashOptions = {
  memoryCost: 19456,
  timeCost: 3,
  parallelism: 1,
};

export function validatePasswordPolicy(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Password must contain at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("Password must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("Password must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("Password must contain a digit");
  return problems;
}

// Customer passwords intentionally optimize for a simple clothing-store signup.
// The only composition rule is length; letters, digits, spaces and symbols are allowed.
export function validateCustomerPasswordPolicy(password: string): string[] {
  return password.length < 6
    ? ["Password must contain at least 6 characters"]
    : [];
}

export async function hashPassword(
  password: string,
  options: PasswordHashOptions = defaultOptions,
): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: options.memoryCost,
    timeCost: options.timeCost,
    parallelism: options.parallelism,
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
