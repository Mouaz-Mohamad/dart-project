import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const otpUi = readFileSync(new URL("../../Js/dart-passwordless-ui.js", import.meta.url), "utf8");

describe("customer email OTP browser recovery", () => {
  it("parses and shows a resend option with a client cooldown", () => {
    expect(() => new Script(otpUi)).not.toThrow();
    expect(otpUi).toContain('data-otp-resend');
    expect(otpUi).toContain("otpResendAvailableAt");
    expect(otpUi).toContain("60_000");
    expect(otpUi).toContain("window.DartPlatform.register");
    expect(otpUi).toContain("window.DartPlatform.login");
  });
  it("uses the server challenge expiry instead of claiming a fixed five-minute TTL", () => {
    expect(otpUi).toContain("Date.parse(String(challenge.expiresAt");
    expect(otpUi).not.toContain("الرمز صالح لمدة 5 دقائق");
    expect(otpUi).toContain("Inbox وSpam");
  });
});
