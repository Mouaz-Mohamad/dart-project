import { pathToFileURL } from "node:url";
import { equivalentFrontendCheck } from "./verified-frontend-ci.mjs";

export function assessReleaseRuns(runs, sha, target, frontendEquivalent = false) {
  const latest = new Map();
  for (const run of runs) {
    if (run.head_sha !== sha || run.head_branch !== "main" || run.event !== "push") continue;
    if (!latest.has(run.name) || Number(run.id) > Number(latest.get(run.name).id)) latest.set(run.name, run);
  }
  const required = ["CI", "Production checks"];
  if ((target === "storefront" && !frontendEquivalent) || latest.has("Frontend CI")) required.push("Frontend CI");
  const pending = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run || run.status !== "completed") pending.push(name);
    else if (run.conclusion !== "success") throw new Error(`Release blocked: ${name} ${run.conclusion}.`);
  }
  return pending;
}

export async function verifyReleaseCI(target, {
  env = process.env, fetchImpl = fetch, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log,
  timeoutMs = 11 * 60_000,
} = {}) {
  if (!["storefront", "api"].includes(target)) throw new Error("Choose storefront or api release checks.");
  if (!env.VERCEL || env.VERCEL_ENV !== "production") { log("CI promotion gate: local/preview build; local release checks still apply."); return; }
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/i.test(sha || "") || env.VERCEL_GIT_COMMIT_REF !== "main") {
    throw new Error("Release blocked: verified main commit metadata is required.");
  }
  const deadline = now() + timeoutMs;
  let attempt = 0, frontendEquivalent = false;
  while (now() < deadline) {
    const response = await fetchImpl(`https://api.github.com/repos/Mouaz-Mohamad/dart-project/actions/runs?head_sha=${sha}&per_page=100`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Dart-Release-Check" },
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Release blocked: GitHub check status unavailable (${response.status}).`);
    const payload = await response.json();
    if (!Array.isArray(payload.workflow_runs)) throw new Error("Release blocked: invalid GitHub check status.");
    const hasFrontendRun = payload.workflow_runs.some(run => run.name === "Frontend CI" && run.head_sha === sha && run.event === "push" && run.head_branch === "main");
    if (target === "storefront" && !hasFrontendRun && !frontendEquivalent && attempt > 0) {
      frontendEquivalent = await equivalentFrontendCheck(sha, fetchImpl);
      if (frontendEquivalent) log("Frontend CI verified on an ancestor with identical storefront source.");
    }
    const pending = assessReleaseRuns(payload.workflow_runs, sha, target, frontendEquivalent);
    if (!pending.length) { log("CI promotion gate passed for the exact main commit."); return; }
    log(`Waiting for required CI: ${pending.join(", ")}`);
    await wait(Math.min(attempt++ === 0 ? 15_000 : 60_000, Math.max(0, deadline - now())));
  }
  throw new Error("Release blocked: required CI did not finish within the release window.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await verifyReleaseCI(process.argv[2]);
}
