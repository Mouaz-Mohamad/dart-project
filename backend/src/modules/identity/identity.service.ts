import { createHash, randomInt, randomUUID } from "node:crypto";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { decryptSecret, digest, encryptSecret, randomToken, safeEqual } from "../../security/crypto.js";
import { normalizeEmail, normalizeEgyptianPhone, normalizeIdentifier } from "../../security/normalization.js";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../../security/password.js";
import {
  createSessionSecret,
  hashCsrfToken,
  hashSessionSecret,
  serializeSessionToken,
} from "../../security/session-token.js";
import type {
  AccountType,
  AuthenticatedAccount,
  IssuedSession,
  RequestMetadata,
} from "./identity.types.js";

interface LoginRow {
  id: string;
  account_type: AccountType;
  email: string;
  email_normalized: string;
  password_hash: string;
  status: string;
  email_verified_at: Date | null;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  session_version: number;
  mfa_required: boolean | null;
  mfa_secret_encrypted: Buffer | null;
  mfa_enabled_at: Date | null;
}

interface SessionRow {
  session_id: string;
  family_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_session_id: string | null;
  user_session_version: number;
  mfa_verified_at: Date | null;
  id: string;
  account_type: AccountType;
  email: string;
  status: string;
  email_verified_at: Date | null;
  must_change_password: boolean;
  session_version: number;
  mfa_required: boolean | null;
}

export interface RegisterCustomerInput {
  name: string;
  email: string;
  phone1: string;
  phone2?: string | undefined;
  birthday?: string | undefined;
  password: string;
}

export interface RegisterRepresentativeInput {
  name: string;
  email: string;
  phone1: string;
  phone2?: string | undefined;
  nationalId: string;
  address: string;
  password: string;
  idFrontImage: string;
  idBackImage: string;
  faceImage: string;
}

export interface IdentityPublicProfile {
  id: string;
  accountType: AccountType;
  code: string;
  name: string;
  email: string;
  phones: string[];
  status: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  birthday: string | null;
}

function mapDatabaseConflict(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    throw new AppError(409, "IDENTITY_ALREADY_EXISTS", "An account with that email or phone already exists");
  }
  throw error;
}

function passwordPolicyOrThrow(password: string): void {
  const problems = validatePasswordPolicy(password);
  if (problems.length > 0) {
    throw new AppError(422, "WEAK_PASSWORD", "Password does not meet the security policy", problems);
  }
}

function normalizePhonesOrThrow(phones: string[]): string[] {
  try {
    return [...new Set(phones.map(normalizeEgyptianPhone))];
  } catch {
    throw new AppError(422, "INVALID_PHONE", "Enter a valid Egyptian mobile number");
  }
}

function ipHash(ipAddress: string | undefined, pepper: string): string | null {
  return ipAddress ? digest(`ip:${ipAddress}`, pepper) : null;
}

