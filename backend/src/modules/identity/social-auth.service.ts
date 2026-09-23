// DART CODE GUIDE | backend/src/modules/identity/social-auth.service.ts
// الغرض: OAuth اجتماعي آمن للعملاء فقط؛ مزود الهوية يثبت البريد ثم Dart يطلب بيانات الحساب المحلية.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { digest, randomToken, safeEqual } from "../../security/crypto.js";
import { normalizeEmail } from "../../security/normalization.js";
import { validateCustomerPasswordPolicy } from "../../security/password.js";
import type { IssuedSession, RequestMetadata } from "./identity.types.js";
import type { IdentityService } from "./identity.service.js";

export type SocialProvider = "google" | "facebook";
export type SocialDestination = "profile" | "checkout";

export class SocialAuthConfigError extends Error {
  public constructor(public readonly fields: string[]) {
    super(`Invalid social authentication configuration: ${fields.join(", ")}`);
    this.name = "SocialAuthConfigError";
  }
}

export interface SocialAuthConfig {
  apiPublicOrigin: string;
  customerAppOrigin: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  facebookAppId: string | null;
  facebookAppSecret: string | null;
  facebookGraphApiVersion: string;
  ttlMinutes: number;
  authPepper: string;
}

interface ProviderProfile {
  subject: string;
  email: string;
  emailNormalized: string;
  name: string;
}

interface SocialChallengeRow {
  id: string;
  provider: SocialProvider;
  completion_hash: string | null;
  provider_subject: string | null;
  provider_email: string | null;
  provider_email_normalized: string | null;
  provider_name: string | null;
  next_destination: SocialDestination;
  status: string;
  expires_at: Date;
}

function envText(source: NodeJS.ProcessEnv, key: string): string {
  return String(source[key] || "").trim();
}

function normalizedOrigin(value: string, fallback: string, field: string): string {
  const candidate = value || fallback;
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid origin");
    }
    return url.origin;
  } catch {
    throw new SocialAuthConfigError([field]);
  }
}

function providerPair(
  id: string,
  secret: string,
  idField: string,
  secretField: string,
): { id: string | null; secret: string | null } {
  if (Boolean(id) !== Boolean(secret)) {
    throw new SocialAuthConfigError([idField, secretField]);
  }
  return { id: id || null, secret: secret || null };
}

export function loadSocialAuthConfig(
  source: NodeJS.ProcessEnv,
  base: { port: number; corsOrigins: string[]; authPepper: string },
): SocialAuthConfig {
  const google = providerPair(
    envText(source, "GOOGLE_OAUTH_CLIENT_ID"),
    envText(source, "GOOGLE_OAUTH_CLIENT_SECRET"),
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  );
  const facebook = providerPair(
    envText(source, "FACEBOOK_OAUTH_APP_ID"),
    envText(source, "FACEBOOK_OAUTH_APP_SECRET"),
    "FACEBOOK_OAUTH_APP_ID",
    "FACEBOOK_OAUTH_APP_SECRET",
  );
  const rawVersion =
    envText(source, "FACEBOOK_GRAPH_API_VERSION") || "v26.0";
  if (!/^v\d+\.\d+$/.test(rawVersion)) {
    throw new SocialAuthConfigError(["FACEBOOK_GRAPH_API_VERSION"]);
  }
  const ttl = Number(envText(source, "SOCIAL_AUTH_TTL_MINUTES") || 10);
  if (!Number.isInteger(ttl) || ttl < 5 || ttl > 30) {
    throw new SocialAuthConfigError(["SOCIAL_AUTH_TTL_MINUTES"]);
  }
  return {
    apiPublicOrigin: normalizedOrigin(
      envText(source, "API_PUBLIC_ORIGIN"),
      `http://localhost:${base.port}`,
      "API_PUBLIC_ORIGIN",
    ),
    customerAppOrigin: normalizedOrigin(
      envText(source, "CUSTOMER_APP_ORIGIN"),
      base.corsOrigins[0] || "http://localhost:4173",
      "CUSTOMER_APP_ORIGIN",
    ),
    googleClientId: google.id,
    googleClientSecret: google.secret,
    facebookAppId: facebook.id,
    facebookAppSecret: facebook.secret,
    facebookGraphApiVersion: rawVersion,
    ttlMinutes: ttl,
    authPepper: base.authPepper,
  };
}

