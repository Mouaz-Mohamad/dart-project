import { describe, expect, it, vi } from "vitest";
import { verifySupabaseGoogleAccessToken } from "../src/modules/identity/supabase-google.js";

const config = {
  supabaseUrl: "https://darttest.supabase.co",
  supabasePublishableKey: "sb_publishable_test",
  supabaseProjectRef: "darttest",
  googleClientId: "123456789.apps.googleusercontent.com",
  supabaseAuthTimeoutMs: 6_000,
};

function token(payloadOverrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://darttest.supabase.co/auth/v1",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
      is_anonymous: false,
      amr: [{ method: "oauth", timestamp: Date.now() }],
      ...payloadOverrides,
    }),
  ).toString("base64url");
  return `${header}.${payload}.not-a-real-signature`;
}

function googleUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    email_confirmed_at: new Date().toISOString(),
    is_anonymous: false,
    app_metadata: {
      provider: "google",
      providers: ["google"],
    },
    identities: [
      {
        provider: "google",
        provider_id: "google-subject-123",
      },
    ],
    ...overrides,
  };
}

function fetchUser(
  body: unknown = googleUser(),
  status = 200,
): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("Supabase Google identity verifier", () => {
  it("accepts a Google-only Supabase user from the configured Dart project", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser(),
      ),
    ).resolves.toEqual({
      supabaseUserId: "11111111-1111-4111-8111-111111111111",
      providerSubject: "google-subject-123",
      email: "owner@example.com",
      emailNormalized: "owner@example.com",
      provider: "google",
    });
  });

  it("rejects tokens from another Supabase project before calling Auth", async () => {
    const fetchMock = fetchUser();
    await expect(
      verifySupabaseGoogleAccessToken(
        token({
          iss: "https://other.supabase.co/auth/v1",
        }),
        config,
        fetchMock,
      ),
    ).rejects.toMatchObject({
      code: "GOOGLE_IDENTITY_INVALID",
      statusCode: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired or wrong-audience tokens", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token({ exp: Math.floor(Date.now() / 1000) - 1 }),
        config,
        fetchUser(),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });

    await expect(
      verifySupabaseGoogleAccessToken(
        token({ aud: "another-audience" }),
        config,
        fetchUser(),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
  });

  it("rejects non-OAuth or anonymous tokens", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token({ amr: [{ method: "password" }] }),
        config,
        fetchUser(),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });

    await expect(
      verifySupabaseGoogleAccessToken(
        token({ is_anonymous: true }),
        config,
        fetchUser(),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
  });

  it("rejects an unverified email or a provider other than Google", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser(
          googleUser({
            email_confirmed_at: null,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });

    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser({
          ...googleUser(),
          app_metadata: {
            provider: "github",
            providers: ["github"],
          },
          identities: [
            {
              provider: "github",
              provider_id: "github-subject",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
  });

  it("rejects mixed providers even when Google is present", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser({
          ...googleUser(),
          app_metadata: {
            provider: "google",
            providers: ["google", "email"],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
  });

  it("rejects mismatched subject or email returned by Supabase Auth", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser(googleUser({ id: "22222222-2222-4222-8222-222222222222" })),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });

    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser(googleUser({ email: "other@example.com" })),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_IDENTITY_INVALID" });
  });

  it("rejects an invalid token signature when Supabase Auth rejects the bearer token", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser({ error: "invalid_jwt" }, 401),
      ),
    ).rejects.toMatchObject({
      code: "GOOGLE_IDENTITY_INVALID",
      statusCode: 401,
    });
  });

  it("maps Supabase outage responses to a safe unavailable error", async () => {
    await expect(
      verifySupabaseGoogleAccessToken(
        token(),
        config,
        fetchUser({ error: "down" }, 503),
      ),
    ).rejects.toMatchObject({
      code: "SUPABASE_AUTH_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
