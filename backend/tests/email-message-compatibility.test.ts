import nodemailer from "nodemailer";
import { expect, it } from "vitest";

it("composes the branded multipart order mail with the patched Nodemailer without any SMTP delivery", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await transport.sendMail({ from: { name: "Dart | for you", address: "dart@example.test" },
    to: "synthetic@example.test", subject: "تأكيد الطلب Synthetic", text: "Total EGP 1200.00", html: "<p>Total EGP 1200.00</p>" });
  expect(result.envelope).toEqual({ from: "dart@example.test", to: ["synthetic@example.test"] });
  expect(Buffer.isBuffer(result.message)).toBe(true);
  expect(result.message.toString()).toMatch(/multipart\/alternative/);
  expect(result.message.toString()).toContain("Total EGP 1200.00");
});
