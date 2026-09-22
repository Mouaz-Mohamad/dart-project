import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/env.js";
import { createDatabasePool } from "./pool.js";
import { normalizeEmail } from "../security/normalization.js";
import { digest } from "../security/crypto.js";

interface RecoveryInput {
  email: string;
  reason: string;
}

function readArg(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function readInput(): RecoveryInput {
  const email = readArg("--email");
  const reason = readArg("--reason");
  if (!email || !reason) {
    throw new Error(
      "Usage: npm run admin:recover-owner-google -- --email <gmail> --reason <reason>",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid recovery email");
  }
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("Recovery reason must be 8-500 characters");
  }
  return { email, reason };
}

export async function recoverOwnerGoogleIdentity(
  source: NodeJS.ProcessEnv = process.env,
  inputOverride?: RecoveryInput,
): Promise<"active_owner" | "pending_owner"> {
  const config = loadConfig(source);
  const input = inputOverride ?? readInput();
  const emailNormalized = normalizeEmail(input.email);
  const emailHash = digest(
    `staff-google-email:${emailNormalized}`,
    config.authPepper,
  );
  const pool = createDatabasePool(config);
  await pool.query(
    `INSERT INTO audit_logs (
       actor_type, actor_id, action, entity_type, entity_id, metadata
     ) VALUES (
       'system',NULL,'OWNER_BREAK_GLASS_ATTEMPTED','staff_users','owner',$1::jsonb
     )`,
    [JSON.stringify({ emailHash, reason: input.reason })],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('dart-owner-break-glass',0))",
    );

    const emailConflict = await client.query<{ id: string }>(
      `SELECT id::text
         FROM users
        WHERE account_type='staff'
          AND email_normalized=$1
          AND deleted_at IS NULL
        LIMIT 1`,
      [emailNormalized],
    );
    const pendingStaffConflict = await client.query<{ id: string }>(
      `SELECT id::text
         FROM staff_invitations
        WHERE email_normalized=$1
          AND status='pending'
          AND is_owner=false
        LIMIT 1
        FOR UPDATE`,
      [emailNormalized],
    );
    if (pendingStaffConflict.rows[0]) {
      throw new Error(
        "Recovery email is already reserved by a pending Staff allowance",
      );
    }

    const owner = await client.query<{
      user_id: string;
      email_normalized: string;
    }>(
      `SELECT s.user_id::text, u.email_normalized
         FROM staff_users s
         JOIN users u ON u.id=s.user_id
        WHERE s.is_owner=true
          AND u.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF s, u`,
    );

    if (owner.rows[0]) {
      if (
        emailConflict.rows[0] &&
        emailConflict.rows[0].id !== owner.rows[0].user_id
      ) {
        throw new Error(
          "Recovery email is already assigned to another Staff account",
        );
      }

      const userId = owner.rows[0].user_id;
      await client.query("SET LOCAL dart.owner_break_glass = 'on'");
      await client.query(
        `UPDATE users
            SET email=$2,
                email_normalized=$3,
                email_verified_at=now(),
                session_version=session_version+1,
                updated_at=now(),
                version=version+1
          WHERE id=$1`,
        [userId, input.email.trim(), emailNormalized],
      );
      await client.query(
        `UPDATE staff_users
            SET auth_provider=NULL,
                supabase_user_id=NULL,
                provider_subject=NULL,
                identity_linked_at=NULL,
                identity_last_login_at=NULL,
                updated_at=now()
          WHERE user_id=$1`,
        [userId],
      );
      await client.query(
        `UPDATE sessions
            SET revoked_at=COALESCE(revoked_at,now()),
                revoke_reason=COALESCE(revoke_reason,'owner_break_glass')
          WHERE user_id=$1
            AND revoked_at IS NULL`,
        [userId],
      );
      const oldOwnerEmailHash = digest(
        `staff-google-email:${owner.rows[0].email_normalized}`,
        config.authPepper,
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id,
           old_values, new_values, metadata
         ) VALUES (
           'system',NULL,'OWNER_BREAK_GLASS_SUCCEEDED','staff_users',
           $1,$2::jsonb,$3::jsonb,$4::jsonb
         )`,
        [
          userId,
          JSON.stringify({ emailHash: oldOwnerEmailHash }),
          JSON.stringify({ emailHash }),
          JSON.stringify({
            reason: input.reason,
            mode: "active_owner",
          }),
        ],
      );
      await client.query("COMMIT");
      return "active_owner";
    }

    const pendingOwner = await client.query<{
      id: string;
      email_normalized: string;
    }>(
      `SELECT id::text, email_normalized
         FROM staff_invitations
        WHERE is_owner=true
          AND status='pending'
        LIMIT 1
        FOR UPDATE`,
    );
    if (!pendingOwner.rows[0]) {
      throw new Error("No protected Owner or pending Owner grant exists");
    }

    await client.query(
      `UPDATE staff_invitations
          SET email=$2,
              email_normalized=$3,
              access_mode='google',
              mfa_required=false,
              expires_at=NULL,
              updated_at=now()
        WHERE id=$1`,
      [pendingOwner.rows[0].id, input.email.trim(), emailNormalized],
    );
    const oldPendingEmailHash = digest(
      `staff-google-email:${pendingOwner.rows[0].email_normalized}`,
      config.authPepper,
    );
    await client.query(
      `INSERT INTO audit_logs (
         actor_type, actor_id, action, entity_type, entity_id,
         old_values, new_values, metadata
       ) VALUES (
         'system',NULL,'OWNER_BREAK_GLASS_SUCCEEDED','staff_invitations',
         $1,$2::jsonb,$3::jsonb,$4::jsonb
       )`,
      [
        pendingOwner.rows[0].id,
        JSON.stringify({ emailHash: oldPendingEmailHash }),
        JSON.stringify({ emailHash }),
        JSON.stringify({
          reason: input.reason,
          mode: "pending_owner",
        }),
      ],
    );
    await client.query("COMMIT");
    return "pending_owner";
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    try {
      await pool.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, metadata
         ) VALUES (
           'system',NULL,'OWNER_BREAK_GLASS_FAILED','staff_users','owner',$1::jsonb
         )`,
        [
          JSON.stringify({
            emailHash,
            reason: input.reason,
            errorName: error instanceof Error ? error.name : "Error",
          }),
        ],
      );
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryPoint) {
  recoverOwnerGoogleIdentity()
    .then((mode) => {
      process.stdout.write(
        `Owner Google recovery prepared (${mode}).\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Owner recovery failed"}\n`,
      );
      process.exitCode = 1;
    });
}
