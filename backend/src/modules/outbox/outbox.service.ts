import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { decryptSecret } from "../../security/crypto.js";

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export class OutboxService {
  public constructor(
    private readonly pool: Pool,
    private readonly config: Pick<
      AppConfig,
      | "automationWebhookUrl"
      | "automationWebhookSecret"
      | "outboxBatchSize"
      | "mfaEncryptionKey"
    >,
  ) {}

  public configured(): boolean {
    return Boolean(
      this.config.automationWebhookUrl &&
        this.config.automationWebhookSecret &&
        this.config.automationWebhookSecret.length >= 32,
    );
  }

  public async processBatch(limit = this.config.outboxBatchSize): Promise<{
    configured: boolean;
    claimed: number;
    published: number;
    failed: number;
  }> {
    if (!this.configured()) {
      return { configured: false, claimed: 0, published: 0, failed: 0 };
    }

    const client = await this.pool.connect();
    let rows: OutboxRow[] = [];
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `SELECT id::text, aggregate_type, aggregate_id, event_type, payload, attempts
           FROM outbox_events
          WHERE attempts < 12
            AND available_at <= now()
            AND (
              status IN ('pending','failed')
              OR (status='processing' AND locked_at < now() - interval '5 minutes')
            )
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.min(100, Math.max(1, limit))],
      );
      rows = result.rows;
      if (rows.length) {
        await client.query(
          `UPDATE outbox_events
              SET status='processing',
                  locked_at=now(),
                  attempts=attempts+1,
                  updated_at=now()
            WHERE id = ANY($1::uuid[])`,
          [rows.map((row) => row.id)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let published = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.publish(row);
        published += 1;
        await this.pool.query(
          `UPDATE outbox_events
              SET status='published',
                  published_at=now(),
                  locked_at=NULL,
                  last_error=NULL,
                  updated_at=now()
            WHERE id=$1`,
          [row.id],
        );
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message.slice(0, 1000) : "Unknown delivery error";
        const nextAttemptSeconds = Math.min(
          3600,
          Math.max(15, 2 ** Math.min(10, row.attempts + 1) * 15),
        );
        await this.pool.query(
          `UPDATE outbox_events
              SET status='failed',
                  available_at=now() + ($2::text || ' seconds')::interval,
                  locked_at=NULL,
                  last_error=$3,
                  updated_at=now()
            WHERE id=$1`,
          [row.id, String(nextAttemptSeconds), message],
        );
      }
    }

    return {
      configured: true,
      claimed: rows.length,
      published,
      failed,
    };
  }

  private externalPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...payload };
    const encrypted = payload.encryptedParameters;
    if (encrypted && typeof encrypted === "object" && !Array.isArray(encrypted)) {
      const parameters: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        encrypted as Record<string, unknown>,
      )) {
        if (typeof value !== "string" || !value) continue;
        parameters[key] = decryptSecret(
          Buffer.from(value, "base64"),
          this.config.mfaEncryptionKey,
        );
      }
      copy.parameters = parameters;
      delete copy.encryptedParameters;
    }
    return copy;
  }

  private async publish(row: OutboxRow): Promise<void> {
    const url = this.config.automationWebhookUrl!;
    const secret = this.config.automationWebhookSecret!;
    const body = JSON.stringify({
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: this.externalPayload(row.payload || {}),
    });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dart-Event-Id": row.id,
        "X-Dart-Event-Type": row.event_type,
        "X-Dart-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Automation webhook returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      );
    }
  }
}
