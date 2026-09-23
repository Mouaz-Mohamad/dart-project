// DART CODE GUIDE | backend/scripts/check-vercel-config.mjs
// الغرض: أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "..", "vercel.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

if (config.ignoreCommand !== "bash scripts/vercel-ignore-backend.sh") {
  throw new Error("backend/vercel.json must keep the guarded batch ignoreCommand");
}

const expectedBuildCommand = "npm run build";
if (config.buildCommand !== expectedBuildCommand) {
  throw new Error(
    "backend/vercel.json must build only; database migrations are an explicit operational step",
  );
}
if (/\bdb:migrate\b/.test(String(config.buildCommand || ""))) {
  throw new Error("Vercel buildCommand must never run database migrations");
}

for (const cron of config.crons ?? []) {
  if (!cron || typeof cron.path !== "string" || typeof cron.schedule !== "string") {
    throw new Error("Every Vercel cron entry must contain path and schedule strings");
  }

  const fields = cron.schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression for ${cron.path}: ${cron.schedule}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const oncePerDay =
    /^\d{1,2}$/.test(minute) &&
    /^\d{1,2}$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*";

  if (!oncePerDay) {
    throw new Error(
      `Vercel Hobby-safe cron must run at most once per day: ${cron.path} -> ${cron.schedule}`,
    );
  }

  const minuteNumber = Number(minute);
  const hourNumber = Number(hour);
  if (minuteNumber > 59 || hourNumber > 23) {
    throw new Error(`Cron time is out of range: ${cron.schedule}`);
  }
}

console.log("Vercel config check passed");
