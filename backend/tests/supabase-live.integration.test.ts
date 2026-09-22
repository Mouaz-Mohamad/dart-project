import { describe, expect, it } from "vitest";
import { verifySupabaseGoogleAccessToken } from "../src/modules/identity/supabase-google.js";

const accessToken = process.env.SUPABASE_TEST_ACCESS_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const googleClientId = process.env.GOOGLE_CLIENT_ID;

const configured = Boolean(
  accessToken &&
    supabaseUrl &&
    publishableKey &&
    projectRef &&
    googleClientId,
);

describe.skipIf(!configured)("live Supabase Google identity", () => {
  it("verifies a real test-project Google session when optional credentials are supplied", async () => {
    const identity = await verifySupabaseGoogleAccessToken(
      accessToken!,
      {
        supabaseUrl: supabaseUrl!,
        supabasePublishableKey: publishableKey!,
        supabaseProjectRef: projectRef!,
        googleClientId: googleClientId!,
        supabaseAuthTimeoutMs: 8_000,
      },
    );
    expect(identity.provider).toBe("google");
    expect(identity.supabaseUserId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(identity.emailNormalized).toContain("@");
    expect(identity.providerSubject.length).toBeGreaterThan(2);
  });
});
