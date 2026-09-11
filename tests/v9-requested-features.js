const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const errors = [];
const requireText = (source, value, message) => {
  if (!source.includes(value)) errors.push(message);
};
const requirePattern = (source, pattern, message) => {
  if (!pattern.test(source)) errors.push(message);
};

const platform = read("Js/dart-platform.js");
const checkout = read("Js/one .js");
const dashboard = read("Eye/dart.js");
const dashboardFixes = read("Eye/dart-fixes.js");
const dashboardHtml = read("Eye/Dart Eye.html");
const tracking = read("Js/dart-tracking.js");
const styles = read("CSS/fixes.css");
const profile = read("profile.html");
const returnsFragment = read("sections/form-return.html");
const nav = read("sections/Nav-Bar.html");
const footer = read("sections/footer.html");

// Birthday reward, image, countdown and current-session close behavior.
requireText(platform, 'timeZone: CAIRO_TIME_ZONE', "Birthday dates must use Cairo time.");
requireText(platform, 'const BIRTHDAY_REWARD_DAYS = 7', "Birthday reward must last seven days.");
requireText(platform, 'discountPercent: BIRTHDAY_DISCOUNT_PERCENT', "Birthday reward must carry its 30% discount.");
requireText(platform, 'sessionStorage.setItem(', "Celebration close state must be session-only.");
requireText(platform, 'data-birthday-time="days"', "Birthday countdown must show days.");
requireText(platform, 'data-birthday-time="hours"', "Birthday countdown must show hours.");
requireText(platform, 'data-birthday-time="minutes"', "Birthday countdown must show minutes.");
requirePattern(styles, /\.dart-birthday-card\s*\{[^}]*background:[^;}]*dart-birthday-reward\.jpg[^}]*\}/s, "Birthday artwork must be the card background.");
requirePattern(styles, /\.dart-birthday-countdown\s*\{[^}]*top:\s*10px[^}]*inset-inline:\s*10px[^}]*height:\s*60px/s, "Countdown must keep the requested 10px edges and 60px height.");
requireText(styles, ".dart-confetti-piece", "Birthday confetti styling is missing.");
requireText(styles, ".dart-balloon", "Birthday balloon styling is missing.");

// Birthday discount takes precedence and never spends Dart Card pieces.
requireText(platform, "Birthday always takes priority and never consumes Dart Card quota.", "Birthday priority rule is missing at order creation.");
requireText(checkout, "takes priority over other discounts", "Checkout must explain birthday discount priority.");
requireText(platform, 'promotionType: birthdayReward', "Orders must record which reward was applied.");
requireText(platform, 'storedReward.status = "Reserved"', "Birthday reward must reserve on order creation.");
requireText(platform, 'reward.status = "Used"', "Birthday reward must be used on delivery.");
requireText(platform, 'reward.status = new Date() < new Date(reward.expiresAt)', "Cancelled/refused orders must restore an unexpired reward.");

// Dashboard birthday message queue opens at 8 PM and hides queued customers.
requirePattern(dashboard, /if \(cairo\.hour < 20\)/, "Tomorrow birthday queue must open at 8 PM Cairo.");
requireText(dashboard, 'row.birthdayDate === key', "Birthday send history must be scoped to the target date.");
requireText(dashboardFixes, 'localStorage.setItem(\'dart_birthday_messages\'', "Queued birthday clients must be recorded and removed from the widget.");
requireText(dashboardFixes, "renderBirthdayWidget();", "Birthday widget must refresh immediately after queueing.");

// Requested dashboard controls.
for (const id of [
  "openCardBenefitBtn",
  "card-modal",
  "hard-delete-modal",
  "hard-delete-only",
  "hard-delete-cascade",
  "hard-delete-cancel",
]) requireText(dashboardHtml, `id="${id}"`, `Dashboard is missing #${id}.`);
requireText(dashboard, 'dartCommitHardDelete("only")', "Delete-only choice is not wired.");
requireText(dashboard, 'dartCommitHardDelete("cascade")', "Cascade delete choice is not wired.");
requireText(dashboard, 'grantType: "Manual Additional Benefit"', "Manual Dart Card grant is missing.");
requireText(dashboard, 'discountPercent: 40', "Manual Dart Card discount must stay fixed at 40%.");
requireText(dashboard, 'itemLimit: 10', "Manual Dart Card limit must stay fixed at 10 pieces.");

// Product verification, leaderboard, simplified return and tracking.
requireText(platform, 'customerNameParts(owner, 2)', "Serial verification must show the owner's first two names.");
requireText(platform, 'customerNameParts(row.customer.clientName, 3)', "Leaderboard must show the first three names.");
requireText(platform, "candidates.slice(0, 3)", "Leaderboard must show no more than three candidates.");
for (const rank of [1, 2, 3]) requireText(styles, `.leaderboard-item.rank-${rank}`, `Leaderboard rank ${rank} styling is missing.`);
if (/name=["']model_code["']/i.test(returnsFragment)) errors.push("Public return form must not request Model Code.");
requireText(platform, "modelCode = orderLine?.modelCode || inventoryItem?.modelId", "Return Model Code must be derived automatically.");
requirePattern(tracking, /order\.status\s*!==\s*["']Delivered["']/, "Delivered orders must be excluded from tracking.");

// Profile card and five prepared social destinations.
requireText(profile, 'src="Photos/dart-logo-white.png"', "Profile Dart Card must use the white logo.");
requireText(profile, 'class="dart-card-acount', "Dynamic profile Dart Card is missing.");
for (const platformName of ["instagram", "facebook", "tiktok", "youtube", "whatsapp"]) {
  const marker = `data-social-platform="${platformName}" data-social-url=""`;
  requireText(nav, marker, `Side menu ${platformName} placeholder is missing.`);
  requireText(footer, marker, `Footer ${platformName} placeholder is missing.`);
}

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exit(1);
}
console.log("PASS V9 birthday, Dart Card and requested UX contract checks");