function parseCapabilityToken(
  value: string,
): { id: string; secret: string } | null {
  const match = String(value || "")
    .trim()
    .match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{32,})$/i,
    );
  return match ? { id: match[1]!, secret: match[2]! } : null;
}

function customerPasswordOrThrow(password: string): void {
  const problems = validateCustomerPasswordPolicy(password);
  if (problems.length) {
    throw new AppError(
      422,
      "WEAK_PASSWORD",
      "Password must contain at least 6 characters",
      problems,
    );
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  errorCode: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new AppError(
      502,
      errorCode,
      "The social provider is temporarily unavailable",
    );
  }
  const payload = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AppError(
      502,
      errorCode,
      "The social provider could not verify the sign-in request",
    );
  }
  return payload;
}

export class SocialAuthService {
  public constructor(
    private readonly pool: Pool,
    private readonly identity: IdentityService,
    private readonly config: SocialAuthConfig,
  ) {}

  public providers(): Record<SocialProvider, boolean> {
    return {
      google: Boolean(
        this.config.googleClientId && this.config.googleClientSecret,
      ),
      facebook: Boolean(
        this.config.facebookAppId && this.config.facebookAppSecret,
      ),
    };
  }

  private providerEnabled(provider: SocialProvider): void {
    if (!this.providers()[provider]) {
      throw new AppError(
        503,
        "SOCIAL_AUTH_NOT_CONFIGURED",
        `${provider} sign-in is not configured yet`,
      );
    }
  }

  private callbackUrl(provider: SocialProvider): string {
    return `${this.config.apiPublicOrigin}/api/v1/auth/social/${provider}/callback`;
  }

