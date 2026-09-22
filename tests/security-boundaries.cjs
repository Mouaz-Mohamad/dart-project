// DART CODE GUIDE | tests/security-boundaries.cjs
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sw = fs.readFileSync("sw.js", "utf8");
const state = fs.readFileSync("Js/dart-state.js", "utf8");
const adminAuth = fs.readFileSync("Eye/dart-admin-auth.js", "utf8");
const identity = fs.readFileSync("backend/src/modules/identity/identity.service.ts", "utf8");
const logger = fs.readFileSync("backend/src/config/logger.ts", "utf8");

assert.match(
  sw,
  /url\.pathname\.startsWith\(['"]\/api\/['"]\)/,
  "Service Worker must never intercept/cache API business responses",
);
for (const privatePath of [
  "/Eye/",
  "/profile.html",
  "/cart-checkout.html",
  "/track.html",
  "/rep.html",
  "/Sign%20Up%20modern.html",
]) {
  assert.ok(sw.includes(privatePath), `Service Worker private-path exclusion missing: ${privatePath}`);
}

assert.ok(
  state.includes("const values = new Map()"),
  "DartState must remain an in-memory projection",
);
assert.ok(
  state.includes("purgeLegacyBrowserBusinessData"),
  "Legacy browser business storage cleanup must remain active",
);
assert.ok(
  adminAuth.includes('credentials: "include"') &&
    adminAuth.includes('"X-CSRF-Token"'),
  "Dashboard authenticated mutations must keep cookie + CSRF protection",
);
assert.ok(
  adminAuth.includes("/api/v1/admin/auth/email/start") &&
    adminAuth.includes("/api/v1/admin/auth/email/verify") &&
    adminAuth.includes('localStorage.setItem(STAFF_EMAIL_CACHE_KEY, emailAddress)') &&
    !/localStorage\.setItem\([^\n]*(?:token|otp|session|secret|csrf)/i.test(adminAuth),
  "Dashboard Staff auth may remember only the email address and must never persist auth tokens, OTPs, sessions, CSRF values or secrets",
);
assert.ok(
  identity.includes("staff_email_login_challenges") &&
    identity.includes("STAFF_EMAIL_CODE_INVALID") &&
    identity.includes("issueSession(client, userId!, true"),
  "Backend must verify Staff email ownership before issuing the secure Dart session",
);
assert.ok(
  logger.includes('"req.body.accessToken"') &&
    logger.includes('"req.body.refreshToken"'),
  "Auth tokens must remain explicitly redacted from request logs",
);
assert.ok(
  identity.includes("detectedImageContentType") &&
    identity.includes("REPRESENTATIVE_IMAGE_SIGNATURE_MISMATCH"),
  "Representative verification documents must validate actual image signatures",
);

const sourceFiles = [
  "Js/dart-platform.js",
  "Js/dart-rep.js",
  "Eye/dart-admin-auth.js",
  "Eye/dart-domain-state.js",
  "Eye/dart-orders-api.js",
];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const secretName of [
    "DATABASE_URL=",
    "AUTOMATION_WEBHOOK_SECRET=",
    "OUTBOX_CRON_SECRET=",
    "MFA_ENCRYPTION_KEY=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "GOOGLE_CLIENT_SECRET=",
  ]) {
    assert.ok(
      !source.includes(secretName),
      `${file} must not embed server secret configuration: ${secretName}`,
    );
  }
}

console.log("PASS cross-layer security boundaries");
