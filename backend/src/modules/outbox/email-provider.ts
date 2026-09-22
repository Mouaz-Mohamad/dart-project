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
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
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
