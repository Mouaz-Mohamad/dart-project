// Verify Meta's challenge and HMAC on the exact raw request bytes.
import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";

type Config = Pick<AppConfig, "whatsappWebhookVerifyToken" | "whatsappAppSecret" | "whatsappPhoneNumberId">;
type DeliveryState = "sent" | "delivered" | "read" | "failed";
const ranks: Record<DeliveryState, number> = { sent: 1, failed: 2, delivered: 3, read: 4 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function matchesToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signedPayload(body: Buffer, header: string, secret: string): boolean {
  const signature = /^sha256=([a-f0-9]{64})$/i.exec(header);
  if (!signature?.[1]) return false;
  const provided = Buffer.from(signature[1], "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(provided, expected);
}

type Status = { id: string; status: DeliveryState; timestamp?: string;
  biz_opaque_callback_data?: string; errors?: Array<{ code?: number }> };
function extractStatuses(data: unknown, phoneNumberId: string | null | undefined): Status[] {
  if (!data || typeof data !== "object") return [];
  const entries = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const statuses: Status[] = [];
  if (entries.length > 100) throw new Error("Too many webhook entries");
  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    if (changes.length > 50) throw new Error("Too many webhook changes");
    for (const change of changes) {
      const value = change?.value;
      const incomingPhone = value?.metadata?.phone_number_id;
      // Never attach events from a different sending number.
      if (!phoneNumberId || incomingPhone !== phoneNumberId || !Array.isArray(value?.statuses)) continue;
      for (const item of value.statuses) {
        if (typeof item?.id !== "string" || item.id.length < 1 || item.id.length > 255 ||
            typeof item.status !== "string" || !Object.prototype.hasOwnProperty.call(ranks, item.status)) continue;
        statuses.push(item as Status);
        if (statuses.length > 500) throw new Error("Too many status updates");
      }
    }
  }
  return statuses;
}

export function createWhatsAppWebhookRouter(pool: Pick<Pool, "query">, config: Config): Router {
  const router = Router();
  router.get("/", (request: Request, response: Response) => {
    const challenge = request.query["hub.challenge"];
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    if (!config.whatsappWebhookVerifyToken) {
      response.sendStatus(503);
      return;
    }
    if (mode !== "subscribe" || typeof token !== "string" ||
        !matchesToken(token, config.whatsappWebhookVerifyToken) ||
        typeof challenge !== "string" || !/^\d{1,20}$/.test(challenge)) {
      response.sendStatus(403);
      return;
    }
    response.type("text/plain").status(200).send(challenge);
  });

  router.post("/", express.raw({ type: "application/json", limit: "256kb" }), async (request: Request, response: Response) => {
    if (!config.whatsappAppSecret || !config.whatsappWebhookVerifyToken || !config.whatsappPhoneNumberId) {
      response.sendStatus(503);
      return;
    }
    if (!Buffer.isBuffer(request.body) ||
        !signedPayload(request.body, request.get("x-hub-signature-256") || "", config.whatsappAppSecret)) {
      response.sendStatus(401);
      return;
    }
    let data: unknown;
    try { data = JSON.parse(request.body.toString("utf8")); }
    catch { response.sendStatus(400); return; }

    try {
      const statuses = extractStatuses(data, config.whatsappPhoneNumberId);
      for (const item of statuses) {
        const correlation = typeof item.biz_opaque_callback_data === "string" &&
          uuid.test(item.biz_opaque_callback_data) ? item.biz_opaque_callback_data : null;
        const receivedAt = /^\d{9,11}$/.test(item.timestamp || "")
          ? Number(item.timestamp) : null;
        const rawErrorCode = item.errors?.[0]?.code;
        const errorCode = item.status === "failed" && Number.isInteger(rawErrorCode)
          ? String(rawErrorCode).slice(0, 12) : null;
        // A callback can arrive before the send receipt is persisted. The
        // attempt UUID in biz_opaque_callback_data provides a safe fallback,
        // without attaching a delayed receipt to a different retry attempt.
        // Only transitions to higher-priority statuses are applied; duplicates
        // and late 'sent' receipts cannot roll back a 'read' receipt.
        await pool.query(
          `UPDATE outbox_delivery_attempts a SET
             delivery_status=$3,
             delivery_status_at=COALESCE(to_timestamp($4::double precision),now()),
             delivery_error_code=$5,
             provider_message_id=COALESCE(a.provider_message_id,$1),
             last_error=CASE WHEN $3='failed' THEN 'WhatsApp delivery failed' ELSE NULL END,
             updated_at=now()
           WHERE (a.provider_message_id=$1 OR (a.provider_message_id IS NULL AND a.id=$2::uuid
               AND a.state IN ('executing','accepted','unknown')))
             AND EXISTS (SELECT 1 FROM outbox_events e WHERE e.id=a.event_id
               AND e.payload->>'channel'='whatsapp')
             AND (a.delivery_status IS NULL OR
               (CASE a.delivery_status WHEN 'sent' THEN 1 WHEN 'failed' THEN 2
                 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 0 END) < $6)`,
          [item.id, correlation, item.status, receivedAt, errorCode, ranks[item.status]],
        );
      }
      response.sendStatus(200);
    } catch {
      // Meta retries 5xx responses. Never acknowledge a receipt that failed
      // to persist, and never echo payloads, phone numbers or secrets.
      response.sendStatus(503);
    }
  });
  return router;
}