function parsePrivateRepresentativeImage(value: string): {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  canonicalDataUrl: string;
  sha256: string;
} {
  const match = String(value || "").match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) {
    throw new AppError(422, "REPRESENTATIVE_IMAGE_INVALID", "Verification images must be JPG, PNG or WebP");
  }
  const contentType = match[1] as "image/jpeg" | "image/png" | "image/webp";
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > 1024 * 1024) {
    throw new AppError(422, "REPRESENTATIVE_IMAGE_TOO_LARGE", "Each compressed verification image must be 1 MB or smaller");
  }
  return {
    contentType,
    bytes,
    canonicalDataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export class IdentityService {
  public constructor(
    private readonly pool: Pool,
    private readonly config: Pick<
      AppConfig,
      "authPepper" | "sessionTtlDays" | "emailOtpTtlMinutes" | "mfaEncryptionKey"
    >,
  ) {}

  public async registerCustomer(
    input: RegisterCustomerInput,
    metadata: RequestMetadata,
  ): Promise<{ userId: string; challengeId: string; expiresAt: Date }> {
    passwordPolicyOrThrow(input.password);
    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    const phones = [input.phone1, input.phone2].filter((value): value is string => Boolean(value?.trim()));
    const normalizedPhones = normalizePhonesOrThrow(phones);
    if (normalizedPhones.length === 0) {
      throw new AppError(422, "PHONE_REQUIRED", "At least one valid Egyptian phone number is required");
    }
    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const challengeId = randomUUID();
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + this.config.emailOtpTtlMinutes * 60_000);
    const encryptedOtp = encryptSecret(otp, this.config.mfaEncryptionKey).toString("base64");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (
          id, account_type, email, email_normalized, password_hash, status
        ) VALUES ($1, 'customer', $2, $3, $4, 'pending_verification')`,
        [userId, email, emailNormalized, passwordHash],
      );
      await this.insertPhones(client, userId, "customer", phones, normalizedPhones);
      await client.query(
        `INSERT INTO customers (user_id, full_name, birthday)
         VALUES ($1, $2, $3::date)`,
        [userId, input.name.trim(), input.birthday ?? null],
      );
      await this.assignRole(client, userId, "Customer");
      await client.query(
        `INSERT INTO email_verification_challenges
          (id, user_id, purpose, code_hash, expires_at)
         VALUES ($1, $2, 'register', $3, $4)`,
        [challengeId, userId, digest(`email-otp:${challengeId}:${otp}`, this.config.authPepper), expiresAt],
      );
      await client.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, deduplication_key
        ) VALUES ('user', $1, 'EMAIL_VERIFICATION_REQUESTED', $2::jsonb, $3)`,
        [
          userId,
          JSON.stringify({
            channel: "email",
            to: email,
            template: "customer_email_verification",
            encryptedParameters: { otp: encryptedOtp },
            expiresAt: expiresAt.toISOString(),
          }),
          `email-verification:${challengeId}`,
        ],
      );
      await this.audit(client, "customer", userId, "CUSTOMER_REGISTERED", "users", userId, metadata);
      await client.query("COMMIT");
      return { userId, challengeId, expiresAt };
    } catch (error) {
      await client.query("ROLLBACK");
      mapDatabaseConflict(error);
    } finally {
      client.release();
    }
  }

  public async verifyCustomerEmail(
    challengeId: string,
    code: string,
    metadata: RequestMetadata,
  ): Promise<IssuedSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        user_id: string;
        code_hash: string;
        attempts_remaining: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT user_id, code_hash, attempts_remaining, expires_at, consumed_at
         FROM email_verification_challenges
         WHERE id = $1 AND purpose IN ('register', 'change_email')
         FOR UPDATE`,
        [challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at) {
        throw new AppError(422, "OTP_INVALID", "The verification code is invalid or already used");
      }
      if (challenge.expires_at.getTime() <= Date.now() || challenge.attempts_remaining <= 0) {
        throw new AppError(422, "OTP_EXPIRED", "The verification code has expired");
      }
      const candidate = digest(`email-otp:${challengeId}:${code}`, this.config.authPepper);
      if (!safeEqual(candidate, challenge.code_hash)) {
        await client.query(
          `UPDATE email_verification_challenges
           SET attempts_remaining = greatest(0, attempts_remaining - 1)
           WHERE id = $1`,
          [challengeId],
        );
        await client.query("COMMIT");
        throw new AppError(422, "OTP_INVALID", "The verification code is invalid");
      }
      await client.query(
        `UPDATE email_verification_challenges SET consumed_at = now() WHERE id = $1`,
        [challengeId],
      );
      await client.query(
        `UPDATE users
         SET status = 'active', email_verified_at = now(), updated_at = now(), version = version + 1
         WHERE id = $1 AND account_type = 'customer'`,
        [challenge.user_id],
      );
      await this.audit(
        client,
        "customer",
        challenge.user_id,
        "EMAIL_VERIFIED",
        "users",
        challenge.user_id,
        metadata,
      );
      const session = await this.issueSession(client, challenge.user_id, false, metadata);
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async resendCustomerVerification(
    previousChallengeId: string,
    metadata: RequestMetadata,
  ): Promise<{ challengeId: string; expiresAt: Date }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{
        id: string;
        email: string;
        status: string;
        consumed_at: Date | null;
      }>(
        `SELECT users.id, users.email, users.status,
          email_verification_challenges.consumed_at
         FROM email_verification_challenges
         JOIN users ON users.id = email_verification_challenges.user_id
         WHERE email_verification_challenges.id = $1
           AND email_verification_challenges.purpose = 'register'
           AND users.account_type = 'customer' AND users.deleted_at IS NULL
         FOR UPDATE OF email_verification_challenges`,
        [previousChallengeId],
      );
      const row = user.rows[0];
      if (!row || row.status !== "pending_verification" || row.consumed_at) {
        throw new AppError(
          422,
          "VERIFICATION_NOT_AVAILABLE",
          "Verification cannot be resent for this challenge",
        );
      }
      const challengeId = randomUUID();
      const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + this.config.emailOtpTtlMinutes * 60_000);
      const encryptedOtp = encryptSecret(otp, this.config.mfaEncryptionKey).toString("base64");
      await client.query(
        `UPDATE email_verification_challenges SET consumed_at = now()
         WHERE user_id = $1 AND purpose = 'register' AND consumed_at IS NULL`,
        [row.id],
      );
      await client.query(
        `INSERT INTO email_verification_challenges
          (id, user_id, purpose, code_hash, expires_at)
         VALUES ($1, $2, 'register', $3, $4)`,
        [challengeId, row.id, digest(`email-otp:${challengeId}:${otp}`, this.config.authPepper), expiresAt],
      );
      await client.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, deduplication_key
        ) VALUES ('user', $1, 'EMAIL_VERIFICATION_REQUESTED', $2::jsonb, $3)`,
        [
          row.id,
          JSON.stringify({
            channel: "email",
            to: row.email,
            template: "customer_email_verification",
            encryptedParameters: { otp: encryptedOtp },
            expiresAt: expiresAt.toISOString(),
          }),
          `email-verification:${challengeId}`,
        ],
      );
      await this.audit(client, "customer", row.id, "EMAIL_VERIFICATION_RESENT", "users", row.id, metadata);
      await client.query("COMMIT");
      return { challengeId, expiresAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async registerRepresentative(
    input: RegisterRepresentativeInput,
    metadata: RequestMetadata,
  ): Promise<{ userId: string; representativeCode: string; status: string }> {
    passwordPolicyOrThrow(input.password);
    if (!/^\d{14}$/.test(input.nationalId)) {
      throw new AppError(422, "INVALID_NATIONAL_ID", "National ID must contain 14 digits");
    }
    if (input.address.trim().length < 8) {
      throw new AppError(422, "INVALID_ADDRESS", "Enter the full address written on the ID");
    }
    const documents = [
      ["id_front", parsePrivateRepresentativeImage(input.idFrontImage)],
      ["id_back", parsePrivateRepresentativeImage(input.idBackImage)],
      ["face", parsePrivateRepresentativeImage(input.faceImage)],
    ] as const;
    const email = input.email.trim();
    const phones = [input.phone1, input.phone2].filter((value): value is string => Boolean(value?.trim()));
    const normalizedPhones = normalizePhonesOrThrow(phones);
    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (
          id, account_type, email, email_normalized, password_hash,
          status, email_verified_at
        ) VALUES ($1, 'representative', $2, $3, $4, 'pending_approval', now())`,
        [userId, email, normalizeEmail(email), passwordHash],
      );
      await this.insertPhones(client, userId, "representative", phones, normalizedPhones);
      const representative = await client.query<{ representative_code: string }>(
        `INSERT INTO representatives (
          user_id, full_name, national_id_hash, national_id_last4, address_text
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING representative_code`,
        [
          userId,
          input.name.trim(),
          digest(`national-id:${input.nationalId}`, this.config.authPepper),
          input.nationalId.slice(-4),
          input.address.trim(),
        ],
      );
      for (const [documentType, document] of documents) {
        await client.query(
          `INSERT INTO representative_documents (
             representative_user_id, document_type, content_type,
             encrypted_payload, byte_size, content_sha256
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            userId,
            documentType,
            document.contentType,
            encryptSecret(document.canonicalDataUrl, this.config.mfaEncryptionKey),
            document.bytes.length,
            document.sha256,
          ],
        );
      }
      await this.assignRole(client, userId, "Representative");
      await this.audit(
        client,
        "representative",
        userId,
        "REPRESENTATIVE_REGISTERED",
        "representatives",
        userId,
        metadata,
      );
      await client.query(
        `INSERT INTO outbox_events (
           aggregate_type, aggregate_id, event_type, payload, deduplication_key
         ) VALUES ('representative',$1,'REPRESENTATIVE_APPROVAL_REQUESTED',$2::jsonb,$3)
         ON CONFLICT (deduplication_key) DO NOTHING`,
        [
          userId,
          JSON.stringify({
            representativeCode: representative.rows[0]!.representative_code,
            name: input.name.trim(),
          }),
          `representative-approval:${userId}`,
        ],
      );
      await client.query("COMMIT");
      return {
        userId,
        representativeCode: representative.rows[0]!.representative_code,
        status: "pending_approval",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      mapDatabaseConflict(error);
    } finally {
      client.release();
    }
  }

  public async login(
    accountType: AccountType,
    identifier: string,
    password: string,
    metadata: RequestMetadata,
    totp?: string,
  ): Promise<IssuedSession> {
    const row = await this.findLogin(accountType, identifier);
    const generic = new AppError(401, "INVALID_CREDENTIALS", "The identifier or password is incorrect");
    if (!row) {
      await hashPassword(password);
      throw generic;
    }
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      throw new AppError(429, "ACCOUNT_TEMPORARILY_LOCKED", "Too many failed attempts; try again later");
    }
    if (!(await verifyPassword(row.password_hash, password))) {
      await this.recordFailedLogin(row.id, metadata);
      throw generic;
    }
    if (row.status === "pending_verification") {
      throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify the email address before signing in");
    }
    if (accountType === "representative" && row.status === "pending_approval") {
      throw new AppError(403, "REPRESENTATIVE_NOT_APPROVED", "Representative approval is still pending");
    }
    if (row.status !== "active") {
      throw new AppError(403, "ACCOUNT_UNAVAILABLE", "This account is not available");
    }

    let mfaSatisfied = accountType !== "staff" || !row.mfa_required;
    if (accountType === "staff" && row.mfa_enabled_at && row.mfa_secret_encrypted) {
      if (!totp) throw new AppError(401, "MFA_REQUIRED", "A current authenticator code is required");
      const secret = decryptSecret(row.mfa_secret_encrypted, this.config.mfaEncryptionKey);
      mfaSatisfied = (await verifyTotp({ token: totp, secret })).valid;
      if (!mfaSatisfied) throw new AppError(401, "MFA_INVALID", "The authenticator code is invalid");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users
         SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
         WHERE id = $1`,
        [row.id],
      );
      const session = await this.issueSession(client, row.id, mfaSatisfied, metadata);
      await this.audit(client, accountType, row.id, "LOGIN_SUCCEEDED", "sessions", session.account.sessionId, metadata);
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async authenticate(sessionId: string, secret: string): Promise<AuthenticatedAccount | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT
        sessions.id AS session_id, sessions.family_id, sessions.token_hash,
        sessions.csrf_token_hash, sessions.expires_at, sessions.revoked_at,
        sessions.replaced_by_session_id, sessions.user_session_version,
        sessions.mfa_verified_at, users.id, users.account_type, users.email,
        users.status, users.email_verified_at, users.must_change_password,
        users.session_version, staff_users.mfa_required
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       LEFT JOIN staff_users ON staff_users.user_id = users.id
       WHERE sessions.id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const validHash = safeEqual(hashSessionSecret(secret, this.config.authPepper), row.token_hash);
    const invalid =
      !validHash ||
      row.revoked_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.status !== "active" ||
      row.user_session_version !== row.session_version;
    if (invalid) {
      if (validHash && row.replaced_by_session_id) {
        await this.revokeFamily(row.family_id, "rotated_token_reuse");
      }
      return null;
    }
    await this.pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
    return this.toAuthenticatedAccount(row, await this.permissionsForUser(row.id));
  }

  public async rotateSession(
    account: AuthenticatedAccount,
    metadata: RequestMetadata,
  ): Promise<IssuedSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ revoked_at: Date | null; family_id: string }>(
        "SELECT revoked_at, family_id FROM sessions WHERE id = $1 FOR UPDATE",
        [account.sessionId],
      );
      if (!current.rows[0] || current.rows[0].revoked_at) {
        throw new AppError(401, "SESSION_INVALID", "The session is no longer valid");
      }
      const replacement = await this.issueSession(
        client,
        account.userId,
        account.mfaSatisfied,
        metadata,
        current.rows[0].family_id,
      );
      await client.query(
        `UPDATE sessions
         SET revoked_at = now(), revoke_reason = 'rotated', replaced_by_session_id = $2
         WHERE id = $1`,
        [account.sessionId, replacement.account.sessionId],
      );
      await client.query("COMMIT");
      return replacement;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async logout(account: AuthenticatedAccount, allDevices: boolean, metadata: RequestMetadata): Promise<void> {
    const reason = allDevices ? "logout_all" : "logout";
    if (allDevices) {
      await this.pool.query(
        `UPDATE users SET session_version = session_version + 1, updated_at = now() WHERE id = $1`,
        [account.userId],
      );
      await this.pool.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [account.userId, reason],
      );
    } else {
      await this.pool.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
         WHERE id = $1 AND revoked_at IS NULL`,
        [account.sessionId, reason],
      );
    }
    await this.writeAudit(account, allDevices ? "LOGOUT_ALL" : "LOGOUT", "sessions", account.sessionId, metadata);
  }

  public async profile(account: AuthenticatedAccount): Promise<IdentityPublicProfile> {
    const result = await this.pool.query<{
      id: string;
      account_type: AccountType;
      email: string;
      status: string;
      email_verified_at: Date | null;
      must_change_password: boolean;
      code: string;
      name: string;
      phones: string[] | null;
      birthday: string | null;
    }>(
      `SELECT users.id, users.account_type, users.email, users.status,
        users.email_verified_at, users.must_change_password,
        CASE users.account_type
          WHEN 'customer' THEN customers.client_code
          WHEN 'staff' THEN staff_users.staff_code
          ELSE representatives.representative_code
        END AS code,
        CASE users.account_type
          WHEN 'customer' THEN customers.full_name
          WHEN 'staff' THEN staff_users.display_name
          ELSE representatives.full_name
        END AS name,
        customers.birthday::text AS birthday,
        array_agg(account_phones.phone_display ORDER BY account_phones.is_primary DESC)
          FILTER (WHERE account_phones.id IS NOT NULL) AS phones
       FROM users
       LEFT JOIN customers ON customers.user_id = users.id
       LEFT JOIN staff_users ON staff_users.user_id = users.id
       LEFT JOIN representatives ON representatives.user_id = users.id
       LEFT JOIN account_phones ON account_phones.user_id = users.id
       WHERE users.id = $1
       GROUP BY users.id, customers.client_code, customers.full_name, customers.birthday,
         staff_users.staff_code, staff_users.display_name,
         representatives.representative_code, representatives.full_name`,
      [account.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "The account was not found");
    return {
      id: row.id,
      accountType: row.account_type,
      code: row.code,
      name: row.name,
      email: row.email,
      phones: row.phones ?? [],
      status: row.status,
      emailVerified: Boolean(row.email_verified_at),
      mustChangePassword: row.must_change_password,
      birthday: row.birthday,
    };
  }

  public async updateCustomerProfile(
    account: AuthenticatedAccount,
    input: { name: string; email: string; phone1: string; phone2?: string | undefined; birthday?: string | undefined },
    metadata: RequestMetadata,
  ): Promise<{ profile: IdentityPublicProfile; verification?: { challengeId: string; expiresAt: Date } }> {
    if (account.accountType !== "customer") {
      throw new AppError(403, "FORBIDDEN", "Only customer profiles can be changed through this endpoint");
    }
    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    const displayPhones = [input.phone1, input.phone2].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const normalizedPhones = normalizePhonesOrThrow(displayPhones);
    const client = await this.pool.connect();
    let verification: { challengeId: string; expiresAt: Date } | undefined;
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ email_normalized: string; email: string }>(
        "SELECT email_normalized, email FROM users WHERE id = $1 FOR UPDATE",
        [account.userId],
      );
      const current = locked.rows[0];
      if (!current) throw new AppError(404, "ACCOUNT_NOT_FOUND", "The account was not found");
      const emailChanged = current.email_normalized !== emailNormalized;
      await client.query(
        `UPDATE customers SET full_name = $2, birthday = $3::date, updated_at = now()
         WHERE user_id = $1`,
        [account.userId, input.name.trim(), input.birthday ?? null],
      );
      await client.query("DELETE FROM account_phones WHERE user_id = $1", [account.userId]);
      await this.insertPhones(client, account.userId, "customer", displayPhones, normalizedPhones);
      if (emailChanged) {
        await client.query(
          `UPDATE users SET email = $2, email_normalized = $3,
            email_verified_at = NULL, status = 'pending_verification',
            session_version = session_version + 1, updated_at = now(), version = version + 1
           WHERE id = $1`,
          [account.userId, email, emailNormalized],
        );
        await client.query(
          `UPDATE sessions SET revoked_at = now(), revoke_reason = 'email_changed'
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [account.userId],
        );
        await client.query(
          `UPDATE email_verification_challenges SET consumed_at = now()
           WHERE user_id = $1 AND purpose = 'change_email' AND consumed_at IS NULL`,
          [account.userId],
        );
        const challengeId = randomUUID();
        const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const expiresAt = new Date(Date.now() + this.config.emailOtpTtlMinutes * 60_000);
        await client.query(
          `INSERT INTO email_verification_challenges
            (id, user_id, purpose, code_hash, expires_at)
           VALUES ($1, $2, 'change_email', $3, $4)`,
          [challengeId, account.userId, digest(`email-otp:${challengeId}:${otp}`, this.config.authPepper), expiresAt],
        );
        await client.query(
          `INSERT INTO outbox_events (
            aggregate_type, aggregate_id, event_type, payload, deduplication_key
          ) VALUES ('user', $1, 'EMAIL_CHANGE_VERIFICATION_REQUESTED', $2::jsonb, $3)`,
          [
            account.userId,
            JSON.stringify({
              channel: "email",
              to: email,
              template: "customer_email_change_verification",
              encryptedParameters: {
                otp: encryptSecret(otp, this.config.mfaEncryptionKey).toString("base64"),
              },
              expiresAt: expiresAt.toISOString(),
            }),
            `email-change-verification:${challengeId}`,
          ],
        );
        verification = { challengeId, expiresAt };
      } else {
        await client.query(
          `UPDATE users SET email = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
          [account.userId, email],
        );
      }
      await this.audit(client, "customer", account.userId, "CUSTOMER_PROFILE_UPDATED", "customers", account.userId, metadata);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      mapDatabaseConflict(error);
    } finally {
      client.release();
    }
    return { profile: await this.profile(account), ...(verification ? { verification } : {}) };
  }

  public async adminSetAccountState(
    account: AuthenticatedAccount,
    targetUserId: string,
    targetType: "customer" | "representative",
    action: "suspend" | "activate" | "delete",
    metadata: RequestMetadata,
  ): Promise<void> {
    const permission =
      targetType === "customer" ? "customers.manage" : "representatives.manage";
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes(permission) ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage this account");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        status: string;
        email_verified_at: Date | null;
        deleted_at: Date | null;
      }>(
        `SELECT status, email_verified_at, deleted_at
           FROM users
          WHERE id=$1 AND account_type=$2
          FOR UPDATE`,
        [targetUserId, targetType],
      );
      const user = locked.rows[0];
      if (!user) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found");
      }
      if (user.deleted_at) {
        throw new AppError(409, "ACCOUNT_DELETED", "Deleted accounts cannot be changed");
      }

      if (action === "suspend") {
        if (user.status !== "active") {
          throw new AppError(409, "ACCOUNT_STATE_INVALID", "Only active accounts can be suspended");
        }
        await client.query(
          `UPDATE users
              SET status='suspended',
                  session_version=session_version+1,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [targetUserId],
        );
        if (targetType === "representative") {
          await client.query(
            `UPDATE representatives
                SET approval_status='suspended', updated_at=now()
              WHERE user_id=$1 AND approval_status='approved'`,
            [targetUserId],
          );
        }
      }

      if (action === "activate") {
        if (user.status !== "suspended") {
          throw new AppError(409, "ACCOUNT_STATE_INVALID", "Only suspended accounts can be restored");
        }
        if (targetType === "representative") {
          const rep = await client.query<{
            approved_by: string | null;
            approved_at: Date | null;
            approval_status: string;
          }>(
            `SELECT approved_by::text, approved_at, approval_status
               FROM representatives
              WHERE user_id=$1
              FOR UPDATE`,
            [targetUserId],
          );
          const representative = rep.rows[0];
          if (!representative?.approved_by || !representative.approved_at) {
            throw new AppError(
              409,
              "REPRESENTATIVE_APPROVAL_REQUIRED",
              "Representative must be approved before activation",
            );
          }
          await client.query(
            `UPDATE representatives
                SET approval_status='approved', updated_at=now()
              WHERE user_id=$1`,
            [targetUserId],
          );
        }
        await client.query(
          `UPDATE users
              SET status='active',
                  session_version=session_version+1,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [targetUserId],
        );
      }

      if (action === "delete") {
        await client.query(
          `UPDATE users
              SET status=CASE
                    WHEN email_verified_at IS NULL THEN 'pending_verification'
                    ELSE 'deleted'
                  END,
                  deleted_at=now(),
                  session_version=session_version+1,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [targetUserId],
        );
        if (targetType === "representative") {
          await client.query(
            `UPDATE representatives
                SET approval_status=CASE
                      WHEN approval_status IN ('approved','suspended') THEN 'suspended'
                      ELSE approval_status
                    END,
                    updated_at=now()
              WHERE user_id=$1`,
            [targetUserId],
          );
        }
      }

      await client.query(
        `UPDATE sessions
            SET revoked_at=COALESCE(revoked_at, now()),
                revoke_reason=COALESCE(revoke_reason, $2)
          WHERE user_id=$1 AND revoked_at IS NULL`,
        [targetUserId, `admin_${action}`],
      );

      await this.audit(
        client,
        "staff",
        account.userId,
        `ACCOUNT_${action.toUpperCase()}`,
        targetType === "customer" ? "customers" : "representatives",
        targetUserId,
        metadata,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminUpdateCustomer(
    account: AuthenticatedAccount,
    customerUserId: string,
    input: {
      name: string;
      email: string;
      phone1: string;
      phone2?: string | undefined;
      birthday?: string | null | undefined;
      dartCardDrawEligible?: boolean | undefined;
    },
    metadata: RequestMetadata,
  ): Promise<void> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("customers.manage") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage customers");
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    const displayPhones = [input.phone1, input.phone2].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const normalizedPhones = normalizePhonesOrThrow(displayPhones);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        email: string;
        email_normalized: string;
      }>(
        `SELECT email, email_normalized
           FROM users
          WHERE id=$1 AND account_type='customer' AND deleted_at IS NULL
          FOR UPDATE`,
        [customerUserId],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
      }

      const contactsChanged =
        current.email_normalized !== emailNormalized ||
        (
          await client.query<{ values: string[] }>(
            `SELECT COALESCE(
               array_agg(phone_normalized ORDER BY is_primary DESC, created_at),
               ARRAY[]::text[]
             ) AS values
               FROM account_phones
              WHERE user_id=$1 AND account_type='customer'`,
            [customerUserId],
          )
        ).rows[0]!.values.join("|") !== normalizedPhones.join("|");

      await client.query(
        `UPDATE customers
            SET full_name=$2,
                birthday=$3::date,
                dart_card_draw_eligible=COALESCE($4, dart_card_draw_eligible),
                updated_at=now()
          WHERE user_id=$1`,
        [
          customerUserId,
          input.name.trim(),
          input.birthday || null,
          input.dartCardDrawEligible ?? null,
        ],
      );

      await client.query(
        `UPDATE users
            SET email=$2,
                email_normalized=$3,
                email_verified_at=now(),
                status=CASE WHEN status='deleted' THEN status ELSE 'active' END,
                session_version=session_version + CASE WHEN $4 THEN 1 ELSE 0 END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [customerUserId, email, emailNormalized, contactsChanged],
      );

      await client.query(
        "DELETE FROM account_phones WHERE user_id=$1 AND account_type='customer'",
        [customerUserId],
      );
      await this.insertPhones(
        client,
        customerUserId,
        "customer",
        displayPhones,
        normalizedPhones,
      );

      if (contactsChanged) {
        await client.query(
          `UPDATE sessions
              SET revoked_at=COALESCE(revoked_at, now()),
                  revoke_reason=COALESCE(revoke_reason, 'admin_identity_update')
            WHERE user_id=$1 AND revoked_at IS NULL`,
          [customerUserId],
        );
      }

      await this.audit(
        client,
        "staff",
        account.userId,
        "CUSTOMER_ADMIN_UPDATED",
        "customers",
        customerUserId,
        metadata,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      mapDatabaseConflict(error);
    } finally {
      client.release();
    }
  }
  public async adminSetCustomerDrawEligibility(
    account: AuthenticatedAccount,
    customerUserId: string,
    eligible: boolean,
    reason: string,
    metadata: RequestMetadata,
  ): Promise<{ eligible: boolean }> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("customers.manage") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage customers");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        dart_card_draw_eligible: boolean;
        client_code: string;
      }>(
        `SELECT dart_card_draw_eligible, client_code
           FROM customers
          WHERE user_id=$1
          FOR UPDATE`,
        [customerUserId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account not found");
      }

      await client.query(
        `UPDATE customers
            SET dart_card_draw_eligible=$2,
                updated_at=now()
          WHERE user_id=$1`,
        [customerUserId, eligible],
      );

      await this.audit(
        client,
        "staff",
        account.userId,
        "DART_CARD_DRAW_ELIGIBILITY_CHANGED",
        "customers",
        customerUserId,
        metadata,
        {
          clientCode: row.client_code,
          previousEligible: row.dart_card_draw_eligible,
          eligible,
          reason: reason.trim(),
        },
      );
      await client.query("COMMIT");
      return { eligible };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }


  public async requestPasswordReset(
    accountType: AccountType,
    identifier: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const user = await this.findLogin(accountType, identifier);
    const identifierHash = digest(`reset-identifier:${normalizeIdentifier(identifier)}`, this.config.authPepper);
    if (user) {
      const existing = await this.pool.query<{ id: string }>(
        `SELECT id::text
           FROM password_reset_requests
          WHERE user_id=$1
            AND account_type=$2
            AND status='pending'
          ORDER BY requested_at DESC
          LIMIT 1`,
        [user.id, accountType],
      );
      if (existing.rows[0]) return;
    }
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO password_reset_requests (user_id, account_type, identifier_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [user?.id ?? null, accountType, identifierHash],
    );
    if (user) {
      await this.writeAudit(
        {
          userId: user.id,
          accountType,
          status: user.status,
          email: user.email,
          emailVerified: Boolean(user.email_verified_at),
          mustChangePassword: user.must_change_password,
          sessionId: result.rows[0]!.id,
          sessionFamilyId: result.rows[0]!.id,
          csrfTokenHash: "",
          mfaRequired: Boolean(user.mfa_required),
          mfaSatisfied: false,
          permissions: [],
        },
        "PASSWORD_RESET_REQUESTED",
        "password_reset_requests",
        result.rows[0]!.id,
        metadata,
      );
    }
  }

  public async adminCreatePasswordResetRequest(
    account: AuthenticatedAccount,
    targetUserId: string,
    targetType: "customer" | "representative",
    metadata: RequestMetadata,
  ): Promise<{ requestId: string }> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("staff.sessions_revoke") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to create password reset requests");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{
        id: string;
        email: string;
      }>(
        `SELECT id::text, email
           FROM users
          WHERE id=$1
            AND account_type=$2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [targetUserId, targetType],
      );
      const row = user.rows[0];
      if (!row) {
        throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found");
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id::text
           FROM password_reset_requests
          WHERE user_id=$1
            AND account_type=$2
            AND status='pending'
          ORDER BY requested_at DESC
          LIMIT 1
          FOR UPDATE`,
        [targetUserId, targetType],
      );
      let requestId = existing.rows[0]?.id;
      if (!requestId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO password_reset_requests (
             user_id, account_type, identifier_hash
           ) VALUES ($1,$2,$3)
           RETURNING id::text`,
          [
            targetUserId,
            targetType,
            digest(
              `reset-identifier:${normalizeIdentifier(row.email)}`,
              this.config.authPepper,
            ),
          ],
        );
        requestId = created.rows[0]!.id;
      }

      await this.audit(
        client,
        "staff",
        account.userId,
        "PASSWORD_RESET_REQUEST_CREATED_BY_ADMIN",
        "password_reset_requests",
        requestId,
        metadata,
      );
      await client.query("COMMIT");
      return { requestId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listPasswordResetRequests(
    account: AuthenticatedAccount,
  ): Promise<Array<Record<string, unknown>>> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("staff.sessions_revoke") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage password reset requests");
    }

    const result = await this.pool.query<{
      id: string;
      user_id: string | null;
      account_type: string;
      status: string;
      requested_at: Date;
      email: string | null;
      customer_name: string | null;
      customer_code: string | null;
      representative_name: string | null;
      representative_code: string | null;
      phone: string | null;
    }>(
      `SELECT pr.id::text, pr.user_id::text, pr.account_type, pr.status, pr.requested_at,
              u.email,
              c.full_name AS customer_name,
              c.client_code AS customer_code,
              r.full_name AS representative_name,
              r.representative_code,
              (
                SELECT ap.phone_display
                  FROM account_phones ap
                 WHERE ap.user_id=pr.user_id
                   AND ap.account_type=pr.account_type
                 ORDER BY ap.is_primary DESC, ap.created_at
                 LIMIT 1
              ) AS phone
         FROM password_reset_requests pr
         LEFT JOIN users u ON u.id=pr.user_id
         LEFT JOIN customers c
           ON c.user_id=pr.user_id AND pr.account_type='customer'
         LEFT JOIN representatives r
           ON r.user_id=pr.user_id AND pr.account_type='representative'
        WHERE pr.status='pending'
        ORDER BY pr.requested_at DESC
        LIMIT 500`,
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountType: row.account_type,
      status: row.status,
      name:
        row.customer_name ||
        row.representative_name ||
        row.email ||
        "Unknown account",
      code: row.customer_code || row.representative_code || "",
      email: row.email || "",
      phone: row.phone || "",
      requestedAt: row.requested_at.toISOString(),
      matchedAccount: Boolean(row.user_id),
    }));
  }

  public async cancelPasswordResetRequest(
    account: AuthenticatedAccount,
    requestId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("staff.sessions_revoke") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage password reset requests");
    }
    const result = await this.pool.query(
      `UPDATE password_reset_requests
          SET status='cancelled'
        WHERE id=$1 AND status='pending'`,
      [requestId],
    );
    if (!result.rowCount) {
      throw new AppError(404, "RESET_REQUEST_NOT_FOUND", "Pending reset request not found");
    }
    await this.writeAudit(
      account,
      "PASSWORD_RESET_CANCELLED",
      "password_reset_requests",
      requestId,
      metadata,
    );
  }

  public async setupMfa(account: AuthenticatedAccount): Promise<{ secret: string; otpauthUri: string }> {
    if (account.accountType !== "staff") {
      throw new AppError(403, "FORBIDDEN", "This action is available only to staff accounts");
    }
    const existing = await this.pool.query<{ mfa_enabled_at: Date | null }>(
      "SELECT mfa_enabled_at FROM staff_users WHERE user_id = $1",
      [account.userId],
    );
    if (existing.rows[0]?.mfa_enabled_at) {
      throw new AppError(409, "MFA_ALREADY_ENABLED", "MFA is already enabled for this account");
    }
    const secret = generateSecret();
    const encrypted = encryptSecret(secret, this.config.mfaEncryptionKey);
    await this.pool.query(
      `UPDATE staff_users SET mfa_secret_encrypted = $2, mfa_enabled_at = NULL, updated_at = now()
       WHERE user_id = $1`,
      [account.userId, encrypted],
    );
    return {
      secret,
      otpauthUri: generateURI({ label: account.email, issuer: "Dart for you", secret }),
    };
  }

  public async confirmMfa(account: AuthenticatedAccount, token: string, metadata: RequestMetadata): Promise<void> {
    if (account.accountType !== "staff") {
      throw new AppError(403, "FORBIDDEN", "This action is available only to staff accounts");
    }
    const result = await this.pool.query<{ mfa_secret_encrypted: Buffer | null }>(
      "SELECT mfa_secret_encrypted FROM staff_users WHERE user_id = $1",
      [account.userId],
    );
    const encrypted = result.rows[0]?.mfa_secret_encrypted;
    if (!encrypted) throw new AppError(409, "MFA_SETUP_REQUIRED", "Start MFA setup first");
    const secret = decryptSecret(encrypted, this.config.mfaEncryptionKey);
    if (!(await verifyTotp({ token, secret })).valid) {
      throw new AppError(422, "MFA_INVALID", "The authenticator code is invalid");
    }
    await this.pool.query(
      "UPDATE staff_users SET mfa_enabled_at = now(), updated_at = now() WHERE user_id = $1",
      [account.userId],
    );
    await this.pool.query("UPDATE sessions SET mfa_verified_at = now() WHERE id = $1", [account.sessionId]);
    await this.writeAudit(account, "MFA_ENABLED", "staff_users", account.userId, metadata);
  }

  public async listSessions(account: AuthenticatedAccount): Promise<
    Array<{
      id: string;
      current: boolean;
      userAgent: string | null;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      user_agent: string | null;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `SELECT id, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_seen_at DESC`,
      [account.userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      current: row.id === account.sessionId,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    }));
  }

  public async revokeOwnSession(
    account: AuthenticatedAccount,
    sessionId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = 'user_revoked'
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, account.userId],
    );
    if (result.rowCount === 0) throw new AppError(404, "SESSION_NOT_FOUND", "The session was not found");
    await this.writeAudit(account, "SESSION_REVOKED", "sessions", sessionId, metadata);
  }

  public async adminUpdateRepresentative(
    account: AuthenticatedAccount,
    representativeUserId: string,
    input: {
      name: string;
      email: string;
      phone1: string;
      phone2?: string | undefined;
      address: string;
    },
    metadata: RequestMetadata,
  ): Promise<void> {
    if (
      account.accountType !== "staff" ||
      !account.permissions.includes("representatives.manage") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to manage representatives");
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    const displayPhones = [input.phone1, input.phone2].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const normalizedPhones = normalizePhonesOrThrow(displayPhones);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        email_normalized: string;
      }>(
        `SELECT email_normalized
           FROM users
          WHERE id=$1
            AND account_type='representative'
            AND deleted_at IS NULL
          FOR UPDATE`,
        [representativeUserId],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new AppError(404, "REPRESENTATIVE_NOT_FOUND", "Representative account not found");
      }

      const phonesResult = await client.query<{ values: string[] }>(
        `SELECT COALESCE(
           array_agg(phone_normalized ORDER BY is_primary DESC, created_at),
           ARRAY[]::text[]
         ) AS values
           FROM account_phones
          WHERE user_id=$1 AND account_type='representative'`,
        [representativeUserId],
      );
      const contactsChanged =
        current.email_normalized !== emailNormalized ||
        phonesResult.rows[0]!.values.join("|") !== normalizedPhones.join("|");

      await client.query(
        `UPDATE representatives
            SET full_name=$2,
                address_text=$3,
                updated_at=now()
          WHERE user_id=$1`,
        [representativeUserId, input.name.trim(), input.address.trim()],
      );

      await client.query(
        `UPDATE users
            SET email=$2,
                email_normalized=$3,
                session_version=session_version + CASE WHEN $4 THEN 1 ELSE 0 END,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [representativeUserId, email, emailNormalized, contactsChanged],
      );

      await client.query(
        "DELETE FROM account_phones WHERE user_id=$1 AND account_type='representative'",
        [representativeUserId],
      );
      await this.insertPhones(
        client,
        representativeUserId,
        "representative",
        displayPhones,
        normalizedPhones,
      );

      if (contactsChanged) {
        await client.query(
          `UPDATE sessions
              SET revoked_at=COALESCE(revoked_at, now()),
                  revoke_reason=COALESCE(revoke_reason, 'admin_identity_update')
            WHERE user_id=$1 AND revoked_at IS NULL`,
          [representativeUserId],
        );
      }

      await this.audit(
        client,
        "staff",
        account.userId,
        "REPRESENTATIVE_ADMIN_UPDATED",
        "representatives",
        representativeUserId,
        metadata,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      mapDatabaseConflict(error);
    } finally {
      client.release();
    }
  }

  public async listRepresentativeApplications(
    account: AuthenticatedAccount,
  ): Promise<Array<Record<string, unknown>>> {
    if (
      !account.permissions.includes("representatives.read_applications") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to review representative applications");
    }
    const result = await this.pool.query<{
      user_id: string;
      representative_code: string;
      full_name: string;
      national_id_last4: string;
      address_text: string;
      approval_status: string;
      rejection_reason: string | null;
      created_at: Date;
      email: string;
      user_status: string;
      phones: Array<{ phone_display: string; is_primary: boolean }>;
    }>(
      `SELECT r.user_id::text, r.representative_code, r.full_name,
              r.national_id_last4, r.address_text, r.approval_status,
              r.rejection_reason, r.created_at, u.email, u.status AS user_status,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'phone_display', p.phone_display,
                    'is_primary', p.is_primary
                  ) ORDER BY p.is_primary DESC, p.created_at
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::jsonb
              ) AS phones
         FROM representatives r
         JOIN users u ON u.id=r.user_id
         LEFT JOIN account_phones p
           ON p.user_id=r.user_id AND p.account_type='representative'
        WHERE u.deleted_at IS NULL
        GROUP BY r.user_id, r.representative_code, r.full_name,
                 r.national_id_last4, r.address_text, r.approval_status,
                 r.rejection_reason, r.created_at, u.email, u.status
        ORDER BY
          CASE r.approval_status WHEN 'pending' THEN 0 ELSE 1 END,
          r.created_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.user_id,
      repId: row.representative_code,
      name: row.full_name,
      email: row.email,
      phone1:
        row.phones.find((phone) => phone.is_primary)?.phone_display ||
        row.phones[0]?.phone_display ||
        "",
      phone2:
        row.phones.find((phone) => !phone.is_primary)?.phone_display || "-",
      address: row.address_text,
      nationalIdLast4: row.national_id_last4,
      status:
        row.approval_status === "approved"
          ? "Active"
          : row.approval_status === "pending"
            ? "Pending Approval"
            : row.approval_status === "rejected"
              ? "Rejected"
              : "Suspended",
      approvalStatus: row.approval_status,
      accountStatus: row.user_status,
      rejectionReason: row.rejection_reason || "",
      createdAt: row.created_at.toISOString(),
      documents: ["id_front", "id_back", "face"],
    }));
  }

  public async representativeDocument(
    account: AuthenticatedAccount,
    representativeUserId: string,
    documentType: "id_front" | "id_back" | "face",
  ): Promise<{ contentType: string; dataUrl: string }> {
    if (
      !account.permissions.includes("representatives.read_applications") ||
      !account.mfaSatisfied
    ) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to review representative documents");
    }
    const result = await this.pool.query<{
      content_type: string;
      encrypted_payload: Buffer;
    }>(
      `SELECT content_type, encrypted_payload
         FROM representative_documents
        WHERE representative_user_id=$1 AND document_type=$2`,
      [representativeUserId, documentType],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "REPRESENTATIVE_DOCUMENT_NOT_FOUND", "Verification document not found");
    }
    return {
      contentType: row.content_type,
      dataUrl: decryptSecret(row.encrypted_payload, this.config.mfaEncryptionKey),
    };
  }

  public async decideRepresentative(
    account: AuthenticatedAccount,
    representativeUserId: string,
    approve: boolean,
    reason: string | undefined,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (!account.permissions.includes("representatives.approve") || !account.mfaSatisfied) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ approval_status: string }>(
        "SELECT approval_status FROM representatives WHERE user_id = $1 FOR UPDATE",
        [representativeUserId],
      );
      if (!locked.rows[0]) throw new AppError(404, "REPRESENTATIVE_NOT_FOUND", "The representative was not found");
      const status = approve ? "approved" : "rejected";
      await client.query(
        `UPDATE representatives SET approval_status = $2, approved_by = $3,
          approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
          rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE NULL END,
          updated_at = now()
         WHERE user_id = $1`,
        [representativeUserId, status, account.userId, reason ?? null],
      );
      await client.query(
        `UPDATE users SET status = $2, updated_at = now(), version = version + 1
         WHERE id = $1 AND account_type = 'representative'`,
        [representativeUserId, approve ? "active" : "rejected"],
      );
      await this.audit(
        client,
        "staff",
        account.userId,
        approve ? "REPRESENTATIVE_APPROVED" : "REPRESENTATIVE_REJECTED",
        "representatives",
        representativeUserId,
        metadata,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async setTemporaryPassword(
    account: AuthenticatedAccount,
    requestId: string,
    temporaryPassword: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    if (!account.permissions.includes("staff.sessions_revoke") || !account.mfaSatisfied) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
    }
    passwordPolicyOrThrow(temporaryPassword);
    const passwordHash = await hashPassword(temporaryPassword);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ user_id: string | null; status: string; email: string | null }>(
        `SELECT password_reset_requests.user_id, password_reset_requests.status, users.email
         FROM password_reset_requests
         LEFT JOIN users ON users.id = password_reset_requests.user_id
         WHERE password_reset_requests.id = $1 FOR UPDATE`,
        [requestId],
      );
      const row = request.rows[0];
      if (!row?.user_id) throw new AppError(404, "RESET_REQUEST_NOT_FOUND", "The reset request was not found");
      if (row.status !== "pending") throw new AppError(409, "RESET_REQUEST_RESOLVED", "The reset request is already closed");
      await client.query(
        `INSERT INTO password_history (user_id, password_hash)
         SELECT id, password_hash FROM users WHERE id = $1`,
        [row.user_id],
      );
      await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = true,
          session_version = session_version + 1, failed_login_count = 0,
          locked_until = NULL, updated_at = now(), version = version + 1
         WHERE id = $1`,
        [row.user_id, passwordHash],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_reset'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [row.user_id],
      );
      await client.query(
        `UPDATE password_reset_requests SET status = 'resolved', resolved_at = now(), resolved_by = $2
         WHERE id = $1`,
        [requestId, account.userId],
      );
      await client.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, deduplication_key
        ) VALUES ('user', $1, 'TEMPORARY_PASSWORD_ASSIGNED', $2::jsonb, $3)`,
        [
          row.user_id,
          JSON.stringify({
            channel: "email",
            to: row.email,
            template: "temporary_password_assigned",
            encryptedParameters: {
              temporaryPassword: encryptSecret(
                temporaryPassword,
                this.config.mfaEncryptionKey,
              ).toString("base64"),
            },
            mustChangeOnNextLogin: true,
          }),
          `temporary-password:${requestId}`,
        ],
      );
      await this.audit(client, "staff", account.userId, "TEMPORARY_PASSWORD_SET", "users", row.user_id, metadata);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async replaceTemporaryPassword(
    account: AuthenticatedAccount,
    newPassword: string,
    metadata: RequestMetadata,
  ): Promise<IssuedSession> {
    if (!account.mustChangePassword) {
      throw new AppError(409, "TEMPORARY_PASSWORD_NOT_ACTIVE", "This account does not require a password replacement");
    }
    passwordPolicyOrThrow(newPassword);
    const history = await this.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM (
        SELECT password_hash, created_at FROM password_history WHERE user_id = $1
        UNION ALL
        SELECT password_hash, now() FROM users WHERE id = $1
       ) password_versions
       ORDER BY created_at DESC LIMIT 5`,
      [account.userId],
    );
    for (const previous of history.rows) {
      if (await verifyPassword(previous.password_hash, newPassword)) {
        throw new AppError(422, "PASSWORD_REUSED", "Choose a password that was not used recently");
      }
    }
    const nextHash = await hashPassword(newPassword);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO password_history (user_id, password_hash)
         SELECT id, password_hash FROM users WHERE id = $1`,
        [account.userId],
      );
      await client.query(
        `UPDATE users SET password_hash = $2, must_change_password = false,
          session_version = session_version + 1, updated_at = now(), version = version + 1
         WHERE id = $1`,
        [account.userId, nextHash],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_changed'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [account.userId],
      );
      const replacement = await this.issueSession(
        client,
        account.userId,
        account.mfaSatisfied,
        metadata,
      );
      await this.audit(
        client,
        account.accountType,
        account.userId,
        "PASSWORD_CHANGED",
        "users",
        account.userId,
        metadata,
      );
      await client.query("COMMIT");
      return replacement;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async findLogin(accountType: AccountType, identifier: string): Promise<LoginRow | null> {
    const normalized = normalizeIdentifier(identifier);
    let phone: string | null = null;
    try {
      phone = normalizeEgyptianPhone(identifier);
    } catch {
      phone = null;
    }
    const nationalIdHash = /^\d{14}$/.test(identifier)
      ? digest(`national-id:${identifier}`, this.config.authPepper)
      : null;
    const result = await this.pool.query<LoginRow>(
      `SELECT users.*, staff_users.mfa_required, staff_users.mfa_secret_encrypted,
        staff_users.mfa_enabled_at
       FROM users
       LEFT JOIN account_phones ON account_phones.user_id = users.id
       LEFT JOIN customers ON customers.user_id = users.id
       LEFT JOIN staff_users ON staff_users.user_id = users.id
       LEFT JOIN representatives ON representatives.user_id = users.id
       WHERE users.account_type = $1 AND users.deleted_at IS NULL AND (
         users.email_normalized = $2
         OR ($3::text IS NOT NULL AND account_phones.phone_normalized = $3)
         OR lower(customers.client_code) = $2
         OR lower(staff_users.staff_code) = $2
         OR lower(representatives.representative_code) = $2
         OR ($4::text IS NOT NULL AND representatives.national_id_hash = $4)
       )
       LIMIT 1`,
      [accountType, normalized, phone, nationalIdHash],
    );
    return result.rows[0] ?? null;
  }

  private async recordFailedLogin(userId: string, metadata: RequestMetadata): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users SET
          failed_login_count = failed_login_count + 1,
          locked_until = CASE WHEN failed_login_count + 1 >= 5
            THEN now() + interval '15 minutes' ELSE locked_until END,
          updated_at = now()
         WHERE id = $1`,
        [userId],
      );
      await this.audit(client, "system", null, "LOGIN_FAILED", "users", userId, metadata);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async issueSession(
    client: PoolClient,
    userId: string,
    mfaSatisfied: boolean,
    metadata: RequestMetadata,
    familyId: string = randomUUID(),
  ): Promise<IssuedSession> {
    const user = await client.query<{
      id: string;
      account_type: AccountType;
      email: string;
      status: string;
      email_verified_at: Date | null;
      must_change_password: boolean;
      session_version: number;
      mfa_required: boolean | null;
    }>(
      `SELECT users.id, users.account_type, users.email, users.status,
        users.email_verified_at, users.must_change_password, users.session_version,
        staff_users.mfa_required
       FROM users LEFT JOIN staff_users ON staff_users.user_id = users.id
       WHERE users.id = $1`,
      [userId],
    );
    const row = user.rows[0];
    if (!row) throw new AppError(404, "ACCOUNT_NOT_FOUND", "The account was not found");
    const sessionId = randomUUID();
    const secret = createSessionSecret();
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.config.sessionTtlDays * 86_400_000);
    await client.query(
      `INSERT INTO sessions (
        id, user_id, family_id, token_hash, csrf_token_hash,
        user_session_version, user_agent, ip_hash, expires_at, mfa_verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        userId,
        familyId,
        hashSessionSecret(secret, this.config.authPepper),
        hashCsrfToken(csrfToken, this.config.authPepper),
        row.session_version,
        metadata.userAgent?.slice(0, 500) ?? null,
        ipHash(metadata.ipAddress, this.config.authPepper),
        expiresAt,
        mfaSatisfied ? new Date() : null,
      ],
    );
    const permissions = await this.permissionsForUser(userId, client);
    return {
      account: {
        userId,
        accountType: row.account_type,
        status: row.status,
        email: row.email,
        emailVerified: Boolean(row.email_verified_at),
        mustChangePassword: row.must_change_password,
        sessionId,
        sessionFamilyId: familyId,
        csrfTokenHash: hashCsrfToken(csrfToken, this.config.authPepper),
        mfaRequired: Boolean(row.mfa_required),
        mfaSatisfied,
        permissions,
      },
      sessionToken: serializeSessionToken({ id: sessionId, secret }),
      csrfToken,
      expiresAt,
    };
  }

  private toAuthenticatedAccount(row: SessionRow, permissions: string[]): AuthenticatedAccount {
    return {
      userId: row.id,
      accountType: row.account_type,
      status: row.status,
      email: row.email,
      emailVerified: Boolean(row.email_verified_at),
      mustChangePassword: row.must_change_password,
      sessionId: row.session_id,
      sessionFamilyId: row.family_id,
      csrfTokenHash: row.csrf_token_hash,
      mfaRequired: Boolean(row.mfa_required),
      mfaSatisfied: !row.mfa_required || Boolean(row.mfa_verified_at),
      permissions,
    };
  }

  private async permissionsForUser(userId: string, client: Pool | PoolClient = this.pool): Promise<string[]> {
    const result = await client.query<{ key: string }>(
      `SELECT DISTINCT permissions.key
       FROM user_roles
       JOIN role_permissions ON role_permissions.role_id = user_roles.role_id
       JOIN permissions ON permissions.id = role_permissions.permission_id
       WHERE user_roles.user_id = $1 AND user_roles.revoked_at IS NULL
       ORDER BY permissions.key`,
      [userId],
    );
    return result.rows.map((row) => row.key);
  }

  private async insertPhones(
    client: PoolClient,
    userId: string,
    accountType: AccountType,
    displayPhones: string[],
    normalizedPhones: string[],
  ): Promise<void> {
    for (const [index, phone] of normalizedPhones.entries()) {
      await client.query(
        `INSERT INTO account_phones (
          user_id, account_type, phone_normalized, phone_display, is_primary
        ) VALUES ($1, $2, $3, $4, $5)`,
        [userId, accountType, phone, displayPhones[index]!.trim(), index === 0],
      );
    }
  }

  private async assignRole(client: PoolClient, userId: string, roleName: string): Promise<void> {
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2`,
      [userId, roleName],
    );
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = coalesce(revoked_at, now()),
        revoke_reason = coalesce(revoke_reason, $2)
       WHERE family_id = $1`,
      [familyId, reason],
    );
  }

  private async writeAudit(
    account: AuthenticatedAccount,
    action: string,
    entityType: string,
    entityId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (
        actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        account.accountType,
        account.userId,
        action,
        entityType,
        entityId,
        metadata.requestId,
        JSON.stringify({ ipHash: ipHash(metadata.ipAddress, this.config.authPepper) }),
      ],
    );
  }

  private async audit(
    client: PoolClient,
    actorType: AccountType | "system",
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    metadata: RequestMetadata,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (
        actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        actorType,
        actorId,
        action,
        entityType,
        entityId,
        metadata.requestId,
        JSON.stringify({
          ipHash: ipHash(metadata.ipAddress, this.config.authPepper),
          ...details,
        }),
      ],
    );
  }
}
