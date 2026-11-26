import { AppError } from "../../http/app-error.js";
import type { InfrastructureSettings } from "./infrastructure-policy.js";

export type ProviderEnvironment = Record<string, string | undefined>;
export class InfrastructureProviders {
  constructor(private readonly env: ProviderEnvironment, private readonly request: typeof fetch = fetch) {}
  schedulerConfigured() { return Boolean(this.env.DART_SCHEDULER_GITHUB_TOKEN && this.env.DART_SCHEDULER_REPOSITORY); }
  private async call(url: string, token: string, init: RequestInit = {}) {
    const response = await this.request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers, Authorization: `Bearer ${token}` } });
    return response;
  }
  async publishSchedule(schedule: InfrastructureSettings["schedule"], revision: number) {
    const repository = this.env.DART_SCHEDULER_REPOSITORY || "";
    if (!this.schedulerConfigured() || !/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new AppError(503, "SCHEDULER_NOT_CONFIGURED", "Configure the server's GitHub Variables credentials before saving the schedule");
    const root = `https://api.github.com/repos/${repository}/actions/variables`;
    const body = JSON.stringify({ name: "DART_BACKGROUND_POLICY", value: JSON.stringify({ revision, schedule }) });
    const headers = { "X-GitHub-Api-Version": "2022-11-28" };
    const token = this.env.DART_SCHEDULER_GITHUB_TOKEN!;
    let response = await this.call(`${root}/DART_BACKGROUND_POLICY`, token, { method: "PATCH", body, headers });
    if (response.status === 404) response = await this.call(root, token, { method: "POST", body, headers });
    if (!response.ok) throw new AppError(502, "SCHEDULER_PUBLISH_FAILED", "Could not synchronize the scheduler; reload and retry");
  }
  async neon() {
    const token = this.env.DART_NEON_READ_TOKEN, projectId = this.env.DART_NEON_PROJECT_ID;
    if (!token || !projectId) return { available: false, reason: "NEON_READ_CREDENTIALS_MISSING" };
    const response = await this.call(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`, token);
    if (!response.ok) return { available: false, reason: "NEON_USAGE_UNAVAILABLE" };
    const { project } = await response.json() as { project?: Record<string, unknown> };
    const seconds = Number(project?.compute_time_seconds);
    if (!Number.isFinite(seconds) || seconds < 0) return { available: false, reason: "NEON_USAGE_UNAVAILABLE" };
    return { available: true, usedCuHours: seconds / 3600,
      storageBytes: Number.isFinite(Number(project?.synthetic_storage_size)) ? Number(project?.synthetic_storage_size) : null,
      transferBytes: Number.isFinite(Number(project?.data_transfer_bytes)) ? Number(project?.data_transfer_bytes) : null,
      periodStart: project?.consumption_period_start || null, periodEnd: project?.consumption_period_end || null,
      asOf: new Date().toISOString() };
  }
  async hosting(now = new Date()) {
    const token = this.env.DART_VERCEL_READ_TOKEN, teamId = this.env.DART_VERCEL_TEAM_ID;
    const projects = (this.env.DART_VERCEL_PROJECT_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
    if (!token || !teamId || !projects.length) return { available: false, reason: "VERCEL_READ_CREDENTIALS_MISSING" };
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Each sub-result is independent: restricted billing permission must not hide deployment counts.
    const deployments = await Promise.all(projects.map(async projectId => {
      let until: string | undefined, count = 0;
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ teamId, projectId, since: String(start.getTime()), limit: "100", ...(until ? { until } : {}) });
        const response = await this.call(`https://api.vercel.com/v6/deployments?${query}`, token);
        if (!response.ok) return { projectId, available: false, count: null, complete: false };
        const payload = await response.json() as { deployments?: unknown[]; pagination?: { next?: number } };
        if (!Array.isArray(payload.deployments)) return { projectId, available: false, count: null, complete: false };
        count += payload.deployments.length;
        if (!payload.pagination?.next) return { projectId, available: true, count, complete: true };
        until = String(payload.pagination.next);
      }
      return { projectId, available: true, count, complete: false };
    }));
    let billedUsd: number | null = null;
    try {
      const query = new URLSearchParams({ teamId, from: start.toISOString(), to: now.toISOString() });
      const response = await this.call(`https://api.vercel.com/v1/billing/charges?${query}`, token);
      if (response.ok && response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = "", bytes = 0, total = 0, valid = true, seen = false;
        const collect = (line: string) => {
          if (!line.trim()) return;
          const row = JSON.parse(line);
          // Never coerce absent billing fields to zero or mix currencies.
          if (row.BilledCost == null || row.BilledCost === "" || row.BillingCurrency !== "USD" || !Number.isFinite(Number(row.BilledCost))) { valid = false; return; }
          total += Number(row.BilledCost); seen = true;
        };
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 5_000_000) { valid = false; await reader.cancel(); break; }
            pending += decoder.decode(chunk.value, { stream: true });
            let index: number;
            while ((index = pending.indexOf("\n")) >= 0) { collect(pending.slice(0, index)); pending = pending.slice(index + 1); }
          }
          pending += decoder.decode(); if (valid) collect(pending);
          if (valid && seen) billedUsd = total;
        } finally { reader.releaseLock(); }
      }
    } catch { /* Costs remain explicitly unavailable; deployment results are still useful. */ }
    let requests: number | null = null;
    try {
      const response = await this.call(`https://api.vercel.com/v2/observability/query?teamId=${encodeURIComponent(teamId)}`, token, {
        method: "POST", body: JSON.stringify({ metric: "vercel.request.count", aggregation: "sum",
          scope: { type: "project", ownerId: teamId, projectIds: projects }, startTime: start.toISOString(), endTime: now.toISOString() }),
      });
      if (response.ok) {
        const payload = await response.json() as { summary?: Array<{ vercel_request_count_sum?: number }> };
        const total = payload.summary?.[0]?.vercel_request_count_sum;
        if (typeof total === "number" && Number.isFinite(total)) requests = total;
      }
    } catch { /* Observability may require a separate entitlement. */ }
    return { available: true, deployments, billedUsd, requests, billingScope: "team", usageScope: "configured-projects",
      periodStart: start.toISOString(), periodEnd: now.toISOString(), asOf: new Date().toISOString(),
      note: "Calendar-month posted team charges; not a final invoice. May include Neon Marketplace charges." };
  }
}
