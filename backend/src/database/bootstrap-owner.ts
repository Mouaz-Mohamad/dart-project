import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { normalizeEmail, normalizeEgyptianPhone } from "../security/normalization.js";
import { hashPassword, validatePasswordPolicy } from "../security/password.js";
import { createDatabasePool } from "./pool.js";

const PROTECTED_OWNER_EMAIL = "midomoaaz3@gmail.com";

interface OwnerInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

function readOwnerInput(source: NodeJS.ProcessEnv): OwnerInput {
  const input = {
    name: source.DART_OWNER_NAME?.trim() ?? "",
    email: source.DART_OWNER_EMAIL?.trim() ?? "",
    phone: source.DART_OWNER_PHONE?.trim() ?? "",
    password: source.DART_OWNER_PASSWORD ?? "",
  };
  const missing = Object.entries(input)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`Missing owner bootstrap values: ${missing.join(", ")}`);
  if (normalizeEmail(input.email) !== PROTECTED_OWNER_EMAIL) {
    throw new Error(
      "Legacy Owner bootstrap is restricted to the protected Dart Owner email",
    );
  }
  const passwordProblems = validatePasswordPolicy(input.password);
  if (passwordProblems.length > 0) throw new Error(passwordProblems.join("; "));
  return input;
}

export async function bootstrapOwner(source: NodeJS.ProcessEnv = process.env): Promise<string> {
  const config = loadConfig(source);
  const logger = createLogger(config);
  const pool = createDatabasePool(config);
  const input = readOwnerInput(source);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownerExists = await client.query("SELECT 1 FROM staff_users WHERE is_owner FOR UPDATE");
    if (ownerExists.rowCount) throw new Error("The protected Owner account already exists");
    const userId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await client.query(
      `INSERT INTO users (
        id, account_type, email, email_normalized, password_hash,
        status, email_verified_at
      ) VALUES ($1, 'staff', $2, $3, $4, 'active', now())`,
      [userId, input.email, normalizeEmail(input.email), passwordHash],
    );
    await client.query(
      `INSERT INTO account_phones (
        user_id, account_type, phone_normalized, phone_display, is_primary, verified_at
      ) VALUES ($1, 'staff', $2, $3, true, now())`,
      [userId, normalizeEgyptianPhone(input.phone), input.phone],
    );
    await client.query(
      `INSERT INTO staff_users (user_id, display_name, is_owner, mfa_required)
       VALUES ($1, $2, true, true)`,
      [userId, input.name],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'Owner'`,
      [userId],
    );
    await client.query(
      `INSERT INTO audit_logs (
        actor_type, actor_id, action, entity_type, entity_id, metadata
      ) VALUES ('system', NULL, 'OWNER_BOOTSTRAPPED', 'staff_users', $1, $2::jsonb)`,
      [userId, JSON.stringify({ mfaRequired: true })],
    );
    await client.query("COMMIT");
    logger.warn(
      { ownerUserId: userId },
      "Legacy protected Owner bootstrap used; migrate this Owner to Google identity before disabling rollback auth",
    );
    return userId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  bootstrapOwner().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Owner bootstrap failed"}\n`);
    process.exitCode = 1;
  });
}
