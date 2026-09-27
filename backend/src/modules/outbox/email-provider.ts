// DART CODE GUIDE | backend/src/modules/outbox/email-provider.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
import nodemailer from "nodemailer";
import type { AppConfig } from "../../config/env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  configured(): boolean;
  send(message: EmailMessage): Promise<void>;
}

const TRANSIENT_SMTP_CODES = new Set([
  "ECONNECTION",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ESOCKET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

function smtpFailure(error: unknown): { code: string; responseCode: number | null } {
  if (!error || typeof error !== "object") {
    return { code: "", responseCode: null };
  }
  const candidate = error as { code?: unknown; responseCode?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code.toUpperCase() : "",
    responseCode:
      typeof candidate.responseCode === "number" && Number.isFinite(candidate.responseCode)
        ? candidate.responseCode
        : null,
  };
}

function isTransientSmtpFailure(error: unknown): boolean {
  const failure = smtpFailure(error);
  if (failure.responseCode && failure.responseCode >= 400 && failure.responseCode < 500) {
    return true;
  }
  return TRANSIENT_SMTP_CODES.has(failure.code);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SmtpEmailProvider implements EmailProvider {
  private readonly ready: boolean;
  private readonly transporter: ReturnType<typeof nodemailer.createTransport> | null;
  private readonly from: { name: string; address: string } | null;

  public constructor(
    config: Pick<
      AppConfig,
      | "smtpHost"
      | "smtpPort"
      | "smtpSecure"
      | "smtpUser"
      | "smtpPass"
      | "emailFrom"
      | "emailFromName"
    >,
  ) {
    this.ready = Boolean(
      config.smtpHost &&
        config.smtpPort &&
        config.smtpUser &&
        config.smtpPass &&
        config.emailFrom,
    );
    this.from = config.emailFrom
      ? {
          name: config.emailFromName || "Dart | for you",
          address: config.emailFrom,
        }
      : null;
    this.transporter = this.ready
      ? nodemailer.createTransport({
          host: config.smtpHost!,
          port: config.smtpPort,
          secure: config.smtpSecure,
          requireTLS: !config.smtpSecure,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
          auth: {
            user: config.smtpUser!,
            pass: config.smtpPass!,
          },
        })
      : null;
  }

  public configured(): boolean {
    return this.ready;
  }

  public async send(message: EmailMessage): Promise<void> {
    if (!this.transporter || !this.from) {
      throw new Error("SMTP email delivery is not configured");
    }

    const mail = {
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    };

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.transporter.sendMail(mail);
        return;
      } catch (error) {
        const retry = attempt < maxAttempts && isTransientSmtpFailure(error);
        if (!retry) throw error;
        await delay(attempt * 250);
      }
    }
  }
}

export function createEmailProvider(
  config: Pick<
    AppConfig,
    | "emailProvider"
    | "smtpHost"
    | "smtpPort"
    | "smtpSecure"
    | "smtpUser"
    | "smtpPass"
    | "emailFrom"
    | "emailFromName"
  >,
): EmailProvider | null {
  if (config.emailProvider !== "smtp") return null;
  return new SmtpEmailProvider(config);
}
