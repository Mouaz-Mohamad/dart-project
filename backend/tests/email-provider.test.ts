import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("SMTP email provider", () => {
  beforeEach(() => {
    mocks.sendMail.mockReset();
    mocks.createTransport.mockReset();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("sends staff email from the branded Dart mailbox identity", async () => {
    const provider = new SmtpEmailProvider({
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "mail@dart.example",
      smtpPass: "app-password",
      emailFrom: "mail@dart.example",
      emailFromName: "Dart | for you",
    });

    await provider.send({
      to: "staff@example.com",
      subject: "Dart Staff verification code",
      text: "Verification code: 123456",
      html: "<p>Verification code: 123456</p>",
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Dart | for you", address: "mail@dart.example" },
        to: "staff@example.com",
      }),
    );
  });
});