  public async start(
    provider: SocialProvider,
    destination: SocialDestination,
  ): Promise<string> {
    this.providerEnabled(provider);
    const id = randomUUID();
    const stateSecret = randomToken(32);
    const state = `${id}.${stateSecret}`;
    const stateHash = digest(
      `social-state:${id}:${stateSecret}`,
      this.config.authPepper,
    );
    const expiresAt = new Date(
      Date.now() + this.config.ttlMinutes * 60_000,
    );
    await this.pool.query(
      `INSERT INTO customer_social_auth_challenges(
         id,provider,state_hash,next_destination,status,expires_at
       ) VALUES ($1,$2,$3,$4,'pending_provider',$5)`,
      [id, provider, stateHash, destination, expiresAt],
    );

    if (provider === "google") {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: this.config.googleClientId!,
        redirect_uri: this.callbackUrl(provider),
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      }).toString();
      return url.toString();
    }

    const url = new URL(
      `https://www.facebook.com/${this.config.facebookGraphApiVersion}/dialog/oauth`,
    );
    url.search = new URLSearchParams({
      client_id: this.config.facebookAppId!,
      redirect_uri: this.callbackUrl(provider),
      response_type: "code",
      scope: "email,public_profile",
      state,
    }).toString();
    return url.toString();
  }

  private async exchangeGoogle(code: string): Promise<ProviderProfile> {
    const tokenPayload = await fetchJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: this.config.googleClientId!,
          client_secret: this.config.googleClientSecret!,
          redirect_uri: this.callbackUrl("google"),
          grant_type: "authorization_code",
        }),
      },
      "GOOGLE_OAUTH_EXCHANGE_FAILED",
    );
    const accessToken = String(tokenPayload.access_token || "");
    if (!accessToken) {
      throw new AppError(
        502,
        "GOOGLE_OAUTH_EXCHANGE_FAILED",
        "Google did not return a usable sign-in token",
      );
    }
    const profile = await fetchJson(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "GOOGLE_PROFILE_FAILED",
    );
    const email = String(profile.email || "").trim();
    const subject = String(profile.sub || "").trim();
    if (!email || !subject || profile.email_verified === false) {
      throw new AppError(
        422,
        "SOCIAL_EMAIL_REQUIRED",
        "A verified Google email is required for a Dart account",
      );
    }
    return {
      subject,
      email,
      emailNormalized: normalizeEmail(email),
      name: String(profile.name || "").trim(),
    };
  }

  private async exchangeFacebook(code: string): Promise<ProviderProfile> {
    const tokenPayload = await fetchJson(
      `https://graph.facebook.com/${this.config.facebookGraphApiVersion}/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.facebookAppId!,
          client_secret: this.config.facebookAppSecret!,
          redirect_uri: this.callbackUrl("facebook"),
          code,
        }),
      },
      "FACEBOOK_OAUTH_EXCHANGE_FAILED",
    );
    const accessToken = String(tokenPayload.access_token || "");
    if (!accessToken) {
      throw new AppError(
        502,
        "FACEBOOK_OAUTH_EXCHANGE_FAILED",
        "Facebook did not return a usable sign-in token",
      );
    }
    const profile = await fetchJson(
      `https://graph.facebook.com/${this.config.facebookGraphApiVersion}/me?fields=id,name,email`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "FACEBOOK_PROFILE_FAILED",
    );
    const email = String(profile.email || "").trim();
    const subject = String(profile.id || "").trim();
    if (!email || !subject) {
      throw new AppError(
        422,
        "SOCIAL_EMAIL_REQUIRED",
        "Facebook must share an email address to use Dart social sign-in",
      );
    }
    return {
      subject,
      email,
      emailNormalized: normalizeEmail(email),
      name: String(profile.name || "").trim(),
    };
  }

  public async completeProviderCallback(
    provider: SocialProvider,
    code: string,
    state: string,
  ): Promise<string> {
    this.providerEnabled(provider);
    const token = parseCapabilityToken(state);
    if (!token || !code) {
      throw new AppError(
        400,
        "SOCIAL_STATE_INVALID",
        "The social sign-in request is invalid or expired",
      );
    }
    const expectedState = digest(
      `social-state:${token.id}:${token.secret}`,
      this.config.authPepper,
    );
    const claimed = await this.pool.query<{
      next_destination: SocialDestination;
    }>(
      `UPDATE customer_social_auth_challenges
          SET status='provider_exchange',updated_at=now()
        WHERE id=$1 AND provider=$2 AND state_hash=$3
          AND status='pending_provider' AND expires_at>now()
        RETURNING next_destination`,
      [token.id, provider, expectedState],
    );
    if (!claimed.rows[0]) {
      throw new AppError(
        400,
        "SOCIAL_STATE_INVALID",
        "The social sign-in request is invalid or expired",
      );
    }

    try {
      const profile =
        provider === "google"
          ? await this.exchangeGoogle(code)
          : await this.exchangeFacebook(code);
      const completionSecret = randomToken(32);
      const completionHash = digest(
        `social-complete:${token.id}:${completionSecret}`,
        this.config.authPepper,
      );
      const saved = await this.pool.query<{
        next_destination: SocialDestination;
      }>(
        `UPDATE customer_social_auth_challenges
            SET completion_hash=$2,provider_subject=$3,provider_email=$4,
                provider_email_normalized=$5,provider_name=$6,
                status='pending_completion',updated_at=now()
          WHERE id=$1 AND provider=$7 AND status='provider_exchange' AND expires_at>now()
          RETURNING next_destination`,
        [
          token.id,
          completionHash,
          profile.subject,
          profile.email,
          profile.emailNormalized,
          profile.name,
          provider,
        ],
      );
      if (!saved.rows[0]) {
        throw new AppError(
          400,
          "SOCIAL_STATE_INVALID",
          "The social sign-in request expired before completion",
        );
      }
      const fragment = new URLSearchParams({
        social_provider: provider,
        social_token: `${token.id}.${completionSecret}`,
        next: saved.rows[0].next_destination,
      });
      return `${this.config.customerAppOrigin}/Sign%20Up%20modern.html#${fragment.toString()}`;
    } catch (error) {
      await this.pool
        .query(
          `UPDATE customer_social_auth_challenges SET status='cancelled',updated_at=now()
            WHERE id=$1 AND status='provider_exchange'`,
          [token.id],
        )
        .catch(() => undefined);
      throw error;
    }
  }

  public async cancelProviderCallback(
    provider: SocialProvider,
    state: string,
  ): Promise<string> {
    const token = parseCapabilityToken(state);
    if (token) {
      const stateHash = digest(
        `social-state:${token.id}:${token.secret}`,
        this.config.authPepper,
      );
      await this.pool
        .query(
          `UPDATE customer_social_auth_challenges
              SET status='cancelled',updated_at=now()
            WHERE id=$1 AND provider=$2 AND state_hash=$3 AND status='pending_provider'`,
          [token.id, provider, stateHash],
        )
        .catch(() => undefined);
    }
    return this.failureRedirect(provider, "SOCIAL_AUTH_CANCELLED");
  }

  public failureRedirect(provider: SocialProvider, code: string): string {
    const fragment = new URLSearchParams({
      social_provider: provider,
      social_error: code,
    });
    return `${this.config.customerAppOrigin}/Sign%20Up%20modern.html#${fragment.toString()}`;
  }

  private async challengeRow(capability: string): Promise<SocialChallengeRow> {
    const token = parseCapabilityToken(capability);
    if (!token) {
      throw new AppError(
        400,
        "SOCIAL_CHALLENGE_INVALID",
        "The social sign-in request is invalid or expired",
      );
    }
    const completionHash = digest(
      `social-complete:${token.id}:${token.secret}`,
      this.config.authPepper,
    );
    const result = await this.pool.query<SocialChallengeRow>(
      `SELECT id::text,provider,completion_hash,provider_subject,provider_email,
              provider_email_normalized,provider_name,next_destination,status,expires_at
         FROM customer_social_auth_challenges
        WHERE id=$1 AND status='pending_completion' AND expires_at>now()`,
      [token.id],
    );
    const row = result.rows[0];
    if (
      !row?.completion_hash ||
      !safeEqual(completionHash, row.completion_hash)
    ) {
      throw new AppError(
        400,
        "SOCIAL_CHALLENGE_INVALID",
        "The social sign-in request is invalid or expired",
      );
    }
    return row;
  }

  private async existingCustomerForChallenge(
    row: SocialChallengeRow,
  ): Promise<{
    userId: string;
    email: string;
    birthday: string | null;
  } | null> {
    const linked = await this.pool.query<{
      user_id: string;
      email: string;
      birthday: string | null;
    }>(
      `SELECT u.id::text AS user_id,u.email,c.birthday::text
         FROM customer_social_identities si
         JOIN users u ON u.id=si.customer_user_id
         JOIN customers c ON c.user_id=u.id
        WHERE si.provider=$1 AND si.provider_subject=$2
          AND u.account_type='customer' AND u.deleted_at IS NULL
        LIMIT 1`,
      [row.provider, row.provider_subject],
    );
    if (linked.rows[0]) {
      return {
        userId: linked.rows[0].user_id,
        email: linked.rows[0].email,
        birthday: linked.rows[0].birthday,
      };
    }
    const byEmail = await this.pool.query<{
      user_id: string;
      email: string;
      birthday: string | null;
    }>(
      `SELECT u.id::text AS user_id,u.email,c.birthday::text
         FROM users u JOIN customers c ON c.user_id=u.id
        WHERE u.account_type='customer' AND u.email_normalized=$1 AND u.deleted_at IS NULL
        LIMIT 1`,
      [row.provider_email_normalized],
    );
    return byEmail.rows[0]
      ? {
          userId: byEmail.rows[0].user_id,
          email: byEmail.rows[0].email,
          birthday: byEmail.rows[0].birthday,
        }
      : null;
  }

  public async challenge(
    capability: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.challengeRow(capability);
    const existing = await this.existingCustomerForChallenge(row);
    return {
      provider: row.provider,
      email: row.provider_email,
      name: row.provider_name || "",
      accountExists: Boolean(existing),
      phoneRequired: !existing,
      birthdayAlreadySaved: Boolean(existing?.birthday),
      next: row.next_destination,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  private async linkIdentity(
    client: import("pg").PoolClient,
    row: SocialChallengeRow,
    userId: string,
  ): Promise<void> {
    const conflict = await client.query<{ customer_user_id: string }>(
      `SELECT customer_user_id::text
         FROM customer_social_identities
        WHERE provider=$1 AND provider_subject=$2
        FOR UPDATE`,
      [row.provider, row.provider_subject],
    );
    if (
      conflict.rows[0] &&
      conflict.rows[0].customer_user_id !== userId
    ) {
      throw new AppError(
        409,
        "SOCIAL_IDENTITY_ALREADY_LINKED",
        "This social account is already linked to another Dart customer",
      );
    }
    await client.query(
      `INSERT INTO customer_social_identities(
         provider,provider_subject,customer_user_id,provider_email_normalized,last_used_at
       ) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (provider,provider_subject) DO UPDATE SET
         provider_email_normalized=EXCLUDED.provider_email_normalized,
         last_used_at=now()`,
      [
        row.provider,
        row.provider_subject,
        userId,
        row.provider_email_normalized,
      ],
    );
  }

  public async complete(
    input: {
      token: string;
      password: string;
      confirmation: string;
      birthday: string;
      name?: string | undefined;
      phone1?: string | undefined;
      phone2?: string | undefined;
    },
    metadata: RequestMetadata,
  ): Promise<IssuedSession> {
    if (input.password !== input.confirmation) {
      throw new AppError(
        422,
        "PASSWORD_CONFIRMATION_MISMATCH",
        "Passwords do not match",
      );
    }
    customerPasswordOrThrow(input.password);
    const row = await this.challengeRow(input.token);
    if (
      !row.provider_subject ||
      !row.provider_email ||
      !row.provider_email_normalized
    ) {
      throw new AppError(
        400,
        "SOCIAL_CHALLENGE_INVALID",
        "The social profile is incomplete",
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `social-complete:${row.provider}:${row.provider_subject}`,
      ]);
      const locked = await client.query<SocialChallengeRow>(
        `SELECT id::text,provider,completion_hash,provider_subject,provider_email,
                provider_email_normalized,provider_name,next_destination,status,expires_at
           FROM customer_social_auth_challenges
          WHERE id=$1 FOR UPDATE`,
        [row.id],
      );
      const current = locked.rows[0];
      if (
        !current ||
        current.status !== "pending_completion" ||
        current.expires_at.getTime() <= Date.now()
      ) {
        throw new AppError(
          409,
          "SOCIAL_CHALLENGE_CONSUMED",
          "This social sign-in request was already used or expired",
        );
      }

      let existing = await this.existingCustomerForChallenge(current);
      let session: IssuedSession;
      let newlyRegistered = false;
      if (existing) {
        session = await this.identity.login(
          "customer",
          existing.email,
          input.password,
          metadata,
        );
        if (!existing.birthday) {
          await client.query(
            `UPDATE customers SET birthday=$2::date,updated_at=now() WHERE user_id=$1`,
            [existing.userId, input.birthday],
          );
        }
      } else {
        const name = String(
          input.name || current.provider_name || "",
        ).trim();
        const phone1 = String(input.phone1 || "").trim();
        if (name.length < 3 || !phone1) {
          throw new AppError(
            422,
            "SOCIAL_ACCOUNT_DETAILS_REQUIRED",
            "Name and primary phone are required for a new social account",
          );
        }
        session = await this.identity.registerCustomer(
          {
            name,
            email: current.provider_email!,
            phone1,
            ...(input.phone2?.trim()
              ? { phone2: input.phone2.trim() }
              : {}),
            birthday: input.birthday,
            password: input.password,
          },
          metadata,
        );
        existing = {
          userId: session.account.userId,
          email: current.provider_email!,
          birthday: input.birthday,
        };
        newlyRegistered = true;
      }

      await this.linkIdentity(client, current, existing.userId);
      await client.query(
        `UPDATE users
            SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now()
          WHERE id=$1 AND account_type='customer'`,
        [existing.userId],
      );
      await client.query(
        `UPDATE customer_social_auth_challenges
            SET status='consumed',completion_hash=NULL,consumed_at=now(),updated_at=now()
          WHERE id=$1`,
        [current.id],
      );
      await client.query(
        `INSERT INTO audit_logs(
           actor_type,actor_id,action,entity_type,entity_id,request_id,metadata
         ) VALUES ('customer',$1,$2,'customer_social_identities',$3,$4,$5::jsonb)`,
        [
          existing.userId,
          newlyRegistered
            ? "CUSTOMER_SOCIAL_ACCOUNT_CREATED"
            : "CUSTOMER_SOCIAL_LOGIN_COMPLETED",
          `${current.provider}:${current.provider_subject}`,
          metadata.requestId,
          JSON.stringify({
            provider: current.provider,
            newlyRegistered,
          }),
        ],
      );
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
