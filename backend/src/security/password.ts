import argon2 from "argon2";

const PASSWORD_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function validatePasswordPolicy(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Password must contain at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("Password must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("Password must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("Password must contain a number");
  return problems;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
