// DART CODE GUIDE | tests/auth-contract.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const customer = fs.readFileSync("Js/dart-platform.js", "utf8");
const social = fs.readFileSync("Js/dart-auth-social.js", "utf8");
const representative = fs.readFileSync("Js/dart-rep.js", "utf8");
const admin = fs.readFileSync("Eye/dart-admin-auth.js", "utf8");
const signup = fs.readFileSync("Sign Up modern.html", "utf8");
const dashboard = fs.readFileSync("Eye/Dart Eye.html", "utf8");

for (const path of [
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/me",
]) {
  assert(customer.includes(path), `Customer adapter is missing ${path}`);
}
assert(customer.includes("profile.accountType !== \"customer\""), "Customer cache must reject Staff/Representative sessions");
assert(customer.includes("X-CSRF-Token"), "Customer mutations must forward the CSRF token");
assert(!signup.includes('id="customerEmailVerificationForm"'), "Customer signup must not present an email OTP form");
assert(!signup.includes('type="password"'), "Customer signup/login must have no password fields");
assert(!signup.includes('name="email"') && !signup.includes('name="phone2"'), "Registration must ask only for name, primary phone and birthday");
assert(!signup.includes("data-forgot-password"), "Password recovery must not appear for customers");
assert(!social.includes("challenge.passwordRequired"), "Google linking must not ask for the retired customer password");
assert(
  signup.includes('id="dartBirthdayValue" type="hidden" name="birthday"') &&
    ['dartBirthDay', 'dartBirthMonth', 'dartBirthYear'].every(id =>
      new RegExp('<select id="' + id + '"[^>]*\\brequired').test(signup),
    ) &&
    signup.includes('src="Js/dart-auth-birthday.js"') &&
    !signup.includes('type="date" name="birthday"'),
  "Customer signup must collect a required birthday from the accessible selectors and submit one ISO field",
);
assert(
  signup.includes('href="CSS/dart-auth.css"') &&
    !/<input type="password"[^>]*>\\s*<svg class="dart-auth-icon"/.test(signup),
  "Customer authentication must load its dedicated design and keep only the visibility icon beside password fields",
);
assert.equal((signup.match(/data-social-login="google"/g) || []).length, 2, "Google sign-in must exist in both forms; availability is checked through the server provider endpoint");
assert.equal((signup.match(/data-social-login="facebook"/g) || []).length, 0, "Unavailable Facebook login must not be offered");
for (const path of [
  "/api/v1/auth/social/providers",
  "/api/v1/auth/social/complete",
  "/api/v1/auth/social/challenge",
]) {
  assert(social.includes(path), `Customer social auth UI is missing ${path}`);
}
assert(social.includes('method: "POST"') && social.includes("body: { token }"), "Customer social challenge must send its one-time capability in a POST body");
assert(!social.includes("/auth/social/challenge?token="), "Customer social completion capability must never be placed in a request URL");
assert(!social.includes("GOOGLE_OAUTH_CLIENT_SECRET"), "Google OAuth secret must never exist in storefront JavaScript");
assert(!social.includes("FACEBOOK_OAUTH_APP_SECRET"), "Facebook OAuth secret must never exist in storefront JavaScript");
assert(!signup.includes("boxicons"), "Customer auth icons must not depend on the Boxicons font");
assert(signup.includes("dart-auth-icon"), "Customer auth inputs must use local SVG icons");

assert(representative.includes("Representative login requires the secure account API"), "Representative production login must fail closed");
assert(representative.includes("Representative registration requires the secure account API"), "Production representative registration must fail closed without the API");
assert(representative.includes("if (API_ENABLED) return apiWork.orders || [];"), "API representative sessions must read assigned orders only from the server work snapshot");

