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

assert(admin.includes("/api/v1/admin/auth/google/config"), "Admin Google auth config endpoint is not wired");
assert(admin.includes("/api/v1/admin/auth/google/exchange"), "Admin Google exchange endpoint is not wired");
assert(admin.includes("signInWithIdToken"), "Admin login must exchange the Google ID token through Supabase Auth");
assert(admin.includes('provider: "google"'), "Admin identity provider must be Google");
assert(admin.includes("persistSession: false"), "Supabase dashboard auth must not persist a browser session");
assert(admin.includes("autoRefreshToken: false"), "Supabase dashboard auth must not keep refreshing a browser token");
assert(admin.includes('digest("SHA-256"'), "Admin Google login must hash a secure nonce");
assert(admin.includes("nonce: currentGoogleNonce"), "Supabase ID-token exchange must use the raw nonce");
assert(!admin.includes("localStorage.setItem"), "Admin auth must not persist tokens in localStorage");
assert(admin.includes("/api/v1/admin/auth/login"), "Phase-1 rollback login endpoint must remain wired temporarily");
assert(admin.includes("Dashboard access is blocked"), "Production dashboard must fail closed without API configuration");
assert(admin.includes("DASHBOARD_HYDRATION_TIMEOUT"), "Dashboard authoritative hydration must have a bounded timeout");
assert(admin.includes("DartAdminHydration"), "Dashboard must expose authoritative hydration readiness/failure state");
assert(admin.includes("Dashboard remains locked."), "Dashboard must remain locked when required server hydration fails");
assert(dashboard.includes('id="dart-admin-auth"'), "Dashboard auth gate HTML is missing");
assert(dashboard.includes('id="dart-admin-google-button"'), "Dashboard Google button host is missing");
assert(dashboard.includes("Continue with Google"), "Dashboard must present Google as the primary sign-in path");
assert(dashboard.includes('id="dart-admin-login-form" hidden'), "Legacy Staff login must stay hidden during Phase 1");
assert(dashboard.includes('src="dart-admin-auth.js"'), "Dashboard auth gate script is not loaded");
assert(
  !/<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(signup),
  "Signup must not execute inline JavaScript",
);
assert(
  !/\son(?:click|change|input|submit|load|error)=/i.test(dashboard),
  "Dashboard must not depend on inline JavaScript event handlers",
);

console.log("PASS server-backed customer, representative and Google-first admin auth contracts");
