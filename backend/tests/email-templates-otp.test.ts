import { describe, expect, it } from "vitest";
import { renderOutboxEmail } from "../src/modules/outbox/email-templates.js";

describe("Dart minimal OTP email", () => {
  it.each([
    "STAFF_EMAIL_ACCESS_CODE_REQUESTED",
    "EMAIL_VERIFICATION_REQUESTED",
    "EMAIL_CHANGE_VERIFICATION_REQUESTED",
    "PASSWORD_RESET_CODE_REQUESTED",
    "CUSTOMER_LOGIN_OTP_REQUESTED",
  ])("renders the original logo and prominent code for %s", (event) => {
    const message = renderOutboxEmail(event, { parameters: { otp: "040619" } });
    expect(message.subject).toContain("Dart | For you");
    expect(message.text).toBe("OTP الخاص بك\n040619\nDart | For you");
    expect(message.html).toContain("01_Dart_original_transparent.png");
    expect(message.html).toContain("OTP الخاص بك");
    expect(message.html).toContain("font-size:46px");
    expect(message.html).toContain("040619");
    expect(message.html).toContain("Dart | For you");
    expect(message.html).not.toContain("If you did not request");
  });

  it("keeps business order emails separate from the OTP template", () => {
    const message = renderOutboxEmail("order.created", {
      parameters: { orderCode: "DR-TEST-1", status: "New", total: "100.00" },
    });
    expect(message.html).toContain("DR-TEST-1");
    expect(message.html).not.toContain("OTP الخاص بك");
  });

  it("never injects an arbitrary value into the OTP html", () => {
    const message = renderOutboxEmail("STAFF_EMAIL_ACCESS_CODE_REQUESTED", {
      parameters: { otp: "<script>alert(1)</script>" },
    });
    expect(message.html).not.toContain("<script>");
  });
});
