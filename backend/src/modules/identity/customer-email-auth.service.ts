// Customer email authentication: no customer session is issued for an identifier alone.
import { randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { digest, encryptSecret, safeEqual } from "../../security/crypto.js";
import { normalizeEmail, normalizeEgyptianPhone } from "../../security/normalization.js";
import type { RequestMetadata, IssuedSession } from "./identity.types.js";
import type { IdentityService } from "./identity.service.js";

interface ChallengeRow {
  id: string;
  purpose: "login" | "register";
  user_id: string | null;
  email: string;
  email_normalized: string;
  signup_data: { name: string; phone1: string; birthday: string } | null;
  code_hash: string;
  attempts_remaining: number;
  expires_at: Date;
  consumed_at: Date | null;
}
type AuthResult = { challengeId: string; expiresAt: string; emailDisplay: string | null; sent: boolean };

export class CustomerEmailAuthService {
  constructor(
    private readonly pool: Pool,
    private readonly config: Pick<AppConfig, "authPepper" | "mfaEncryptionKey">,
    private readonly identity: IdentityService,
  ) {}

  private async issue(
    purpose: "login" | "register",
    email: string,
    userId: string | null,
    signupData: ChallengeRow["signup_data"],
  ): Promise<AuthResult> {
    const client = await this.pool.connect();
    const emailNormalized = normalizeEmail(email);
    const generic: AuthResult = {
      challengeId: randomUUID(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      emailDisplay: null,
      sent: false,
    };
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["customer-email:" + purpose + ":" + emailNormalized]);
      const history = await client.query<{ id: string; created_at: Date; expires_at: Date; consumed_at: Date | null }>(
        "SELECT id::text,created_at,expires_at,consumed_at FROM customer_email_otp_challenges WHERE email_normalized=$1 AND purpose=$2 AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC LIMIT 5",
        [emailNormalized, purpose],
      );
      const recent = history.rows[0];
      if (recent && recent.created_at.getTime() > Date.now() - 60_000) {
        await client.query("COMMIT");
        // Avoid revealing whether the supplied phone/email corresponds to an account.
        return { ...generic, challengeId: recent.id, expiresAt: recent.expires_at.toISOString(), sent: false };
      }
      if (history.rows.length >= 3 || (!userId && purpose === "login")) {
        await client.query("COMMIT");
        return generic;
      }
      await client.query(
        "UPDATE customer_email_otp_challenges SET consumed_at=now() WHERE email_normalized=$1 AND purpose=$2 AND consumed_at IS NULL",
        [emailNormalized, purpose],
      );
      const challengeId = randomUUID();
      const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await client.query(
        "INSERT INTO customer_email_otp_challenges(id,purpose,user_id,email,email_normalized,signup_data,code_hash,expires_at) VALUES ($1,$2,$3::uuid,$4,$5,$6::jsonb,$7,$8)",
        [challengeId, purpose, userId, email, emailNormalized, signupData ? JSON.stringify(signupData) : null,
          digest("customer-email-otp:" + challengeId + ":" + otp, this.config.authPepper), expiresAt],
      );
      const eventType = purpose === "login" ? "CUSTOMER_LOGIN_OTP_REQUESTED" : "CUSTOMER_SIGNUP_OTP_REQUESTED";
      const key = "customer-email-" + purpose + ":" + challengeId;
      await client.query(
        "INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key) VALUES ('customer_auth',$1,$2,$3::jsonb,$4)",
        [userId || challengeId,eventType,JSON.stringify({
          channel: "email", to: email, encryptedParameters: {
            otp: encryptSecret(otp,this.config.mfaEncryptionKey).toString("base64"),
          }, expiresAt: expiresAt.toISOString(),
        }),key],
      );
      await client.query("COMMIT");
      return { challengeId, expiresAt: expiresAt.toISOString(), emailDisplay: purpose === "register" ? email : null, sent: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async startLogin(identifier: string): Promise<AuthResult> {
    const supplied = identifier.trim();
    const isEmail = supplied.includes("@");
    let phone: string | null = null;
    if (!isEmail) {
      try { phone = normalizeEgyptianPhone(supplied); }
      catch { return { challengeId: randomUUID(), expiresAt: new Date(Date.now()+300_000).toISOString(), emailDisplay:null, sent:false }; }
    }
    const result = await this.pool.query<{ id: string; email: string }>(
      "SELECT u.id::text,u.email FROM users u WHERE u.account_type='customer' AND u.status='active' AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL AND u.email IS NOT NULL AND (u.email_normalized=$1 OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM account_phones p WHERE p.user_id=u.id AND p.account_type='customer' AND p.is_primary AND p.phone_normalized=$2))) LIMIT 1",
      [isEmail ? normalizeEmail(supplied) : "",phone],
    );
    const row=result.rows[0];
    if (!row) return { challengeId:randomUUID(), expiresAt:new Date(Date.now()+300_000).toISOString(),emailDisplay:isEmail?supplied:null,sent:false };
    const start=await this.issue("login", row.email, row.id, null);
    // Display the full address only if the visitor already typed it, not when guessing someone's phone.
    return {...start,emailDisplay:isEmail?supplied:null};
  }

  async startSignup(input: {name:string;phone1:string;email:string;birthday:string}): Promise<AuthResult> {
    const email=normalizeEmail(input.email);
    let phone:string;
    try{phone=normalizeEgyptianPhone(input.phone1);}catch{throw new AppError(422,"PHONE_INVALID","Enter a valid Egyptian phone number");}
    const duplicate=await this.pool.query<{present:boolean}>(
      "SELECT EXISTS(SELECT 1 FROM users u WHERE u.account_type='customer' AND u.deleted_at IS NULL AND (u.email_normalized=$1 OR EXISTS(SELECT 1 FROM account_phones p WHERE p.user_id=u.id AND p.account_type='customer' AND p.phone_normalized=$2))) AS present",
      [email,phone],
    );
    if(duplicate.rows[0]?.present)throw new AppError(409,"ACCOUNT_ALREADY_EXISTS","This email or phone is already registered. Use sign in or contact Dart support.");
    return this.issue("register",input.email,null,{name:input.name,phone1:input.phone1,birthday:input.birthday});
  }

  async verify(challengeId:string, code:string, purpose:"login"|"register", meta:RequestMetadata):Promise<IssuedSession> {
    const client=await this.pool.connect();
    let challenge:ChallengeRow | null = null;
    try {
      await client.query("BEGIN");
      const query=await client.query<ChallengeRow>(
        "SELECT * FROM customer_email_otp_challenges WHERE id=$1 AND purpose=$2 FOR UPDATE",
        [challengeId,purpose],
      );
      const row=query.rows[0];
      if(!row||row.consumed_at||row.expires_at.getTime()<=Date.now()||row.attempts_remaining<=0){
        throw new AppError(400,"OTP_INVALID","The code is invalid or expired");
      }
      if(!safeEqual(digest("customer-email-otp:"+challengeId+":"+code,this.config.authPepper),row.code_hash)){
        await client.query("UPDATE customer_email_otp_challenges SET attempts_remaining=GREATEST(0,attempts_remaining-1) WHERE id=$1",[challengeId]);
        await client.query("COMMIT");
        throw new AppError(400,"OTP_INVALID","The code is invalid or expired");
      }
      await client.query("UPDATE customer_email_otp_challenges SET consumed_at=now() WHERE id=$1",[challengeId]);
      await client.query("COMMIT");
      challenge=row;
    } catch(error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    } finally { client.release(); }
    if(!challenge)throw new AppError(400,"OTP_INVALID","The code is invalid or expired");
    if(purpose==="login"){
      if(!challenge.user_id)throw new AppError(400,"OTP_INVALID","The code is invalid or expired");
      return this.identity.loginLinkedSocialCustomer(challenge.user_id,meta,"email_otp");
    }
    if(!challenge.signup_data)throw new AppError(400,"OTP_INVALID","The code is invalid or expired");
    return this.identity.registerVerifiedEmailCustomer({
      ...challenge.signup_data,email:challenge.email,
    },meta);
  }
}
