// DART CODE GUIDE | backend/src/modules/outbox/outbox.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { decryptSecret } from "../../security/crypto.js";
import type { EmailProvider } from "./email-provider.js";
import { renderOutboxEmail } from "./email-templates.js";

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  deduplication_key: string | null;
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

function safeDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown delivery error";
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,15}\b/g, "[phone]")
    .slice(0, 1000);
}

function maskRecipient(channel: string, recipient: string): string {
  if (channel === "email") {
    const [local = "", domain = ""] = recipient.split("@");
    return domain ? `${local.slice(0, 1) || "*"}***@${domain}` : "***";
  }
  const digits = recipient.replace(/\D/g, "");
  return digits ? `***${digits.slice(-4)}` : "***";
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
    private readonly emailProvider: EmailProvider | null = null,
  ) {}

  public configured(channel?: "email" | "whatsapp"): boolean {
    const whatsapp = Boolean(
      this.config.whatsappAccessToken &&
        this.config.whatsappPhoneNumberId &&
        /^v\d+\.\d+$/.test(this.config.whatsappGraphApiVersion || "v26.0"),
    );
    const email = this.emailProvider?.configured() === true;
    if (channel === "email") return email;
    if (channel === "whatsapp") return whatsapp;
    return email || whatsapp;
  }

  public async recentEvents(limit = 50): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<{
      id: string;
      event_type: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: Date;
      updated_at: Date;
      published_at: Date | null;
      channel: string;
      recipient: string;
    }>(
      `SELECT id::text, event_type, status, attempts, last_error,
              created_at, updated_at, published_at,
              COALESCE(payload->>'channel','') AS channel,
              COALESCE(payload->>'to','') AS recipient
         FROM outbox_events
        WHERE payload->>'channel' IN ('email','whatsapp')
        ORDER BY created_at DESC
        LIMIT $1`,
      [Math.min(100, Math.max(1, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      channel: row.channel,
      recipient: maskRecipient(row.channel, row.recipient),
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      publishedAt: row.published_at?.toISOString() || null,
    }));
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
    const client = await this.pool.connect();
    let rows: OutboxRow[] = [];
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `SELECT id::text, aggregate_type, aggregate_id, event_type,
                deduplication_key, payload, attempts
           FROM outbox_events
          WHERE attempts < 12
            AND available_at <= now()
            AND payload->>'channel' IN ('email','whatsapp')
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
        await this.publish(row);
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
          [row.id, String(nextAttemptSeconds), safeDeliveryError(error)],
        );
      }
    }

    return {
      configured: this.configured(),
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

  private async publish(row: OutboxRow): Promise<void> {
    const channel = String(row.payload?.channel || "");
    if (channel === "email") {
      await this.publishEmail(row);
      return;
    }
    if (channel === "whatsapp") {
      await this.publishWhatsApp(row);
      return;
    }
    throw new Error("Unsupported outbox delivery channel");
  }

  private async publishEmail(row: OutboxRow): Promise<void> {
    if (!this.emailProvider?.configured()) {
      throw new Error("SMTP email delivery is not configured");
    }
    if (!(await this.emailChallengeIsActive(row))) return;
    const payload = this.externalPayload(row.payload || {});
    const to = String(payload.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new Error("Email recipient is missing or invalid");
    }
    const rendered = renderOutboxEmail(row.event_type, payload);
    await this.emailProvider.send({ to, ...rendered });
  }

  private async emailChallengeIsActive(row: OutboxRow): Promise<boolean> {
    const challengeSources: Record<string, { prefix: string; table: string }> = {
      STAFF_INVITED: {
        prefix: "staff-onboarding-code:",
        table: "staff_onboarding_challenges",
      },
      STAFF_ONBOARDING_CODE_REQUESTED: {
        prefix: "staff-onboarding-code:",
        table: "staff_onboarding_challenges",
      },
      STAFF_EMAIL_ACCESS_CODE_REQUESTED: {
        prefix: "staff-email-access-code:",
        table: "staff_email_login_challenges",
      },
      EMAIL_VERIFICATION_REQUESTED: {
        prefix: "email-verification:",
        table: "email_verification_challenges",
      },
      EMAIL_CHANGE_VERIFICATION_REQUESTED: {
        prefix: "email-change-verification:",
        table: "email_verification_challenges",
      },
    };
    const source = challengeSources[row.event_type];
    if (!source) return true;
    const challengeId = row.deduplication_key?.startsWith(source.prefix)
      ? row.deduplication_key.slice(source.prefix.length)
      : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
      throw new Error("Email OTP event is missing a valid challenge identity");
    }
    const result = await this.pool.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${source.table}
          WHERE id=$1 AND consumed_at IS NULL AND expires_at > now()
       ) AS active`,
      [challengeId],
    );
    return result.rows[0]?.active === true;
  }

  private async publishWhatsApp(row: OutboxRow): Promise<void> {
    if (!this.configured("whatsapp")) {
      throw new Error("WhatsApp Business Platform delivery is not configured");
    }
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
      throw new Error(`WhatsApp Cloud API returned ${response.status}`);
    }
  }
}
