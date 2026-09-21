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

function textParameters(payload: Record<string, unknown>): string[] {
  const parameters = payload.parameters;
  if (Array.isArray(parameters)) {
    return parameters.map((value) => String(value ?? "").trim()).filter(Boolean);
  }
  if (parameters && typeof parameters === "object") {
    return Object.values(parameters as Record<string, unknown>)
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }
  return [];
}

export class OutboxService {
  public constructor(
    private readonly pool: Pool,
    private readonly config: Pick<
      AppConfig,
      | "whatsappAccessToken"
      | "whatsappPhoneNumberId"
      | "whatsappGraphApiVersion"
      | "whatsappTemplateLanguage"
      | "outboxBatchSize"
      | "mfaEncryptionKey"
    >,
  ) {}

  public configured(): boolean {
    const version = this.config.whatsappGraphApiVersion || "v26.0";
    return Boolean(
      this.config.whatsappAccessToken &&
        this.config.whatsappPhoneNumberId &&
        /^v\d+\.\d+$/.test(version),
    );
  }

  public async processBatch(
    limit = this.config.outboxBatchSize,
    deduplicationKey?: string,
  ): Promise<{
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
            AND payload->>'channel' = 'whatsapp'
            AND ($2::text IS NULL OR deduplication_key=$2)
            AND (
              status IN ('pending','failed')
              OR (status='processing' AND locked_at < now() - interval '5 minutes')
            )
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.min(100, Math.max(1, limit)), deduplicationKey || null],
      );
      rows = result.rows;
      if (rows.length) {
        await client.query(
          `UPDATE outbox_events
              SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
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
        await this.publishWhatsApp(row);
        published += 1;
        await this.pool.query(
          `UPDATE outbox_events
              SET status='published', published_at=now(), locked_at=NULL,
                  last_error=NULL, updated_at=now()
            WHERE id=$1`,
          [row.id],
        );
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message.slice(0, 1000) : "Unknown WhatsApp delivery error";
        const nextAttemptSeconds = Math.min(
          3600,
          Math.max(15, 2 ** Math.min(10, row.attempts + 1) * 15),
        );
        await this.pool.query(
          `UPDATE outbox_events
              SET status='failed',
                  available_at=now() + ($2::text || ' seconds')::interval,
                  locked_at=NULL, last_error=$3, updated_at=now()
            WHERE id=$1`,
          [row.id, String(nextAttemptSeconds), message],
        );
      }
    }

    return { configured: true, claimed: rows.length, published, failed };
  }

  private externalPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...payload };
    const encrypted = payload.encryptedParameters;
    if (encrypted && typeof encrypted === "object" && !Array.isArray(encrypted)) {
      const parameters: Record<string, string> = {};
      for (const [key, value] of Object.entries(encrypted as Record<string, unknown>)) {
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

  private async publishWhatsApp(row: OutboxRow): Promise<void> {
    const payload = this.externalPayload(row.payload || {});
    const to = String(payload.to || "").replace(/\D/g, "");
    const template = String(payload.template || "").trim();
    const languageCode = String(
      payload.languageCode || this.config.whatsappTemplateLanguage || "ar",
    ).trim();

    if (!/^\d{8,15}$/.test(to)) throw new Error("WhatsApp recipient is missing or invalid");
    if (!/^[a-z0-9_]+$/.test(template)) throw new Error("WhatsApp template is missing or invalid");
    if (!languageCode) throw new Error("WhatsApp template language is missing");

    const parameters = textParameters(payload);
    const bodyComponent = parameters.length
      ? {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        }
      : undefined;
    const authenticationOtp = payload.authenticationOtp === true;
    const otp = parameters[0] || "";
    const components = authenticationOtp && otp
      ? [
          bodyComponent!,
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: otp }],
          },
        ]
      : bodyComponent
        ? [bodyComponent]
        : undefined;

    const response = await fetch(
      `https://graph.facebook.com/${this.config.whatsappGraphApiVersion || "v26.0"}/${this.config.whatsappPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.whatsappAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: template,
            language: { code: languageCode },
            ...(components ? { components } : {}),
          },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `WhatsApp Cloud API returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      );
    }
  }
}
