function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parameterMap(payload: Record<string, unknown>): Record<string, string> {
  const value = payload.parameters;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      String(item ?? ""),
    ]),
  );
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderOutboxEmail(
  eventType: string,
  payload: Record<string, unknown>,
): RenderedEmail {
  const parameters = parameterMap(payload);
  const otp = parameters.otp || "";
  const temporaryPassword = parameters.temporaryPassword || "";
  const dashboardUrl = String(
    payload.dashboardUrl || "https://dart-project-psi.vercel.app/Eye/Dart%20Eye.html",
  );
  const expiresAt = String(payload.expiresAt || "");
  const expiry = expiresAt ? new Date(expiresAt).toLocaleString("en-GB") : "";

  let subject = "Dart | for you";
  let english = "";
  let arabic = "";

  if (
    eventType === "STAFF_INVITED" ||
    eventType === "STAFF_ONBOARDING_CODE_REQUESTED" ||
    eventType === "STAFF_EMAIL_ACCESS_CODE_REQUESTED"
  ) {
    subject = "Dart Eye verification code";
    english = `Your Dart Eye verification code is ${otp}. It expires ${expiry || "soon"}. Open the dashboard: ${dashboardUrl}`;
    arabic = `كود تأكيد الدخول إلى Dart Eye هو ${otp}. ينتهي الكود ${expiry || "قريبًا"}. افتح الداشبورد: ${dashboardUrl}`;
  } else if (
    eventType === "EMAIL_VERIFICATION_REQUESTED" ||
    eventType === "EMAIL_CHANGE_VERIFICATION_REQUESTED"
  ) {
    subject = "Verify your Dart email";
    english = `Your Dart verification code is ${otp}. It expires ${expiry || "soon"}.`;
    arabic = `كود تأكيد البريد الإلكتروني في Dart هو ${otp}. ينتهي الكود ${expiry || "قريبًا"}.`;
  } else if (eventType === "TEMPORARY_PASSWORD_ASSIGNED") {
    subject = "Dart temporary password";
    english = `A temporary Dart password was assigned: ${temporaryPassword}. Change it immediately after signing in.`;
    arabic = `تم تعيين كلمة مرور مؤقتة لحساب Dart: ${temporaryPassword}. غيّرها فور تسجيل الدخول.`;
  } else {
    throw new Error(`Unsupported email event type: ${eventType}`);
  }

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f7f4ef;font-family:Arial,sans-serif;color:#1d1d1d">
  <main style="max-width:620px;margin:0 auto;padding:32px">
    <section style="background:#fff;border-radius:16px;padding:28px;border-top:5px solid #AB012B">
      <div style="font-size:22px;font-weight:700;color:#AB012B;margin-bottom:20px">Dart | for you</div>
      <p style="font-size:16px;line-height:1.7">${escapeHtml(english)}</p>
      <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
      <p dir="rtl" style="font-size:16px;line-height:1.9;text-align:right">${escapeHtml(arabic)}</p>
    </section>
  </main>
</body>
</html>`;

  return {
    subject,
    text: `${english}\n\n${arabic}`,
    html,
  };
}
