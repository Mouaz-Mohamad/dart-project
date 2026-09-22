const assert = require("node:assert/strict");
const fs = require("node:fs");

const customer = fs.readFileSync("Js/dart-platform.js", "utf8");
const representative = fs.readFileSync("Js/dart-rep.js", "utf8");
const admin = fs.readFileSync("Eye/dart-admin-auth.js", "utf8");
const signup = fs.readFileSync("Sign Up modern.html", "utf8");
const dashboard = fs.readFileSync("Eye/Dart Eye.html", "utf8");

for (const path of [
  "/api/v1/auth/register",
  "/api/v1/auth/verify-email",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/me",
]) {
  assert(customer.includes(path), `Customer adapter is missing ${path}`);
}
assert(customer.includes("profile.accountType !== \"customer\""), "Customer cache must reject Staff/Representative sessions");
assert(customer.includes("X-CSRF-Token"), "Customer mutations must forward the CSRF token");
assert(signup.includes('id="customerEmailVerificationForm"'), "Email OTP form is missing");
assert(signup.includes('minlength="12"'), "Customer password UI must enforce the 12-character minimum");

assert(representative.includes("Representative login requires the secure account API"), "Representative production login must fail closed");
assert(representative.includes("Representative registration requires the secure account API"), "Production representative registration must fail closed without the API");
assert(representative.includes("if (API_ENABLED) return apiWork.orders || [];"), "API representative sessions must read assigned orders only from the server work snapshot");

assert(admin.includes("/api/v1/admin/auth/email/start"), "Admin email verification start endpoint is not wired");
assert(admin.includes("/api/v1/admin/auth/email/resend"), "Admin email verification resend endpoint is not wired");
assert(admin.includes("/api/v1/admin/auth/email/verify"), "Admin email verification endpoint is not wired");
assert(admin.includes("staff-email-access-v1"), "Admin must require the simplified Staff email capability");
assert(!admin.includes("signInWithIdToken"), "Admin login must not depend on Supabase ID-token exchange");
assert(!admin.includes("accounts.google.com"), "Admin login must not depend on Google Identity Services");
assert(!admin.includes("localStorage.setItem"), "Admin auth must not persist tokens in localStorage");
assert(
  admin.includes("document.body.classList.add(\"dart-admin-locked\")") &&
    admin.includes("/api/v1/health/live") &&
    admin.includes("API_VERSION_MISMATCH"),
  "Production dashboard must start locked and fail closed when the same-origin API is unavailable or incompatible",
);
assert(admin.includes("DASHBOARD_HYDRATION_TIMEOUT"), "Dashboard authoritative hydration must have a bounded timeout");
assert(admin.includes("DartAdminHydration"), "Dashboard must expose authoritative hydration readiness/failure state");
assert(admin.includes("Dashboard remains locked."), "Dashboard must remain locked when required server hydration fails");
assert(dashboard.includes('id="dart-admin-auth"'), "Dashboard auth gate HTML is missing");
assert(dashboard.includes('id="dart-admin-email-form"'), "Dashboard email access form is missing");
assert(dashboard.includes('id="dart-admin-code-form"'), "Dashboard email verification form is missing");
assert(!dashboard.includes("Continue with Google"), "Dashboard must not present Google sign-in");
assert(!dashboard.includes('id="dart-admin-login-form"'), "Staff dashboard must not expose the retired password login form");
assert(!dashboard.includes('id="dart-admin-onboarding-password-form"'), "Staff dashboard must not expose password setup");
assert(!dashboard.includes('id="dart-admin-mfa-form"'), "Staff dashboard must not expose TOTP setup");
assert(dashboard.includes('src="dart-admin-auth.js"'), "Dashboard auth gate script is not loaded");
assert(
  !/<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(signup),
  "Signup must not execute inline JavaScript",
);
assert(
  !/\son(?:click|change|input|submit|load|error)=/i.test(dashboard),
  "Dashboard must not depend on inline JavaScript event handlers",
);

console.log("PASS server-backed customer, representative and simplified Staff email auth contracts");
