// DART CODE GUIDE | backend/src/security/password.ts
// الغرض: وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة.
const PASSWORD_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

let argon2Module: Promise<typeof argon2> | undefined;

function loadArgon2(): Promise<typeof argon2> {
  argon2Module ??= import("argon2").then((module) => module.default);
  return argon2Module;
}

export function validateCustomerPasswordPolicy(password: string): string[] {
  return password.length < 8
    ? ["Password must contain at least 8 characters"]
    : [];
}

export function validatePasswordPolicy(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Password must contain at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("Password must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("Password must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("Password must contain a number");
  return problems;
}

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await loadArgon2();
  return argon2.hash(password, { ...PASSWORD_OPTIONS, type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    const argon2 = await loadArgon2();
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
import type argon2 from "argon2";
