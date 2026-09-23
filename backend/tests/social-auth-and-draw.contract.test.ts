// DART CODE GUIDE | backend/tests/social-auth-and-draw.contract.test.ts
// الغرض: يحمي OAuth الاجتماعي للعملاء وقاعدة حتى 3 فائزين في تعادل Dart Card الكامل.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadSocialAuthConfig,
  SocialAuthConfigError,
} from "../src/modules/identity/social-auth.service.js";
import {
  selectExactTieWinners,
  type DartCardCandidate,
} from "../src/modules/loyalty/dart-card-draw.service.js";

const base = {
  port: 4000,
  corsOrigins: ["http://localhost:4173"],
  authPepper: "test-social-auth-pepper-at-least-32-characters",
};

function candidate(id: number): DartCardCandidate {
  return {
    userId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    clientCode: `DR-${id}`,
    name: `Customer ${id}`,
    pieceCount: 12,
    netSpendMinor: 850000,
  };
}

describe("customer social auth and Dart Card tie contracts", () => {
  it("keeps social providers disabled until complete server-side credentials exist", () => {
    const config = loadSocialAuthConfig({}, base);
    expect(config.googleClientId).toBeNull();
    expect(config.googleClientSecret).toBeNull();
    expect(config.facebookAppId).toBeNull();
    expect(config.facebookAppSecret).toBeNull();

    expect(() =>
      loadSocialAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: "id-only" }, base),
    ).toThrow(SocialAuthConfigError);
    expect(() =>
      loadSocialAuthConfig({ FACEBOOK_OAUTH_APP_SECRET: "secret-only" }, base),
    ).toThrow(SocialAuthConfigError);
  });

  it("awards every exact top tie up to three customers", () => {
    expect(selectExactTieWinners([candidate(1)])).toHaveLength(1);
    expect(selectExactTieWinners([candidate(1), candidate(2)])).toHaveLength(2);
    expect(
      selectExactTieWinners([candidate(1), candidate(2), candidate(3)]),
    ).toHaveLength(3);
  });

  it("selects exactly three distinct winners when four or more customers tie exactly", () => {
    const winners = selectExactTieWinners(
      [candidate(1), candidate(2), candidate(3), candidate(4)],
      3,
      () => 0,
    );
    expect(winners.map((winner) => winner.clientCode)).toEqual([
      "DR-1",
      "DR-2",
      "DR-3",
    ]);
    expect(new Set(winners.map((winner) => winner.userId)).size).toBe(3);
  });

  it("stores only hashed social capabilities and persists all draw winners", async () => {
    const path = fileURLToPath(
      new URL(
        "../migrations/0038_customer_social_auth_and_multi_winner_draw.sql",
        import.meta.url,
      ),
    );
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("state_hash CHAR(64)");
    expect(sql).toContain("completion_hash CHAR(64)");
    expect(sql).not.toContain("access_token");
    expect(sql).not.toContain("refresh_token");
    expect(sql).toContain("CUSTOMER_BIRTHDAY_REQUIRED");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS dart_card_draw_winners");
    expect(sql).toContain("winner_count BETWEEN 0 AND 3");
  });
});
