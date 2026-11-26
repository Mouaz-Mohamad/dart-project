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
    if (!project || typeof project.org_id !== "string") return { available: false, reason: "NEON_PROJECT_UNAVAILABLE" };
    const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const query = new URLSearchParams({ org_id: project.org_id, project_ids: projectId, from: start.toISOString(), to: end.toISOString(), granularity: "monthly", metrics: "compute_unit_seconds,public_network_transfer_bytes", limit: "1" });
    const [usageResponse, endpointsResponse] = await Promise.all([
      this.call(`https://console.neon.tech/api/v2/consumption_history/v2/projects?${query}`, token),
      this.call(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/endpoints`, token),
    ]);
    type Metric = { metric_name: string; value: number };
    type Period = { period_plan: string; consumption: Array<{ metrics: Metric[] }> };
    const usage = usageResponse.ok ? await usageResponse.json() as { projects?: Array<{ project_id: string; periods: Period[] }> } : null;
    const selected = usage?.projects?.find(item => item.project_id === projectId);
    const sum = (name: string) => selected ? selected.periods.reduce((total, period) => total + period.consumption.reduce((value, slot) => value + slot.metrics.filter(metric => metric.metric_name === name).reduce((v, metric) => v + metric.value, 0), 0), 0) : null;
    const seconds = sum("compute_unit_seconds"), owner = project.owner as Record<string, unknown> | undefined;
    const endpoints = endpointsResponse.ok ? await endpointsResponse.json() as { endpoints?: Array<Record<string, unknown>> } : null;
    let databaseHost: string | undefined;
    try { databaseHost = new URL(this.env.DATABASE_URL || this.env.POSTGRES_URL || "").hostname.replace("-pooler", ""); } catch { /* No configured production hostname. */ }
    const endpointId = this.env.DART_NEON_ENDPOINT_ID || endpoints?.endpoints?.find(item => item.host === databaseHost)?.id;
    const endpoint = endpointId ? endpoints?.endpoints?.find(item => item.id === endpointId) : endpoints?.endpoints?.length === 1 ? endpoints.endpoints[0] : undefined;
    return { available: true, usedCuHours: seconds == null ? null : seconds / 3600,
      account: { name: owner?.name || null, email: owner?.email || null, plan: owner?.subscription_type || null, project: project.name, projectId },
      compute: endpoint ? { state: endpoint.current_state, minCu: endpoint.autoscaling_limit_min_cu, maxCu: endpoint.autoscaling_limit_max_cu, startedAt: endpoint.started_at || null, suspendSeconds: endpoint.suspend_timeout_seconds } : null,
      transferBytes: sum("public_network_transfer_bytes"), periodStart: project.consumption_period_start || start.toISOString(), periodEnd: project.consumption_period_end || end.toISOString(),
      asOf: now.toISOString() };
  }

  async hosting(now = new Date()) {
    const token = this.env.DART_VERCEL_READ_TOKEN, teamId = this.env.DART_VERCEL_TEAM_ID;
    const projects = (this.env.DART_VERCEL_PROJECT_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
    if (!token || !teamId || !projects.length) return { available: false, reason: "VERCEL_READ_CREDENTIALS_MISSING" };
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // Each sub-result is independent: restricted billing permission must not hide deployment counts.
    const deployments = await Promise.all(projects.map(async projectId => {
      let until: string | undefined, count = 0;
      try {
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
      } catch { return { projectId, available: false, count: null, complete: false }; }
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
            if (bytes > 32_000_000) { valid = false; await reader.cancel(); break; }
            pending += decoder.decode(chunk.value, { stream: true });
            let index: number;
            while ((index = pending.indexOf("\n")) >= 0) { collect(pending.slice(0, index)); pending = pending.slice(index + 1); }
          }
          pending += decoder.decode(); if (valid) collect(pending);
          if (valid && seen) billedUsd = total;
        } finally { reader.releaseLock(); }
      }
    } catch { /* Costs remain explicitly unavailable; deployment results are still useful. */ }
    // Query each project independently: do not assume a provider supports multi-project scopes.
    const requestCounts = await Promise.all(projects.map(async projectId => {
      try {
        const response = await this.call(`https://api.vercel.com/v2/observability/query?teamId=${encodeURIComponent(teamId)}`, token, {
          method: "POST", body: JSON.stringify({ metric: "vercel.request.count", aggregation: "sum",
            scope: { type: "project", ownerId: teamId, projectIds: [projectId] }, startTime: start.toISOString(), endTime: now.toISOString() }),
        });
        if (!response.ok) return null;
        const payload = await response.json() as { summary?: Array<{ vercel_request_count_sum?: number }>; query?: { scope?: { projectIds?: string[] } } };
        const scope = payload.query?.scope?.projectIds;
        if (scope && (scope.length !== 1 || scope[0] !== projectId)) return null;
        const total = payload.summary?.[0]?.vercel_request_count_sum;
        return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
      } catch { return null; }
    }));
    const requests = requestCounts.every(value => value !== null) ? requestCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    let account: { name: unknown; email: unknown; plan: unknown; team: unknown } | null = null;
    try {
      const [userResponse, teamResponse] = await Promise.all([this.call("https://api.vercel.com/v2/user", token), this.call(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`, token)]);
      const user = userResponse.ok ? (await userResponse.json() as { user?: Record<string, unknown> }).user : null;
      const team = teamResponse.ok ? await teamResponse.json() as { name?: string; billing?: { plan?: string } } : null;
      account = { name: user?.username || user?.name || null, email: user?.email || null, plan: team?.billing?.plan || null, team: team?.name || null };
    } catch { /* Account metadata failure does not hide independently verified usage. */ }
    return { available: true, account, deployments, billedUsd, requests, billingScope: "team", usageScope: "configured-projects",
      periodStart: start.toISOString(), periodEnd: now.toISOString(), asOf: new Date().toISOString(),
      note: "Calendar-month posted team charges; not a final invoice. May include Neon Marketplace charges." };
  }
}
