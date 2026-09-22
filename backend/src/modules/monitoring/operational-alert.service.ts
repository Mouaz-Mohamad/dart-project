// DART CODE GUIDE | backend/src/modules/monitoring/operational-alert.service.ts
// الغرض: تنبيه خارجي خفيف للأخطاء التشغيلية الحرجة بدون تسريب بيانات حساسة أو إغراق البريد.
import type { EmailProvider } from "../outbox/email-provider.js";

export interface OperationalAlertContext {
  source: "request" | "database";
  requestId?: string;
  method?: string;
  path?: string;
}

function sanitize(value: string, maxLength = 600): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,15}\b/g, "[phone]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}

export class OperationalAlertService {
  private readonly lastSentByFingerprint = new Map<string, number>();
  private readonly recipient: string | null;
  private readonly cooldownMs: number;

  public constructor(
    private readonly emailProvider: EmailProvider | null,
    recipient: string | null | undefined,
    cooldownMs = 300_000,
  ) {
    const normalizedRecipient = String(recipient || "").trim().toLowerCase();
    this.recipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecipient)
      ? normalizedRecipient
      : null;
    this.cooldownMs = Math.max(60_000, cooldownMs);
  }

  public configured(): boolean {
    return Boolean(this.recipient && this.emailProvider?.configured());
  }

  public async report(error: unknown, context: OperationalAlertContext): Promise<boolean> {
    if (!this.recipient || !this.emailProvider?.configured()) return false;

    const errorName = sanitize(error instanceof Error ? error.name : "UnknownError", 120);
    const errorMessage = sanitize(
      error instanceof Error ? error.message : "Unknown operational error",
    );
    const method = sanitize(context.method || "", 16);
    const path = sanitize(context.path || "", 300);
    const requestId = sanitize(context.requestId || "", 160);
    const fingerprint = [
      context.source,
      errorName,
      errorMessage,
      method,
      path,
    ].join("|");

    const now = Date.now();
    const previous = this.lastSentByFingerprint.get(fingerprint);
    if (previous !== undefined && now - previous < this.cooldownMs) return false;

    if (this.lastSentByFingerprint.size > 500) {
      const oldestAllowed = now - this.cooldownMs;
      for (const [key, sentAt] of this.lastSentByFingerprint) {
        if (sentAt < oldestAllowed) this.lastSentByFingerprint.delete(key);
      }
    }

    this.lastSentByFingerprint.set(fingerprint, now);
    const timestamp = new Date(now).toISOString();
    const lines = [
      `Source: ${context.source}`,
      `Error: ${errorName}`,
      `Message: ${errorMessage}`,
      `Request ID: ${requestId || "-"}`,
      `Method: ${method || "-"}`,
      `Path: ${path || "-"}`,
      `Time: ${timestamp}`,
    ];

    try {
      await this.emailProvider.send({
        to: this.recipient,
        subject: `[Dart Alert] Backend ${context.source} error`,
        text: lines.join("\n"),
        html: `<h2>Dart backend alert</h2><ul>${lines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul><p>Use the Request ID to correlate this alert with structured server logs.</p>`,
      });
      return true;
    } catch (deliveryError) {
      this.lastSentByFingerprint.delete(fingerprint);
      throw deliveryError;
    }
  }
}
