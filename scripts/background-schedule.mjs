// The worker reads a non-secret projection BEFORE making any request to the Dart API/Neon.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const defaultSchedule = Object.freeze({ enabled: true, intervalMinutes: 15,
  quietEnabled: true, quietStart: "01:00", quietEnd: "12:00" });

export function readPolicy(raw) {
  const policy = raw ? JSON.parse(raw) : { revision: 0, schedule: defaultSchedule };
  const s = policy.schedule, time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 0 || !s ||
      typeof s.enabled !== "boolean" || typeof s.quietEnabled !== "boolean" ||
      !Number.isInteger(s.intervalMinutes) || s.intervalMinutes < 5 || s.intervalMinutes > 1440 || s.intervalMinutes % 5 ||
      !time.test(s.quietStart) || !time.test(s.quietEnd) || (s.quietEnabled && s.quietStart === s.quietEnd))
    throw new Error("Invalid scheduler policy; no API request will be sent");
  return policy;
}

export function shouldRun(policy, now = new Date(), mode = "outbox", manual = false) {
  if (manual) return true;
  const s = policy.schedule;
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const quiet = s.quietEnabled && (s.quietStart < s.quietEnd
    ? local >= s.quietStart && local < s.quietEnd : local >= s.quietStart || local < s.quietEnd);
  if (quiet) return false;
  if (mode === "backup") return true;
  return s.enabled && Math.floor(now.getTime() / 300000) * 5 % s.intervalMinutes === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = readPolicy(process.env.DART_BACKGROUND_POLICY);
  const run = shouldRun(policy, new Date(), process.argv[2], process.env.DART_MANUAL_RUN === "true");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\nrevision=${policy.revision}\n`);
  console.log(run ? "Background work is allowed" : "Background work skipped before API/database access");
}
