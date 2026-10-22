// DART CODE GUIDE | backend/src/modules/outbox/outbox.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { decryptSecret } from "../../security/crypto.js";
import type { EmailProvider } from "./email-provider.js";
import { renderOutboxEmail } from "./email-templates.js";

class DeliveryError extends Error {
  constructor(readonly disposition: "retryable" | "terminal" | "unknown", message: string) { super(message); }
}

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
      delivery_state: string | null;
      provider_message_id: string | null;
    }>(
      `SELECT e.id::text, e.event_type, e.status, e.attempts, COALESCE(a.last_error,e.last_error) AS last_error,
              e.created_at, e.updated_at, e.published_at, a.state AS delivery_state, a.provider_message_id,
              COALESCE(e.payload->>'channel','') AS channel,
              COALESCE(e.payload->>'to','') AS recipient
         FROM outbox_events e LEFT JOIN LATERAL (
           SELECT state,provider_message_id,last_error FROM outbox_delivery_attempts
            WHERE event_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1
         ) a ON true
        WHERE e.payload->>'channel' IN ('email','whatsapp')
        ORDER BY e.created_at DESC,e.id DESC
        LIMIT $1`,
      [Math.min(100, Math.max(1, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      channel: row.channel,
      recipient: maskRecipient(row.channel, row.recipient),
      status: row.delivery_state || row.status,
      eventStatus: row.status,
      providerMessageId: row.provider_message_id || null,
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
  ): Promise<{ configured: boolean; claimed: number; published: number; failed: number; uncertain: number; terminal: number }> {
    const client = await this.pool.connect();
    let rows: OutboxRow[] = [];
    try {
      await client.query("BEGIN");
      // A process which died during a provider call cannot be retried safely.
      await client.query(`UPDATE outbox_delivery_attempts SET state='unknown', updated_at=now(),
        last_error='Delivery outcome requires provider reconciliation'
        WHERE state='executing' AND updated_at<now()-interval '5 minutes'`);
      const result = await client.query<OutboxRow>(
        `SELECT id::text, aggregate_type, aggregate_id, event_type,
                deduplication_key, payload, attempts
           FROM outbox_events
          WHERE attempts < 12 AND available_at <= now()
            AND payload->>'channel' IN ('email','whatsapp')
            AND ($2::text IS NULL OR deduplication_key=$2)
            AND NOT EXISTS (SELECT 1 FROM outbox_delivery_attempts a
              WHERE a.event_id=outbox_events.id AND a.state IN ('executing','accepted','unknown','terminal','suppressed'))
            AND (status IN ('pending','failed') OR (status='processing' AND locked_at < now() - interval '5 minutes'))
          ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [Math.min(100, Math.max(1, limit)), deduplicationKey || null],
      );
      rows = result.rows;
      if (rows.length) await client.query(`UPDATE outbox_events
        SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
        WHERE id = ANY($1::uuid[])`, [rows.map(row => row.id)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }

    let published=0, failed=0, uncertain=0, terminal=0;
    for (const row of rows) {
      const attemptId=randomUUID();
      // Persist the send intent BEFORE contacting an external provider. A crash
      // or failed DB acknowledgement leaves a durable no-retry barrier.
      try {
        await this.pool.query(`INSERT INTO outbox_delivery_attempts(id,event_id,state)
          VALUES ($1,$2,'executing')`, [attemptId,row.id]);
      } catch {
        failed += 1;
        continue; // No external call was made. The expired lease is retryable.
      }
      let result: { providerMessageId?: string; suppressed?: boolean };
      try { result=await this.publish(row); }
      catch (error) {
        const disposition=error instanceof DeliveryError ? error.disposition : "unknown";
        if (disposition === "retryable") failed += 1;
        else if (disposition === "terminal") terminal += 1;
        else uncertain += 1;
        await this.pool.query(`UPDATE outbox_delivery_attempts SET state=$2,last_error=$3,updated_at=now() WHERE id=$1`,
          [attemptId,disposition,safeDeliveryError(error)]).catch(() => undefined);
        const seconds=Math.min(3600,Math.max(15,2**Math.min(10,row.attempts+1)*15));
        await this.pool.query(`UPDATE outbox_events SET status='failed',available_at=now()+($2::text||' seconds')::interval,
          locked_at=NULL,last_error=$3,updated_at=now() WHERE id=$1`, [row.id,String(seconds),safeDeliveryError(error)]).catch(() => undefined);
        continue;
      }
      try {
        await this.pool.query(`WITH acknowledged AS (
          UPDATE outbox_delivery_attempts SET state=$3,provider_message_id=$4,updated_at=now() WHERE id=$2 RETURNING event_id
        ) UPDATE outbox_events SET status='published',published_at=now(),locked_at=NULL,last_error=NULL,updated_at=now()
          WHERE id=$1 AND EXISTS(SELECT 1 FROM acknowledged WHERE event_id=$1)`,
          [row.id,attemptId,result.suppressed ? "suppressed" : "accepted",result.providerMessageId || null]);
        published += 1;
      } catch {
        uncertain += 1;
        // Never convert an accepted provider call to a retryable failure.
        // Even if this write also fails, the initial executing attempt blocks it.
        await this.pool.query(`UPDATE outbox_delivery_attempts SET state='accepted',provider_message_id=$2,
          last_error='Provider accepted; event acknowledgement requires reconciliation',updated_at=now() WHERE id=$1`,
          [attemptId,result.providerMessageId || null]).catch(() => undefined);
      }
    }
    if (rows.some(row => row.event_type === "CUSTOMER_BIRTHDAY_MESSAGE")) {
      await this.pool.query(`UPDATE dashboard_domain_state SET version=version+1,updated_at=now()
        WHERE domain IN ('birthday_messages','message_queue')`).catch(() => undefined);
    }
    return { configured:this.configured(), claimed:rows.length, published, failed, uncertain, terminal };
  }

  public async health(): Promise<Record<string, number>> {
    const result=await this.pool.query<{ pending: string; exhausted: string; uncertain: string; terminal: string; oldest_seconds: string }>(`
      SELECT
        count(*) FILTER (WHERE e.status IN ('pending','failed','processing') AND e.attempts<12 AND a.state IS NULL)::text AS pending,
        count(*) FILTER (WHERE e.status<>'published' AND e.attempts>=12)::text AS exhausted,
        count(*) FILTER (WHERE a.state IN ('unknown','executing') OR (a.state='accepted' AND e.status<>'published'))::text AS uncertain,
        count(*) FILTER (WHERE a.state='terminal')::text AS terminal,
        COALESCE(max(EXTRACT(EPOCH FROM now()-e.created_at)) FILTER
          (WHERE e.status<>'published' AND e.attempts<12 AND a.state IS NULL),0)::text AS oldest_seconds
      FROM outbox_events e LEFT JOIN LATERAL (
        SELECT state FROM outbox_delivery_attempts WHERE event_id=e.id AND state<>'retryable' ORDER BY created_at DESC LIMIT 1
      ) a ON true WHERE e.payload->>'channel' IN ('email','whatsapp')`);
    const row=result.rows[0];
    return { pending:Number(row?.pending||0),exhausted:Number(row?.exhausted||0),uncertain:Number(row?.uncertain||0),
      terminal:Number(row?.terminal||0),oldestSeconds:Math.max(0,Math.floor(Number(row?.oldest_seconds||0))) };
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

  private async publish(row: OutboxRow): Promise<{ providerMessageId?: string; suppressed?: boolean }> {
    const channel = String(row.payload?.channel || "");
    if (channel === "email") {
      return this.publishEmail(row);
    }
    if (channel === "whatsapp") {
      return this.publishWhatsApp(row);
    }
    throw new DeliveryError("terminal", "Unsupported outbox delivery channel");
  }

  private async publishEmail(row: OutboxRow): Promise<{ providerMessageId?: string; suppressed?: boolean }> {
    if (!this.emailProvider?.configured()) {
      throw new DeliveryError("retryable", "SMTP email delivery is not configured");
    }
    if (!(await this.emailChallengeIsActive(row))) return { suppressed:true };
    const payload = this.externalPayload(row.payload || {});
    const to = String(payload.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new DeliveryError("terminal", "Email recipient is missing or invalid");
    }
    const rendered = renderOutboxEmail(row.event_type, payload);
    try {
      await this.emailProvider.send({ to, ...rendered });
      return {};
    } catch (error) {
      const code=(error as {responseCode?: number})?.responseCode;
      if (code && code>=400 && code<500) throw new DeliveryError("retryable", "SMTP temporarily rejected delivery");
      if (code && code>=500) throw new DeliveryError("terminal", "SMTP permanently rejected delivery");
      throw error; // Lost connection after SMTP DATA is an uncertain outcome.
    }
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
      PASSWORD_RESET_CODE_REQUESTED: {
        prefix: "password-reset-code:",
        table: "password_reset_requests",
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

  private async publishWhatsApp(row: OutboxRow): Promise<{ providerMessageId?: string; suppressed?: boolean }> {
    if (!this.configured("whatsapp")) {
      throw new DeliveryError("retryable", "WhatsApp Business Platform delivery is not configured");
    }
    if (row.event_type === "CUSTOMER_BIRTHDAY_MESSAGE") {
      const eligible=await this.pool.query<{ allowed:boolean }>(`SELECT EXISTS (
        SELECT 1 FROM customer_whatsapp_preferences p JOIN users u ON u.id=p.customer_user_id
        JOIN customers c ON c.user_id=p.customer_user_id
        JOIN account_phones ph ON ph.user_id=p.customer_user_id AND ph.is_primary=true
        WHERE p.customer_user_id::text=$1 AND u.status='active' AND u.deleted_at IS NULL
          AND p.birthday_marketing AND p.phone_normalized=$2 AND ph.phone_normalized=p.phone_normalized AND p.consent_version=$4
          AND $3::date=(now() AT TIME ZONE 'Africa/Cairo')::date
          AND to_char(c.birthday,'MM-DD')=to_char($3::date,'MM-DD')) AS allowed`,
        [row.aggregate_id,String(row.payload.to||""),String(row.payload.birthdayDate||""),String(row.payload.consentVersion||"")]);
      if (!eligible.rows[0]?.allowed) return {suppressed:true};
    }
    const payload = this.externalPayload(row.payload || {});
    const to = String(payload.to || "").replace(/\D/g, "");
    const template = String(payload.template || "").trim();
    const languageCode = String(
      payload.languageCode || this.config.whatsappTemplateLanguage || "ar",
    ).trim();

    if (!/^\d{8,15}$/.test(to)) throw new DeliveryError("terminal", "WhatsApp recipient is missing or invalid");
    if (!/^[a-z0-9_]+$/.test(template)) throw new DeliveryError("terminal", "WhatsApp template is missing or invalid");
    if (!languageCode) throw new DeliveryError("terminal", "WhatsApp template language is missing");

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
          biz_opaque_callback_data: row.id,
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
      throw new DeliveryError(response.status === 429 ? "retryable" : response.status >= 500 ? "unknown" : "terminal", `WhatsApp Cloud API returned ${response.status}`);
    }
    const receipt = await response.json() as {messages?: Array<{id?:string}>};
    const providerMessageId=receipt.messages?.[0]?.id;
    if (!providerMessageId) throw new DeliveryError("unknown", "Provider receipt is missing a message identity");
    return {providerMessageId};
  }
}
