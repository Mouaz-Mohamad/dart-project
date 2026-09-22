import { AppError } from "../../http/app-error.js";
import { normalizeEmail } from "../../security/normalization.js";

export interface SupabaseGoogleConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseProjectRef: string;
  googleClientId: string;
  supabaseAuthTimeoutMs: number;
}

export interface VerifiedGoogleIdentity {
  supabaseUserId: string;
  providerSubject: string;
  email: string;
  emailNormalized: string;
  provider: "google";
}

interface JwtPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
  role?: unknown;
  is_anonymous?: unknown;
  amr?: unknown;
}

interface SupabaseIdentity {
  provider?: unknown;
  provider_id?: unknown;
}

interface SupabaseUser {
  id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  is_anonymous?: unknown;
  app_metadata?: unknown;
  identities?: unknown;
}

function authUnavailable(): AppError {
  return new AppError(
    503,
    "SUPABASE_AUTH_UNAVAILABLE",
    "Dashboard sign-in is temporarily unavailable. Please try again shortly.",
  );
}

function identityRejected(): AppError {
  return new AppError(
    401,
    "GOOGLE_IDENTITY_INVALID",
    "This Google sign-in could not be verified.",
  );
}

function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw identityRejected();
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JwtPayload;
  } catch {
    throw identityRejected();
  }
}

function audienceContainsAuthenticated(value: unknown): boolean {
  if (typeof value === "string") return value === "authenticated";
  return Array.isArray(value) && value.some((entry) => entry === "authenticated");
}

function hasOAuthAmr(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { method?: unknown }).method === "oauth";
  });
}

function googleIdentityFromUser(user: SupabaseUser): SupabaseIdentity | null {
  if (!Array.isArray(user.identities) || user.identities.length !== 1) return null;
  const identity = user.identities[0];
  if (!identity || typeof identity !== "object") return null;
  const candidate = identity as SupabaseIdentity;
  return candidate.provider === "google" ? candidate : null;
}

function googleProviderOnly(user: SupabaseUser): boolean {
  if (!user.app_metadata || typeof user.app_metadata !== "object") return false;
  const metadata = user.app_metadata as {
    provider?: unknown;
    providers?: unknown;
  };
  if (metadata.provider !== "google") return false;
  if (!Array.isArray(metadata.providers) || metadata.providers.length !== 1) return false;
  return metadata.providers[0] === "google";
}

export async function verifySupabaseGoogleAccessToken(
  token: string,
  config: SupabaseGoogleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedGoogleIdentity> {
  const accessToken = token.trim();
  if (!accessToken || accessToken.length > 8192) throw identityRejected();

  const baseUrl = new URL(config.supabaseUrl);
  const expectedHost = `${config.supabaseProjectRef}.supabase.co`;
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.hostname !== expectedHost ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("Supabase project configuration mismatch");
  }

  const expectedIssuer = `${baseUrl.origin}/auth/v1`;
  const payload = decodeJwtPayload(accessToken);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    payload.iss !== expectedIssuer ||
    !audienceContainsAuthenticated(payload.aud) ||
    typeof payload.exp !== "number" ||
    payload.exp <= nowSeconds ||
    (typeof payload.nbf === "number" && payload.nbf > nowSeconds + 30) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.email !== "string" ||
    !payload.email ||
    payload.role !== "authenticated" ||
    payload.is_anonymous === true ||
    !hasOAuthAmr(payload.amr)
  ) {
    throw identityRejected();
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.origin}/auth/v1/user`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(config.supabaseAuthTimeoutMs),
    });
  } catch {
    throw authUnavailable();
  }

  if (response.status === 401 || response.status === 403) throw identityRejected();
  if (response.status === 429 || response.status >= 500) throw authUnavailable();
  if (!response.ok) throw identityRejected();

  let user: SupabaseUser;
  try {
    user = (await response.json()) as SupabaseUser;
  } catch {
    throw authUnavailable();
  }

  const googleIdentity = googleIdentityFromUser(user);
  const providerSubject = googleIdentity?.provider_id;
  const userEmail = typeof user.email === "string" ? user.email : "";
  const userId = typeof user.id === "string" ? user.id : "";
  const emailNormalized = normalizeEmail(userEmail);
  const tokenEmailNormalized = normalizeEmail(String(payload.email));

  if (
    !userId ||
    userId !== payload.sub ||
    !userEmail ||
    emailNormalized !== tokenEmailNormalized ||
    !user.email_confirmed_at ||
    user.is_anonymous === true ||
    !googleProviderOnly(user) ||
    !googleIdentity ||
    typeof providerSubject !== "string" ||
    !providerSubject
  ) {
    throw identityRejected();
  }

  return {
    supabaseUserId: userId,
    providerSubject,
    email: userEmail,
    emailNormalized,
    provider: "google",
  };
}
