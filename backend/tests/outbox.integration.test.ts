import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { runMigrations } from "../src/database/migrate.js";
import type { EmailMessage, EmailProvider } from "../src/modules/outbox/email-provider.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { encryptSecret } from "../src/security/crypto.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = `dart_outbox_${randomUUID().replaceAll("-", "")}`;
let adminPool: Pool | undefined;
let pool: Pool | undefined;

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
  mfaEncryptionKey: Buffer.alloc(32, 5),
};

class FakeEmailProvider implements EmailProvider {
  public readonly messages: EmailMessage[] = [];
  public fail = false;
  public configured(): boolean { return true; }
  public async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error("SMTP rejected user@example.com 201001234567");
    this.messages.push(message);
  }
}

describe.skipIf(!databaseUrl)("email outbox", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schemaName},public`,
    });
    await runMigrations(pool, resolve(process.cwd(), "migrations"));
  });

  afterAll(async () => {
    await pool?.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminPool.end();
    }
  });

  it("sends an email event once and never duplicates a published event", async () => {
    const provider = new FakeEmailProvider();
    const service = new OutboxService(pool!, config, provider);
    const id = randomUUID();
    const otp = encryptSecret("123456", config.mfaEncryptionKey).toString("base64");
    await pool!.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, deduplication_key
      ) VALUES ('user',$1,'TEMPORARY_PASSWORD_ASSIGNED',$2::jsonb,$3)`,
      [
        id,
        JSON.stringify({
          channel: "email",
          to: "user@example.com",
          encryptedParameters: { temporaryPassword: otp },
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        `email-test:${id}`,
      ],
    );

    const first = await service.processBatch(5, `email-test:${id}`);
    const second = await service.processBatch(5, `email-test:${id}`);
    expect(first.published).toBe(1);
    expect(second.claimed).toBe(0);
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]!.text).toContain("123456");
  });

  it("marks provider failure with backoff and redacts recipient details", async () => {
    const provider = new FakeEmailProvider();
    provider.fail = true;
    const service = new OutboxService(pool!, config, provider);
    const id = randomUUID();
    const otp = encryptSecret("654321", config.mfaEncryptionKey).toString("base64");
    await pool!.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, deduplication_key
      ) VALUES ('user',$1,'TEMPORARY_PASSWORD_ASSIGNED',$2::jsonb,$3)`,
      [
        id,
        JSON.stringify({
          channel: "email",
          to: "user@example.com",
          encryptedParameters: { temporaryPassword: otp },
        }),
        `email-failure:${id}`,
      ],
    );

    const result = await service.processBatch(5, `email-failure:${id}`);
    expect(result.failed).toBe(1);
    const row = await pool!.query<{
      status: string;
      attempts: number;
      last_error: string;
      available_at: Date;
    }>(
      "SELECT status, attempts, last_error, available_at FROM outbox_events WHERE deduplication_key=$1",
      [`email-failure:${id}`],
    );
    expect(row.rows[0]!.status).toBe("failed");
    expect(row.rows[0]!.attempts).toBe(1);
    expect(row.rows[0]!.available_at.getTime()).toBeGreaterThan(Date.now());
    expect(row.rows[0]!.last_error).not.toContain("user@example.com");
    expect(row.rows[0]!.last_error).not.toContain("201001234567");
  });

  it("suppresses a superseded Staff OTP before calling SMTP", async () => {
    const provider = new FakeEmailProvider();
    const service = new OutboxService(pool!, config, provider);
    const invitationId = randomUUID();
    const missingChallengeId = randomUUID();
    const otp = encryptSecret("777777", config.mfaEncryptionKey).toString("base64");
    await pool!.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, deduplication_key
      ) VALUES ('staff_invitation',$1,'STAFF_ONBOARDING_CODE_REQUESTED',$2::jsonb,$3)`,
      [
        invitationId,
        JSON.stringify({
          channel: "email",
          to: "owner@example.com",
          encryptedParameters: { otp },
        }),
        `staff-onboarding-code:${missingChallengeId}`,
      ],
    );

    const result = await service.processBatch(
      1,
      `staff-onboarding-code:${missingChallengeId}`,
    );
    expect(result.published).toBe(1);
    expect(provider.messages).toHaveLength(0);
  });
});
