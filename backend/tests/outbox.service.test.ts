import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import type { EmailProvider } from "../src/modules/outbox/email-provider.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";

describe("email outbox challenge safety", () => {
  it("marks a superseded Staff OTP processed without sending it", async () => {
    const challengeId = randomUUID();
    const eventId = randomUUID();
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id::text")) {
        return {
          rows: [
            {
              id: eventId,
              aggregate_type: "staff_invitation",
              aggregate_id: randomUUID(),
              event_type: "STAFF_ONBOARDING_CODE_REQUESTED",
              deduplication_key: `staff-onboarding-code:${challengeId}`,
              payload: { channel: "email", to: "owner@example.com" },
              attempts: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn().mockResolvedValue({
        query: clientQuery,
        release: vi.fn(),
      }),
      query: vi.fn(async (sql: string) =>
        sql.includes("SELECT EXISTS")
          ? { rows: [{ active: false }] }
          : { rows: [] },
      ),
    } as unknown as Pool;
    const provider = {
      configured: vi.fn().mockReturnValue(true),
      send: vi.fn(),
    } satisfies EmailProvider;
    const config: Pick<
      AppConfig,
      | "whatsappAccessToken"
      | "whatsappPhoneNumberId"
      | "whatsappGraphApiVersion"
      | "whatsappTemplateLanguage"
      | "outboxBatchSize"
      | "mfaEncryptionKey"
    > = {
      whatsappAccessToken: null,
      whatsappPhoneNumberId: null,
      whatsappGraphApiVersion: "v26.0",
      whatsappTemplateLanguage: "ar",
      outboxBatchSize: 20,
      mfaEncryptionKey: Buffer.alloc(32, 7),
    };

    const result = await new OutboxService(pool, config, provider).processBatch(
      1,
      `staff-onboarding-code:${challengeId}`,
    );

    expect(result).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("staff_onboarding_challenges"),
      [challengeId],
    );
  });
});
