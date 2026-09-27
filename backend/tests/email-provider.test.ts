// DART CODE GUIDE | backend/tests/email-provider.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmtpEmailProvider } from "../src/modules/outbox/email-provider.js";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

function provider(): SmtpEmailProvider {
  return new SmtpEmailProvider({
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "mail@dart.example",
    smtpPass: "app-password",
    emailFrom: "mail@dart.example",
    emailFromName: "Dart | for you",
  });
}

const message = {
  to: "staff@example.com",
  subject: "Dart Staff verification code",
  text: "Verification code: 123456",
  html: "<p>Verification code: 123456</p>",
};

describe("SMTP email provider", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.sendMail.mockReset();
    mocks.createTransport.mockReset();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends staff email from the branded Dart mailbox identity", async () => {
    mocks.sendMail.mockResolvedValueOnce({ messageId: "mail-1" });

    await provider().send(message);

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        requireTLS: true,
      }),
    );
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Dart | for you", address: "mail@dart.example" },
        to: "staff@example.com",
      }),
    );
  });

  it("retries transient SMTP failures before succeeding", async () => {
    vi.useFakeTimers();
    const transient = Object.assign(new Error("temporary SMTP failure"), {
      code: "ETIMEDOUT",
    });
    mocks.sendMail
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ messageId: "mail-2" });

    const sending = provider().send(message);
    await vi.advanceTimersByTimeAsync(250);
    await sending;

    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent SMTP authentication failures", async () => {
    const permanent = Object.assign(new Error("authentication failed"), {
      code: "EAUTH",
      responseCode: 535,
    });
    mocks.sendMail.mockRejectedValueOnce(permanent);

    await expect(provider().send(message)).rejects.toThrow("authentication failed");
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });
});