assert(admin.includes("/api/v1/admin/auth/email/start"), "Admin email verification start endpoint is not wired");
assert(admin.includes("/api/v1/admin/auth/email/resend"), "Admin email verification resend endpoint is not wired");
assert(admin.includes("/api/v1/admin/auth/email/verify"), "Admin email verification endpoint is not wired");
assert(admin.includes("staff-email-access-v1"), "Admin must require the simplified Staff email capability");
assert(!admin.includes("signInWithIdToken"), "Admin login must not depend on Supabase ID-token exchange");
assert(!admin.includes("accounts.google.com"), "Admin login must not depend on Google Identity Services");
assert(
  admin.includes('localStorage.setItem(STAFF_EMAIL_CACHE_KEY, emailAddress)'),
  "Admin may remember only the Staff email address for faster reload UX",
);
assert(
  !/localStorage\.setItem\([^\n]*(?:token|otp|session|secret|csrf)/i.test(admin),
  "Admin auth must never persist tokens, OTPs, sessions, CSRF values or secrets in localStorage",
);
assert(
  documentSafeSocialAuth(social),
  "Customer social auth must not persist provider/completion tokens in browser storage",
);
assert(
  admin.includes("document.body.classList.add(\"dart-admin-locked\")") &&
    admin.includes("/api/v1/health/live") &&
    admin.includes("API_VERSION_MISMATCH"),
  "Production dashboard must start locked and fail closed when the same-origin API is unavailable or incompatible",
);
assert(admin.includes("DASHBOARD_HYDRATION_TIMEOUT"), "Dashboard authoritative hydration must have a bounded timeout");
assert(admin.includes("DartAdminHydration"), "Dashboard must expose authoritative hydration readiness/failure state");
assert(admin.includes("Dashboard remains locked"), "Dashboard must remain locked when required server hydration fails");
const domainReadSource = admin.match(/const canHydrateOtherDomains = permissions\.some\(\(permission\) =>\s*\/(.*?)\/\.test\(permission\)/s)?.[1];
assert(domainReadSource, "Dashboard must recognize granular domain-read permissions");
const canHydrateDomain = new RegExp(domainReadSource);
for (const permission of ["contacts.read", "customers.read", "returns.read", "damage.manage", "representatives.manage"]) {
  assert(canHydrateDomain.test(permission), `${permission} must load its authorized dashboard domain`);
}
for (const permission of ["contacts.manage", "customers.manage", "loyalty.manage", "staff.manage"]) {
  assert(!canHydrateDomain.test(permission), `${permission} alone must not trigger a forbidden read during login`);
}
assert(dashboard.includes('id="dart-admin-auth"'), "Dashboard auth gate HTML is missing");
assert(dashboard.includes('id="dart-admin-email-form"'), "Dashboard email access form is missing");
assert(dashboard.includes('id="dart-admin-code-form"'), "Dashboard email verification form is missing");
assert(!dashboard.includes("Continue with Google"), "Dashboard must not present Google sign-in");
assert(!dashboard.includes('id="dart-admin-login-form"'), "Staff dashboard must not expose the retired password login form");
assert(!dashboard.includes('id="dart-admin-onboarding-password-form"'), "Staff dashboard must not expose password setup");
assert(!dashboard.includes('id="dart-admin-mfa-form"'), "Staff dashboard must not expose TOTP setup");
assert(/src="dart-admin-auth\.js(?:\?[^\"]*)?"/.test(dashboard), "Dashboard auth gate script is not loaded");
assert(
  !/<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(signup),
  "Signup must not execute inline JavaScript",
);
assert(
  !/\son(?:click|change|input|submit|load|error)=/i.test(dashboard),
  "Dashboard must not depend on inline JavaScript event handlers",
);

function documentSafeSocialAuth(source) {
  const storageCalls = source.match(/\b(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\([^)]*\)/g) || [];
  return storageCalls.every(call => /^sessionStorage\.(?:setItem|getItem)\("dart_customer_auth_return"(?:, destination)?\)$/.test(call));
}

console.log("PASS server-backed customer/social, representative and simplified Staff email auth contracts");
