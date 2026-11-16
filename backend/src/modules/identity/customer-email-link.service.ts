// Email-only verification of a legacy phone's new address. The OTP never signs in
// or assigns that email to the existing customer: Owner review is mandatory.
import { randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { digest, encryptSecret, safeEqual } from "../../security/crypto.js";
import { normalizeEmail, normalizeEgyptianPhone } from "../../security/normalization.js";
import type { AuthenticatedAccount, RequestMetadata } from "./identity.types.js";

interface LinkRow {
  id: string;
  customer_user_id: string;
  phone_normalized: string;
  email: string;
  email_normalized: string;
  code_hash: string;
  attempts_remaining: number;
  expires_at: Date;
  verified_at: Date | null;
  status: string;
}
export interface LinkStartResult {
  challengeId: string;
  expiresAt: string;
  email: string;
  sent: boolean;
}

export class CustomerEmailLinkService {
  public constructor(
    private readonly pool: Pool,
    private readonly config: Pick<AppConfig, "authPepper" | "mfaEncryptionKey" | "emailOtpTtlMinutes">,
  ) {}

  public async start(phoneInput: string, emailInput: string): Promise<LinkStartResult> {
    let phone: string;
    let email: string;
    try {
      phone = normalizeEgyptianPhone(phoneInput);
      email = normalizeEmail(emailInput);
    } catch {
      throw new AppError(422, "CONTACT_INVALID", "Enter a valid Egyptian phone number and email.");
    }
    const expiresAt = new Date(Date.now() + this.config.emailOtpTtlMinutes * 60_000);
    const generic = (): LinkStartResult => ({
      challengeId: randomUUID(), expiresAt: expiresAt.toISOString(), email: emailInput.trim(), sent: false,
    });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["customer-email-link:" + phone],
      );
      const target = await client.query<{ id: string }>(
        `SELECT u.id::text FROM users u
          WHERE u.account_type='customer' AND u.status='active' AND u.deleted_at IS NULL
            AND u.email IS NULL AND u.email_normalized IS NULL
            AND EXISTS (SELECT 1 FROM account_phones p WHERE p.user_id=u.id
              AND p.account_type='customer' AND p.is_primary AND p.phone_normalized=$1)
          LIMIT 1`, [phone],
      );
      const duplicate = await client.query<{ present: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email_normalized=$1) AS present",
        [email],
      );
      if (!target.rows[0] || duplicate.rows[0]?.present) {
        await client.query("COMMIT");
        return generic(); // Unknown phone and ineligible accounts are indistinguishable.
      }
      const recent = await client.query<{
        id: string; phone_normalized: string; email_normalized: string;
        status: string; created_at: Date; expires_at: Date;
      }>(
        `SELECT id::text,phone_normalized,email_normalized,status,created_at,expires_at
           FROM customer_email_link_requests
          WHERE (phone_normalized=$1 OR email_normalized=$2)
            AND created_at>now()-interval '15 minutes'
          ORDER BY created_at DESC LIMIT 5`, [phone, email],
      );
      if (recent.rows.length >= 3 ||
        (recent.rows[0] && recent.rows[0].created_at.getTime() > Date.now() - 60_000)) {
        await client.query("COMMIT");
        const last = recent.rows[0];
        // A rapid repeat must not replace a still-valid code with a fake challenge.
        if (last?.phone_normalized === phone && last.email_normalized === email
          && last.status === "unverified" && last.expires_at.getTime() > Date.now()) {
          return { challengeId: last.id, expiresAt: last.expires_at.toISOString(),
            email: emailInput.trim(), sent: false };
        }
        return generic();
      }
      const challengeId = randomUUID();
      const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await client.query(
        `INSERT INTO customer_email_link_requests
          (id,customer_user_id,phone_normalized,email,email_normalized,code_hash,expires_at)
          VALUES($1,$2::uuid,$3,$4,$5,$6,$7)`,
        [challengeId, target.rows[0].id, phone, emailInput.trim(), email,
          digest("customer-email-link:" + challengeId + ":" + otp, this.config.authPepper), expiresAt],
      );
      await client.query(
        `INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
          VALUES('customer_auth',$1,'CUSTOMER_EMAIL_LINK_OTP_REQUESTED',$2::jsonb,$3)`,
        [challengeId, JSON.stringify({
          channel: "email", to: emailInput.trim(), encryptedParameters: {
            otp: encryptSecret(otp, this.config.mfaEncryptionKey).toString("base64"),
          }, expiresAt: expiresAt.toISOString(),
        }), "customer-email-link:" + challengeId],
      );
      await client.query("COMMIT");
      return { challengeId, expiresAt: expiresAt.toISOString(), email: emailInput.trim(), sent: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  public async verify(challengeId: string, code: string): Promise<{ reviewPending: true }> {
    const client = await this.pool.connect();
    let badCode = false;
    try {
      await client.query("BEGIN");
      const selected = await client.query<LinkRow>(
        "SELECT * FROM customer_email_link_requests WHERE id=$1 FOR UPDATE", [challengeId],
      );
      const row = selected.rows[0];
      if (!row || row.status !== "unverified" || row.expires_at.getTime() <= Date.now()
        || row.attempts_remaining <= 0) {
        throw new AppError(400, "OTP_INVALID", "This verification code is invalid or expired.");
      }
      if (!safeEqual(digest("customer-email-link:" + challengeId + ":" + code,
        this.config.authPepper), row.code_hash)) {
        await client.query(
          "UPDATE customer_email_link_requests SET attempts_remaining=GREATEST(0,attempts_remaining-1) WHERE id=$1",
          [challengeId],
        );
        badCode = true;
      } else {
        const eligible = await client.query<{ id: string }>(
          `SELECT u.id::text FROM users u WHERE u.id=$1::uuid AND u.account_type='customer'
            AND u.status='active' AND u.deleted_at IS NULL
            AND u.email IS NULL AND u.email_normalized IS NULL
            AND EXISTS (SELECT 1 FROM account_phones p WHERE p.user_id=u.id
              AND p.account_type='customer' AND p.is_primary AND p.phone_normalized=$2)
            FOR UPDATE`, [row.customer_user_id, row.phone_normalized],
        );
        if (!eligible.rows[0]) throw new AppError(409, "LINK_UNAVAILABLE",
          "This request can no longer be linked. Contact Dart support.");
        await client.query(
          `UPDATE customer_email_link_requests SET status='superseded'
           WHERE customer_user_id=$1 AND email_normalized=$2 AND status='pending_review'`,
          [row.customer_user_id, row.email_normalized],
        );
        await client.query(
          `UPDATE customer_email_link_requests SET status='pending_review',verified_at=now()
           WHERE id=$1`, [challengeId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    if (badCode) throw new AppError(400, "OTP_INVALID", "The code is incorrect.");
    // Never set a session cookie, mark email verified on users, or return customer records.
    return { reviewPending: true };
  }

  private async ownerOnly(actor: AuthenticatedAccount): Promise<void> {
    if (actor.accountType !== "staff" || !actor.mfaSatisfied ||
      !actor.permissions.includes("staff.manage")) {
      throw new AppError(403, "FORBIDDEN", "Owner verification required");
    }
    const owner = await this.pool.query<{ is_owner: boolean }>(
      "SELECT is_owner FROM staff_users WHERE user_id=$1", [actor.userId],
    );
    if (!owner.rows[0]?.is_owner) throw new AppError(403, "OWNER_REQUIRED",
      "Only the Dart Owner may review email links");
  }

  public async pending(actor: AuthenticatedAccount) {
    await this.ownerOnly(actor);
    const result = await this.pool.query<{
      id: string; phone_normalized: string; email: string; full_name: string;
      client_code: string; created_at: Date; verified_at: Date | null;
    }>(
      `SELECT r.id::text,r.phone_normalized,r.email,c.full_name,c.client_code,
              r.created_at,r.verified_at
         FROM customer_email_link_requests r
         JOIN customers c ON c.user_id=r.customer_user_id
        WHERE r.status='pending_review'
        ORDER BY r.verified_at ASC,r.created_at ASC LIMIT 100`,
    );
    return { requests: result.rows.map(row => ({
      id: row.id, phone: row.phone_normalized, email: row.email,
      customerName: row.full_name, clientCode: row.client_code,
      requestedAt: row.created_at.toISOString(),
      verifiedAt: row.verified_at?.toISOString() || null,
    })) };
  }

  public async review(
    actor: AuthenticatedAccount,
    requestId: string,
    approve: boolean,
    reason: string,
    confirmedPhoneOwner: boolean,
    metadata: RequestMetadata,
  ): Promise<{ approved: boolean }> {
    await this.ownerOnly(actor);
    if (reason.trim().length < 10 || (approve && !confirmedPhoneOwner)) {
      throw new AppError(422, "REVIEW_REQUIRED",
        "Record the identity-check details and confirm phone ownership before approval");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<LinkRow>(
        "SELECT * FROM customer_email_link_requests WHERE id=$1::uuid FOR UPDATE", [requestId],
      );
      const row = selected.rows[0];
      if (!row || row.status !== "pending_review" || !row.verified_at) {
        throw new AppError(409, "LINK_NOT_PENDING", "This email-link request is no longer pending");
      }
      const owner = await client.query<{
        id: string; email: string | null; status: string; deleted_at: Date | null;
      }>(
        `SELECT id::text,email,status,deleted_at FROM users
          WHERE id=$1::uuid AND account_type='customer' FOR UPDATE`,
        [row.customer_user_id],
      );
      // Rejections remain available when a customer was disabled or changed.
      // Approval, however, requires an active still-email-less record.
      if (approve) {
        if (!owner.rows[0] || owner.rows[0].status !== "active" || owner.rows[0].deleted_at) {
          throw new AppError(409, "LINK_STALE", "Customer is no longer eligible");
        }
        if (owner.rows[0].email !== null) throw new AppError(409, "LINK_STALE", "Customer already has an email");
        const phone = await client.query<{ present: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM account_phones
            WHERE user_id=$1::uuid AND account_type='customer' AND is_primary
              AND phone_normalized=$2) AS present`, [row.customer_user_id, row.phone_normalized],
        );
        const conflict = await client.query<{ present: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM users WHERE email_normalized=$1) AS present",
          [row.email_normalized],
        );
        if (!phone.rows[0]?.present || conflict.rows[0]?.present) {
          throw new AppError(409, "LINK_CONFLICT", "Phone or email ownership changed; review manually");
        }
        await client.query(
          `UPDATE users SET email=$2,email_normalized=$3,email_verified_at=now(),
             updated_at=now(),version=version+1,session_version=session_version+1
            WHERE id=$1::uuid`,
          [row.customer_user_id, row.email, row.email_normalized],
        );
      }
      await client.query(
        `UPDATE customer_email_link_requests
          SET status=$2,reviewed_by=$3::uuid,reviewed_at=now(),review_reason=$4 WHERE id=$1::uuid`,
        [requestId, approve ? "approved" : "rejected", actor.userId, reason.trim()],
      );
      if (approve) {
        await client.query(
          `UPDATE customer_email_link_requests SET status='superseded'
            WHERE customer_user_id=$1 AND id<>$2::uuid AND status='pending_review'`,
          [row.customer_user_id, requestId],
        );
      }
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata,request_id)
          VALUES('staff',$1::uuid,$2,'users',$3::uuid,$4::jsonb,$5)`,
        [actor.userId, approve ? "CUSTOMER_EMAIL_LINK_APPROVED" : "CUSTOMER_EMAIL_LINK_REJECTED",
          row.customer_user_id, JSON.stringify({
            emailLinkId: requestId, email: row.email_normalized,
            verifiedPhoneOwner: approve && confirmedPhoneOwner, reviewReason: reason.trim(),
          }), metadata.requestId],
      );
      await client.query("COMMIT");
      return { approved: approve };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
