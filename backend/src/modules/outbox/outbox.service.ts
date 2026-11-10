import { deliverAdminPush, deliverAdminTestPush } from "../notifications/admin-push-dispatch.js";
// DART CODE GUIDE | backend/src/modules/outbox/outbox.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { decryptSecret } from "../../security/crypto.js";
import type { EmailProvider } from "./email-provider.js";
import { renderOutboxEmail } from "./email-templates.js";
import { deliverWebPush } from "../notifications/push-dispatch.js";
import { PushDeliveryError, type WebPushProvider } from "../notifications/web-push-provider.js";
import { whatsappSendWindow } from "./whatsapp-schedule.js";

class DeferredWhatsAppDelivery extends Error {}

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
      | "whatsappSendEnabled"
      | "whatsappOrderConfirmationEnabled"
      | "whatsappDispatchEnabled"
      | "whatsappDispatchTemplate"
      | "whatsappOrderConfirmationTemplate"
      | "whatsappPostDeliveryTemplate"
      | "whatsappRestockTemplate"
      | "whatsappPhoneNumberId"
      | "whatsappGraphApiVersion"
      | "whatsappTemplateLanguage"
      | "outboxBatchSize"
      | "mfaEncryptionKey"
    >,
    private readonly emailProvider: EmailProvider | null = null,
    private readonly webPushProvider: WebPushProvider | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public configured(channel?: "email" | "whatsapp" | "web_push"): boolean {
    const whatsapp = Boolean(
      this.config.whatsappSendEnabled === true &&
      this.config.whatsappAccessToken &&
        this.config.whatsappPhoneNumberId &&
        /^v\d+\.\d+$/.test(this.config.whatsappGraphApiVersion || "v26.0"),
    );
    const email = this.emailProvider?.configured() === true;
    if (channel === "email") return email;
    if (channel === "whatsapp") return whatsapp;
    const push=this.webPushProvider?.configured()===true;
    if (channel === "web_push") return push;
    return email || whatsapp || push || this.orderMessagingConfigured() || this.dispatchMessagingConfigured();
  }

  private orderMessagingConfigured(): boolean {
    return Boolean((this.config.whatsappOrderConfirmationEnabled ?? this.config.whatsappSendEnabled)
      && this.config.whatsappAccessToken && this.config.whatsappPhoneNumberId
      && /^v\d+\.\d+$/.test(this.config.whatsappGraphApiVersion || "v26.0"));
  }

  private dispatchMessagingConfigured(): boolean {
    return Boolean(this.config.whatsappDispatchEnabled === true && this.config.whatsappDispatchTemplate
      && this.config.whatsappAccessToken && this.config.whatsappPhoneNumberId
      && /^v\d+\.\d+$/.test(this.config.whatsappGraphApiVersion || "v26.0"));
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
      delivery_status: string | null;
      delivery_error_code: string | null;
      provider_message_id: string | null;
      category: string;
    }>(
      `SELECT e.id::text, e.event_type, e.status, e.attempts, COALESCE(a.last_error,e.last_error) AS last_error,
              e.created_at, e.updated_at, e.published_at, a.state AS delivery_state, a.delivery_status, a.delivery_error_code, a.provider_message_id,
              COALESCE(e.payload->>'channel','') AS channel,
              COALESCE(e.payload->>'category','') AS category,
              COALESCE(e.payload->>'to','') AS recipient
         FROM outbox_events e LEFT JOIN LATERAL (
           SELECT state,delivery_status,delivery_error_code,provider_message_id,last_error FROM outbox_delivery_attempts
            WHERE event_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1
         ) a ON true
        WHERE e.payload->>'channel' IN ('email','whatsapp','web_push')
        ORDER BY e.created_at DESC,e.id DESC
        LIMIT $1`,
      [Math.min(100, Math.max(1, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      channel: row.channel,
      category: row.category,
      recipient: maskRecipient(row.channel, row.recipient),
      status: row.delivery_status || row.delivery_state || row.status,
      deliveryStatus: row.delivery_status || null,
      deliveryErrorCode: row.delivery_error_code || null,
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
    adminTestId?: string,
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
            AND payload->>'channel' IN ('email','whatsapp','web_push')
            AND ($2::text IS NULL OR deduplication_key=$2)
            AND ($9::text IS NULL OR (aggregate_type='admin_push_test' AND aggregate_id=$9))
            AND (payload->>'channel'<>'whatsapp' OR CASE WHEN event_type='WAITLIST_WHATSAPP_RESTOCK' THEN ($3::boolean AND $8::boolean) WHEN event_type='ORDER_WHATSAPP_DISPATCHED' THEN $7::boolean WHEN event_type IN ('ORDER_WHATSAPP_CONFIRMATION','ORDER_WHATSAPP_ACK')
              THEN $6::boolean ELSE ($3::boolean AND (event_type<>'CUSTOMER_BIRTHDAY_MESSAGE' OR $4::boolean)
              AND (event_type<>'CUSTOMER_POST_DELIVERY_REVIEW' OR $5::boolean)) END)
            AND (event_type<>'WAITLIST_WHATSAPP_RESTOCK' OR $8::boolean)
            AND NOT EXISTS (SELECT 1 FROM outbox_delivery_attempts a
              WHERE a.event_id=outbox_events.id AND a.state IN ('executing','accepted','unknown','terminal','suppressed'))
            AND (status IN ('pending','failed') OR (status='processing' AND locked_at < now() - interval '5 minutes'))
          ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [Math.min(100, Math.max(1, limit)), deduplicationKey || null,
          this.configured("whatsapp"), whatsappSendWindow(this.now()), Boolean(this.config.whatsappPostDeliveryTemplate), this.orderMessagingConfigured(), this.dispatchMessagingConfigured(),Boolean(this.config.whatsappRestockTemplate),adminTestId||null],
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
      try { result=await this.publish(row, attemptId); }
      catch (error) {
        if (error instanceof DeferredWhatsAppDelivery) {
          // No external request was made; preserve this event and its retry budget.
          await this.pool.query(`WITH deferred AS (
            UPDATE outbox_delivery_attempts SET state='retryable',last_error='Waiting for WhatsApp send window',updated_at=now()
            WHERE id=$2 RETURNING event_id
          ) UPDATE outbox_events SET status='pending',attempts=GREATEST(attempts-1,0),locked_at=NULL,
            available_at=dart_whatsapp_send_at(now()+interval '1 minute'),updated_at=now()
            WHERE id=$1 AND EXISTS(SELECT 1 FROM deferred WHERE event_id=$1)`, [row.id,attemptId]);
          continue;
        }
        const disposition=error instanceof DeliveryError || error instanceof PushDeliveryError ? error.disposition : "unknown";
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
    const result=await this.pool.query<{ pending: string; exhausted: string; uncertain: string; terminal: string; delivery_failed: string; oldest_seconds: string; due_pending: string; oldest_due_seconds: string }>(`
      SELECT
        count(*) FILTER (WHERE e.status IN ('pending','failed','processing') AND e.attempts<12 AND a.state IS NULL)::text AS pending,
        count(*) FILTER (WHERE e.status<>'published' AND e.attempts>=12)::text AS exhausted,
        count(*) FILTER (WHERE a.state='unknown' OR (a.state='executing' AND a.updated_at<now()-interval '5 minutes') OR (a.state='accepted' AND e.status<>'published'))::text AS uncertain,
        count(*) FILTER (WHERE a.state='terminal')::text AS terminal,
        count(*) FILTER (WHERE a.delivery_status='failed')::text AS delivery_failed,
        count(*) FILTER (WHERE e.status IN ('pending','failed','processing') AND e.attempts<12 AND a.state IS NULL AND e.available_at<=now()
          AND (e.payload->>'channel'<>'whatsapp' OR CASE WHEN e.event_type='WAITLIST_WHATSAPP_RESTOCK' THEN ($1::boolean AND $6::boolean) WHEN e.event_type='ORDER_WHATSAPP_DISPATCHED' THEN $5::boolean WHEN e.event_type IN ('ORDER_WHATSAPP_CONFIRMATION','ORDER_WHATSAPP_ACK')
            THEN $4::boolean ELSE ($1::boolean AND (e.event_type<>'CUSTOMER_BIRTHDAY_MESSAGE' OR $2::boolean)
            AND (e.event_type<>'CUSTOMER_POST_DELIVERY_REVIEW' OR $3::boolean) AND (e.event_type<>'WAITLIST_WHATSAPP_RESTOCK' OR $6::boolean)) END))::text AS due_pending,
        COALESCE(max(EXTRACT(EPOCH FROM now()-e.available_at)) FILTER
          (WHERE e.status IN ('pending','failed','processing') AND e.attempts<12 AND a.state IS NULL AND e.available_at<=now()
            AND (e.payload->>'channel'<>'whatsapp' OR CASE WHEN e.event_type='WAITLIST_WHATSAPP_RESTOCK' THEN ($1::boolean AND $6::boolean) WHEN e.event_type='ORDER_WHATSAPP_DISPATCHED' THEN $5::boolean WHEN e.event_type IN ('ORDER_WHATSAPP_CONFIRMATION','ORDER_WHATSAPP_ACK')
              THEN $4::boolean ELSE ($1::boolean AND (e.event_type<>'CUSTOMER_BIRTHDAY_MESSAGE' OR $2::boolean)
              AND (e.event_type<>'CUSTOMER_POST_DELIVERY_REVIEW' OR $3::boolean) AND (e.event_type<>'WAITLIST_WHATSAPP_RESTOCK' OR $6::boolean)) END)),0)::text AS oldest_due_seconds,
        COALESCE(max(EXTRACT(EPOCH FROM now()-e.created_at)) FILTER
          (WHERE e.status<>'published' AND e.attempts<12 AND a.state IS NULL),0)::text AS oldest_seconds
      FROM outbox_events e LEFT JOIN LATERAL (
        SELECT state,updated_at,delivery_status FROM outbox_delivery_attempts WHERE event_id=e.id AND state<>'retryable' ORDER BY created_at DESC,id DESC LIMIT 1
      ) a ON true WHERE e.payload->>'channel' IN ('email','whatsapp','web_push')`,
      [this.configured("whatsapp"),whatsappSendWindow(this.now()),Boolean(this.config.whatsappPostDeliveryTemplate),this.orderMessagingConfigured(),this.dispatchMessagingConfigured(),Boolean(this.config.whatsappRestockTemplate)]);
    const row=result.rows[0];
    return { pending:Number(row?.pending||0),exhausted:Number(row?.exhausted||0),uncertain:Number(row?.uncertain||0),
      terminal:Number(row?.terminal||0),deliveryFailed:Number(row?.delivery_failed||0),oldestSeconds:Math.max(0,Math.floor(Number(row?.oldest_seconds||0))),
      duePending:Number(row?.due_pending||0),oldestDueSeconds:Math.max(0,Math.floor(Number(row?.oldest_due_seconds||0))) };
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

  private async publish(row: OutboxRow, attemptId: string): Promise<{ providerMessageId?: string; suppressed?: boolean }> {
    const channel = String(row.payload?.channel || "");
    if (channel === "email") {
      return this.publishEmail(row);
    }
    if (channel === "whatsapp") {
      return this.publishWhatsApp(row, attemptId);
    }
    if (channel === "web_push") {
      try { return await (row.event_type === "ADMIN_PUSH_TEST" ? deliverAdminTestPush : row.payload.audience === "staff" ? deliverAdminPush : deliverWebPush)(this.pool,this.config.mfaEncryptionKey,this.webPushProvider,row.payload); }
      catch(error) {
        if (error instanceof PushDeliveryError) throw error;
        throw new PushDeliveryError("unknown","Push delivery outcome requires reconciliation");
      }
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
      // Nodemailer also labels later socket errors CONN. Only a definitive
      // DNS/connect failure proves that no message could have been accepted.
      const failure=error as {command?: string; code?: string; originalCode?: string; syscall?: string};
      const networkCode=failure?.originalCode || failure?.code || "";
      if (failure?.command === "CONN" && (failure.syscall === "connect" ||
          ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "EDNS"].includes(networkCode))) {
        throw new DeliveryError("retryable", "SMTP connection failed before message delivery");
      }
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

  private async publishWhatsApp(row: OutboxRow, attemptId: string): Promise<{ providerMessageId?: string; suppressed?: boolean }> {
    // There is no approved alternative-color WhatsApp workflow in Dart.
    // Never use the exact-restock template for a different color, even if
    // an event with an alternative label is accidentally enqueued.
    if (row.event_type === "WAITLIST_WHATSAPP_ALTERNATIVE") return {suppressed:true};
    const dispatch = row.event_type === "ORDER_WHATSAPP_DISPATCHED";
    const immediate = dispatch || ["ORDER_WHATSAPP_CONFIRMATION","ORDER_WHATSAPP_ACK"].includes(row.event_type);
    // Restock's four-hour hold and transactional notifications must never wait for birthday hours.
    // Only birthday greetings respect the Cairo 13:00–22:00 delivery window.
    // All other approved WhatsApp flows can send whenever they become eligible.
    const bypassWindow = row.event_type !== "CUSTOMER_BIRTHDAY_MESSAGE";
    if (!(dispatch ? this.dispatchMessagingConfigured() : immediate ? this.orderMessagingConfigured() : this.configured("whatsapp"))) {
      throw new DeferredWhatsAppDelivery("WhatsApp sending is disabled");
    }
    if (!bypassWindow && !whatsappSendWindow(this.now())) throw new DeferredWhatsAppDelivery("Waiting for WhatsApp send window");
    if (dispatch) {
      if (!(new Date(String(row.payload.expiresAt || "")).getTime() > this.now().getTime())) return { suppressed: true };
      const eligible = await this.pool.query<{ allowed: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM orders o LEFT JOIN users u ON u.id=o.customer_user_id
        WHERE o.id::text=$1 AND o.status IN ('Out With Representative','Representative On The Way')
          AND NOT o.is_deleted AND NOT o.is_archived AND o.legacy->>'dispatchConfirmedAt'=$2
          AND (o.customer_user_id IS NULL OR (u.status='active' AND u.deleted_at IS NULL))
          AND regexp_replace(o.contact_snapshot->>'phone1','[^0-9]','','g') IN ($3,'0'||substring($3 from 3))
      ) AS allowed`, [row.aggregate_id, String(row.payload.confirmedAt || ""), String(row.payload.to || "")]);
      if (!eligible.rows[0]?.allowed) return { suppressed: true };
    }
    if (row.event_type === "ORDER_WHATSAPP_CONFIRMATION") {
      const eligible = await this.pool.query<{allowed:boolean}>(`SELECT EXISTS(
        SELECT 1 FROM order_whatsapp_confirmations c JOIN orders o ON o.id=c.order_id
        LEFT JOIN users u ON u.id=o.customer_user_id
        WHERE c.id::text=$1 AND c.order_id::text=$2 AND c.phone_normalized=$3
          AND c.state='pending' AND c.expires_at>now() AND c.expected_version=o.version
          AND c.final_minor=o.final_minor AND o.status='New' AND NOT o.is_deleted AND NOT o.is_archived
          AND ((o.customer_user_id IS NULL AND o.order_source<>'Website')
            OR (u.status='active' AND u.deleted_at IS NULL))
          AND regexp_replace(o.contact_snapshot->>'phone1','[^0-9]','','g') IN ($3,'0'||substring($3 from 3))) AS allowed`,
        [String(row.payload.confirmationId || ""),row.aggregate_id,String(row.payload.to || "")]);
      if (!eligible.rows[0]?.allowed) return {suppressed:true};
    }
    if (row.event_type === "ORDER_WHATSAPP_ACK") {
      if (!(new Date(String(row.payload.expiresAt || "")).getTime() > this.now().getTime())) return {suppressed:true};
      const state = await this.pool.query<{status:string}>("SELECT status FROM orders WHERE id::text=$1 AND NOT is_deleted", [row.aggregate_id]);
      if (!state.rows[0] || (row.payload.outcome === "confirmed" && !["Accepted","Preparing"].includes(state.rows[0].status))
        || (row.payload.outcome === "cancelled" && state.rows[0].status !== "Cancelled")) return {suppressed:true};
    }
    if (row.event_type === "WAITLIST_WHATSAPP_RESTOCK") {
      if (!this.config.whatsappRestockTemplate) return {suppressed:true};
      const eligible = await this.pool.query<{allowed:boolean}>(`SELECT EXISTS(
        SELECT 1 FROM waitlist_allocations wa
        JOIN waitlist_entries w ON w.id=wa.waitlist_entry_id
        JOIN inventory_items i ON i.id=wa.inventory_item_id
        JOIN cart_reservations cr ON cr.id=wa.cart_reservation_id
        JOIN users u ON u.id=w.customer_user_id
        JOIN account_phones ph ON ph.user_id=w.customer_user_id AND ph.account_type='customer' AND ph.is_primary
        WHERE wa.id::text=$1 AND w.id::text=$2 AND wa.status='active' AND wa.match_type='exact'
          AND w.status='reserved' AND w.whatsapp_restock_opt_in_at IS NOT NULL
          AND w.whatsapp_restock_phone_normalized=$3 AND ph.phone_normalized=$3
          AND u.status='active' AND u.deleted_at IS NULL
          AND i.active AND NOT i.is_deleted AND NOT i.is_archived
          AND lower(i.status)='cart reserved' AND i.cart_reservation_id=wa.cart_reservation_id
          AND w.model_id=i.model_id AND w.size=i.size AND w.desired_color=i.color
          AND now()<wa.expires_at AND now()<cr.expires_at
          AND wa.expires_at=$4::timestamptz) AS allowed`,
        [String(row.payload.allocationId||""),row.aggregate_id,String(row.payload.to||""),String(row.payload.expiresAt||"")]);
      if (!eligible.rows[0]?.allowed) return {suppressed:true};
    }
    if (row.event_type === "CUSTOMER_BIRTHDAY_MESSAGE") {
      const eligible=await this.pool.query<{allowed:boolean}>(`SELECT
        $3::date=(now() AT TIME ZONE 'Africa/Cairo')::date AND
        (EXISTS (
          SELECT 1 FROM customers c JOIN users u ON u.id=c.user_id
          JOIN account_phones ph ON ph.user_id=c.user_id AND ph.is_primary AND ph.account_type='customer'
          WHERE c.user_id::text=$1 AND u.status='active' AND u.deleted_at IS NULL
            AND ph.phone_normalized=$2
            AND to_char(c.birthday,'MM-DD')=to_char($3::date,'MM-DD')
            AND NOT EXISTS(SELECT 1 FROM customer_whatsapp_preferences p
              WHERE p.customer_user_id=c.user_id AND NOT p.birthday_marketing
                AND p.consent_version='birthday-whatsapp-v1')
        ) OR EXISTS (
          SELECT 1 FROM dashboard_domain_state d
          CROSS JOIN LATERAL jsonb_array_elements(d.data) p(profile)
          WHERE d.domain='customers'
            AND (p.profile->>'clientId'=$1 OR p.profile->>'id'=$1)
            AND p.profile->>'birthday' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND substring(p.profile->>'birthday' FROM 6 FOR 5)=to_char($3::date,'MM-DD')
            AND dart_whatsapp_order_phone(p.profile->>'phone1')=$2
            AND COALESCE(p.profile->>'isDeleted','false')<>'true'
            AND COALESCE(p.profile->>'isArchived','false')<>'true'
        )) AS allowed`,
        [row.aggregate_id,String(row.payload.to||""),String(row.payload.birthdayDate||"")]);
      if (!eligible.rows[0]?.allowed) return {suppressed:true};
    }
    if (row.event_type === "CUSTOMER_POST_DELIVERY_REVIEW") {
      const eligible=await this.pool.query<{allowed:boolean}>(`SELECT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id::text=$1 AND o.status='Delivered' AND NOT o.is_deleted
          AND o.delivered_at=$2::timestamptz
          AND o.delivered_at + interval '7 hours' <= now()
          AND now()<$3::timestamptz
          AND dart_whatsapp_order_phone(o.contact_snapshot->>'phone1')=$4
          AND NOT EXISTS (
            SELECT 1 FROM customer_whatsapp_preferences p
            WHERE p.customer_user_id=o.customer_user_id AND
              ((NOT p.post_delivery_review AND p.review_consent_version='post-delivery-whatsapp-v1')
                OR p.phone_normalized<>$4)
          )
      ) AS allowed`,
        [row.aggregate_id,String(row.payload.deliveredAt||""),
          String(row.payload.expiresAt||""),String(row.payload.to||"")]);
      if (!eligible.rows[0]?.allowed) return {suppressed:true};
    }
    const payload = this.externalPayload(row.payload || {});
    const to = String(payload.to || "").replace(/\D/g, "");
    const template = String(dispatch ? this.config.whatsappDispatchTemplate || "" : row.event_type === "CUSTOMER_POST_DELIVERY_REVIEW"
      ? this.config.whatsappPostDeliveryTemplate || "" : row.event_type === "WAITLIST_WHATSAPP_RESTOCK"
      ? this.config.whatsappRestockTemplate || "" : row.event_type === "ORDER_WHATSAPP_CONFIRMATION"
        ? this.config.whatsappOrderConfirmationTemplate || "dart_order_confirmation" : payload.template || "").trim();
    const languageCode = String(
      payload.languageCode || this.config.whatsappTemplateLanguage || "ar",
    ).trim();

    if (!/^\d{8,15}$/.test(to)) throw new DeliveryError("terminal", "WhatsApp recipient is missing or invalid");
    if (row.event_type !== "ORDER_WHATSAPP_ACK" && !/^[a-z0-9_]+$/.test(template)) throw new DeliveryError("terminal", "WhatsApp template is missing or invalid");
    if (!languageCode) throw new DeliveryError("terminal", "WhatsApp template language is missing");

    const parameters = textParameters(payload);
    // The approved Arabic customer templates use fixed text, not body placeholders.
    // Birthday also has a required image header. Do not attach legacy text variables.
    const fixedCustomerTemplate = (row.event_type === "CUSTOMER_BIRTHDAY_MESSAGE" && template === "birthday")
      || (row.event_type === "CUSTOMER_POST_DELIVERY_REVIEW" && template === "share_your_experience_2");
    const bodyComponent = !fixedCustomerTemplate && parameters.length
      ? {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        }
      : undefined;
    const authenticationOtp = payload.authenticationOtp === true;
    const otp = parameters[0] || "";
    const birthdayImageHeader = row.event_type === "CUSTOMER_BIRTHDAY_MESSAGE" && template === "birthday"
      ? [{ type: "header", parameters: [{ type: "image", image: { link: "https://www.dartofficial.com/Photos/dart-birthday-reward.jpg" } }] }]
      : undefined;
    const components = birthdayImageHeader
      ? birthdayImageHeader
      : row.event_type === "ORDER_WHATSAPP_CONFIRMATION"
      ? [bodyComponent!, ...["confirm","cancel"].map((action,index) => ({type:"button",sub_type:"quick_reply",index:String(index),
          parameters:[{type:"payload",payload:`${action}:${payload.confirmationId}`}]}))]
      : authenticationOtp && otp
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

    // Recheck immediately before the external call as a batch can cross 22:00.
    if (!bypassWindow && !whatsappSendWindow(this.now())) throw new DeferredWhatsAppDelivery("Waiting for WhatsApp send window");
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
          biz_opaque_callback_data: attemptId,
          ...(row.event_type === "ORDER_WHATSAPP_ACK" ? {
            type:"text",text:{body:String(payload.body || ""),preview_url:false},
          } : {
            type:"template",template:{name:template,language:{code:languageCode},...(components ? {components} : {})},
          }),
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
