import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const profiles = Object.freeze({
  storefront: ["/catalog", "/catalog", "/catalog", "/catalog/version", "/catalog/version", "/sets", "/news?limit=20"],
  admin: ["/admin/orders-version", "/admin/orders-version", "/admin/orders-version",
    "/admin/domain-state-versions", "/catalog/version", "/admin/orders-state"],
});

export function normalizeOptions(input = {}) {
  const base = new URL(input.baseUrl || "http://127.0.0.1:4000");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/")
    throw new Error("Use a plain origin without credentials, query parameters or a path.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (!local && (!input.allowRemote || base.protocol !== "https:"))
    throw new Error("Remote tests require HTTPS and --allow-remote. Prefer a staging environment.");
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Use an HTTP(S) origin.");
  const options = { baseUrl: base.origin, users: Number(input.users ?? 10), duration: Number(input.duration ?? 10),
    thinkMs: Number(input.thinkMs ?? 1000), maxRequests: Number(input.maxRequests ?? 2000),
    timeoutMs: Number(input.timeoutMs ?? 10000), profile: input.profile ?? "storefront", cookie: input.cookie ?? "" };
  for (const [key, min, max] of [["users", 1, 50], ["duration", 1, 120], ["maxRequests", 1, 2000],
    ["timeoutMs", 100, 20000], ["thinkMs", local ? 0 : 1000, 10000]]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  if (!Object.hasOwn(profiles, options.profile)) throw new Error("profile must be storefront or admin.");
  if (options.profile === "admin" && !options.cookie) throw new Error("Admin reads require DART_LOAD_COOKIE from a test staff session.");
  return options;
}

function summarize(samples) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const percentile = (p) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100 : 0;
  const errors = samples.filter((sample) => !sample.ok).length;
  return { requests: samples.length, errors, errorRate: samples.length ? errors / samples.length : 0,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95),
    bytes: samples.reduce((total, sample) => total + sample.bytes, 0),
    statuses: Object.fromEntries([...new Set(samples.map((sample) => sample.status))].map((status) =>
      [status, samples.filter((sample) => sample.status === status).length])) };
}

export async function runLoad(input, dependencies = {}) {
  const options = normalizeOptions(input);
  const fetchRequest = dependencies.fetch || globalThis.fetch;
  const now = dependencies.now || (() => performance.now());
  const sleep = dependencies.sleep || delay;
  const started = now();
  const deadline = started + options.duration * 1000;
  const paths = profiles[options.profile];
  const samples = [];
  let claimed = 0;
  let stopReason = "duration";
  let stopped = false;
  async function worker() {
    while (!stopped && now() < deadline) {
      if (claimed >= options.maxRequests) { stopReason = "request_limit"; break; }
      const path = paths[claimed++ % paths.length];
      const start = now();
      let status = "network";
      let bytes = 0;
      let ok = false;
      try {
        const response = await fetchRequest(`${options.baseUrl}/api/v1${path}`, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs),
          headers: { Accept: "application/json", ...(options.cookie ? { Cookie: options.cookie } : {}) },
        });
        status = String(response.status);
        const body = await response.text();
        bytes = Buffer.byteLength(body);
        const payload = JSON.parse(body);
        ok = response.ok && payload && typeof payload === "object" && !payload.error;
      } catch { /* Only aggregate failures; never log response bodies or session cookies. */ }
      samples.push({ path, status, bytes, ok: Boolean(ok), ms: now() - start });
      if (status === "429") { stopReason = "rate_limited"; stopped = true; }
      else if (samples.length >= 20 && samples.filter((sample) => !sample.ok).length / samples.length > 0.05) {
        stopReason = "error_threshold"; stopped = true;
      }
      if (options.thinkMs && !stopped) await sleep(Math.min(options.thinkMs, Math.max(0, deadline - now())));
    }
  }
  await Promise.all(Array.from({ length: options.users }, worker));
  const totals = summarize(samples);
  return { profile: options.profile, targetOrigin: options.baseUrl, users: options.users,
    elapsedMs: Math.round(now() - started), stopReason, ...totals,
    passed: totals.requests > 0 && totals.errorRate <= 0.01 && totals.p95Ms < 2000 &&
      !["rate_limited", "error_threshold"].includes(stopReason),
    endpoints: Object.fromEntries([...new Set(samples.map((sample) => sample.path))].map((path) =>
      [path, summarize(samples.filter((sample) => sample.path === path))])),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { base: { type: "string" }, users: { type: "string" },
      duration: { type: "string" }, "think-ms": { type: "string" }, "max-requests": { type: "string" },
      profile: { type: "string" }, "allow-remote": { type: "boolean", default: false } } });
    const report = await runLoad({ baseUrl: values.base, users: values.users, duration: values.duration,
      thinkMs: values["think-ms"], maxRequests: values["max-requests"], profile: values.profile,
      allowRemote: values["allow-remote"], cookie: process.env.DART_LOAD_COOKIE });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
