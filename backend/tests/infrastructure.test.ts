import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_INFRASTRUCTURE, infrastructureSchema, isQuietTime, estimateCompute } from "../src/modules/settings/infrastructure-policy.js";
import { InfrastructureService } from "../src/modules/settings/infrastructure.service.js";
import { InfrastructureProviders } from "../src/modules/settings/infrastructure-providers.js";
import { createInfrastructureRouter } from "../src/modules/settings/infrastructure.routes.js";
import { createOutboxRouter } from "../src/modules/outbox/outbox.routes.js";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import { AppError } from "../src/http/app-error.js";
import type { ErrorRequestHandler } from "express";

describe("background schedule and cost assumptions", () => {
  it("uses Cairo clock and half-open boundaries, including daylight saving", () => {
    const s = DEFAULT_INFRASTRUCTURE.schedule;
    expect(isQuietTime(s, new Date("2026-11-25T22:59:59Z"))).toBe(false);
    expect(isQuietTime(s, new Date("2026-11-25T23:00:00Z"))).toBe(true);
    expect(isQuietTime(s, new Date("2026-11-26T09:59:59Z"))).toBe(true);
    expect(isQuietTime(s, new Date("2026-11-26T10:00:00Z"))).toBe(false);
    expect(isQuietTime(s, new Date("2026-07-01T22:00:00Z"))).toBe(true);
    const overnight = { ...s, quietStart: "23:00", quietEnd: "06:00" };
    expect(isQuietTime(overnight, new Date("2026-11-26T00:00:00Z"))).toBe(true);
    expect(isQuietTime({ ...s, quietEnabled: false }, new Date("2026-11-26T05:00:00Z"))).toBe(false);
  });
  it("rejects invalid intervals/windows and does not subtract free allowance on paid plans", () => {
    expect(infrastructureSchema.safeParse({ ...DEFAULT_INFRASTRUCTURE, schedule: { ...DEFAULT_INFRASTRUCTURE.schedule, intervalMinutes: 7 } }).success).toBe(false);
    expect(infrastructureSchema.safeParse({ ...DEFAULT_INFRASTRUCTURE, schedule: { ...DEFAULT_INFRASTRUCTURE.schedule, quietEnd: "01:00" } }).success).toBe(false);
    const settings = structuredClone(DEFAULT_INFRASTRUCTURE); settings.calculator.plan = "paid";
    const value = estimateCompute(settings);
    expect(value.runsPerDay).toBe(52); expect(value.cuHours).toBe(32.5); expect(value.computeUsd).toBeCloseTo(3.445);
    settings.schedule.quietEnabled = false;
    expect(estimateCompute(settings).computeUsd).toBeCloseTo(6.36);
    settings.schedule.enabled = false;
    expect(estimateCompute(settings).runsPerDay).toBe(0);
  });
});

describe("provider boundaries", () => {
  it("returns unavailable instead of fabricated zeroes when credentials are absent", async () => {
    const fetcher = vi.fn(), provider = new InfrastructureProviders({}, fetcher);
    expect(await provider.neon()).toMatchObject({ available: false });
    expect(await provider.hosting()).toMatchObject({ available: false }); expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.publishSchedule(DEFAULT_INFRASTRUCTURE.schedule, 1)).rejects.toMatchObject({ code: "SCHEDULER_NOT_CONFIGURED" });
  });
  it("updates only the non-secret repository variable and handles its initial creation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 201 }));
    const provider = new InfrastructureProviders({ DART_SCHEDULER_GITHUB_TOKEN: "synthetic", DART_SCHEDULER_REPOSITORY: "example/dart" }, fetcher);
    await provider.publishSchedule(DEFAULT_INFRASTRUCTURE.schedule, 2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/example/dart/actions/variables/DART_BACKGROUND_POLICY");
    const body = JSON.parse(fetcher.mock.calls[1]?.[1].body);
    expect(JSON.parse(body.value)).toEqual({ revision: 2, schedule: DEFAULT_INFRASTRUCTURE.schedule });
    expect(body.value).not.toContain("synthetic");
  });
  it("uses Launch billing metrics rather than legacy project counters and selects the production compute", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ project: { id: "example", org_id: "org-test", compute_time_seconds: 0, owner: { email: "owner@example.test", subscription_type: "launch_v3" } } }))
      .mockResolvedValueOnce(Response.json({ projects: [{ project_id: "example", periods: [{ period_plan: "launch", consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: 3600 }] }] }] }] }))
      .mockResolvedValueOnce(Response.json({ endpoints: [{ id: "ep-prod", current_state: "active", started_at: "2026-11-26T15:46:15Z", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 8, suspend_timeout_seconds: 0 }] }));
    const provider = new InfrastructureProviders({ DART_NEON_READ_TOKEN: "synthetic-secret", DART_NEON_PROJECT_ID: "example", DART_NEON_ENDPOINT_ID: "ep-prod" }, fetcher);
    const value = await provider.neon(); expect(value).toMatchObject({ available: true, usedCuHours: 1, account: { email: "owner@example.test", plan: "launch_v3" }, compute: { state: "active", minCu: 0.25, maxCu: 8, suspendSeconds: 0 } });
    expect(fetcher.mock.calls[1]?.[0]).toContain("consumption_history/v2/projects?");
    expect(JSON.stringify(value)).not.toContain("synthetic-secret");
  });
  it("paginates deployments and counts FOCUS charges once, preserving negative credits", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ deployments: [{}], pagination: { next: 123 } }))
      .mockResolvedValueOnce(Response.json({ deployments: [{}], pagination: {} }))
      .mockResolvedValueOnce(new Response('{"BilledCost":"10","BillingCurrency":"USD"}\n{"BilledCost":"-2","BillingCurrency":"USD"}\n'))
      .mockResolvedValueOnce(Response.json({ summary: [{ vercel_request_count_sum: 17 }] }));
    const provider = new InfrastructureProviders({ DART_VERCEL_READ_TOKEN: "synthetic", DART_VERCEL_TEAM_ID: "team-test", DART_VERCEL_PROJECT_IDS: "prj-test" }, fetcher);
    expect(await provider.hosting(new Date("2026-11-26T00:00:00Z"))).toMatchObject({ available: true, billedUsd: 8, requests: 17,
      deployments: [{ count: 2, complete: true }], billingScope: "team" });
    expect(fetcher.mock.calls[1]?.[0]).toContain("until=123");
  });
  it("adds separately scoped request totals without dropping the API project", async () => {
    const scopes: string[][] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/deployments?")) return Response.json({ deployments: [], pagination: {} });
      if (url.includes("/observability/")) {
        const body = JSON.parse(String(init?.body)); scopes.push(body.scope.projectIds);
        return Response.json({ summary: [{ vercel_request_count_sum: body.scope.projectIds[0] === "site" ? 11 : 7 }], query: { scope: body.scope } });
      }
      return new Response("", { status: 403 });
    });
    const provider = new InfrastructureProviders({ DART_VERCEL_READ_TOKEN: "synthetic", DART_VERCEL_TEAM_ID: "team-test", DART_VERCEL_PROJECT_IDS: "site,api" }, fetcher as typeof fetch);
    expect(await provider.hosting()).toMatchObject({ available: true, requests: 18, billedUsd: null });
    expect(scopes).toEqual([["site"], ["api"]]);
  });
  it("keeps account information when deployment reads fail and rejects a mismatched request scope", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/deployments?")) throw new Error("synthetic network error");
      if (url.includes("/observability/")) return Response.json({ summary: [{ vercel_request_count_sum: 99 }], query: { scope: { projectIds: ["wrong-project"] } } });
      if (url.endsWith("/v2/user")) return Response.json({ user: { username: "owner" } });
      if (url.includes("/v2/teams/")) return Response.json({ name: "Dart", billing: { plan: "pro" } });
      return new Response("", { status: 403 });
    });
    const provider = new InfrastructureProviders({ DART_VERCEL_READ_TOKEN: "synthetic", DART_VERCEL_TEAM_ID: "team-test", DART_VERCEL_PROJECT_IDS: "site" }, fetcher as typeof fetch);
    expect(await provider.hosting()).toMatchObject({ available: true, requests: null, account: { name: "owner", team: "Dart", plan: "pro" }, deployments: [{ available: false, complete: false }] });
  });

});

describe("database-authoritative infrastructure settings", () => {
  const db = new PGlite(), publisher = { schedulerConfigured: () => true, publishSchedule: vi.fn().mockResolvedValue(undefined), neon: vi.fn(), hosting: vi.fn() };
  let service: InfrastructureService;
  beforeAll(async () => {
    await db.exec("CREATE TABLE site_settings(id text PRIMARY KEY,data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz,updated_by text); CREATE TABLE audit_logs(actor_type text,actor_id text,action text,entity_type text,entity_id text,request_id text,old_values jsonb,new_values jsonb,metadata jsonb); INSERT INTO site_settings(id,data) VALUES('main','{\"shippingFeePerOrder\":100}');");
    const query = (sql: string, params: unknown[] = []) => db.query(sql, params);
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    service = new InfrastructureService(pool, publisher as unknown as InfrastructureProviders);
  });
  afterAll(async () => { await db.close(); });
  it("saves atomically, audits, preserves other settings and rejects stale writers", async () => {
    const initial = await service.get(); expect(initial.revision).toBe(0);
    const result = await service.save(0, DEFAULT_INFRASTRUCTURE, "staff-test", "request-test");
    expect(result.revision).toBe(1);
    expect((await db.query<{ data: Record<string, unknown> }>("SELECT data FROM site_settings")).rows[0]?.data.shippingFeePerOrder).toBe(100);
    expect((await db.query("SELECT * FROM audit_logs")).rows).toHaveLength(1);
    await expect(service.save(0, DEFAULT_INFRASTRUCTURE, "staff-test", "stale")).rejects.toMatchObject({ statusCode: 409 });
  });
  it("rolls back failed scheduler publication and exposes a manual-only switch", async () => {
    publisher.publishSchedule.mockRejectedValueOnce(new Error("synthetic network failure"));
    await expect(service.save(1, DEFAULT_INFRASTRUCTURE, "staff-test", "failed")).rejects.toThrow();
    expect((await service.get()).revision).toBe(1);
    expect((await db.query("SELECT * FROM audit_logs")).rows).toHaveLength(1);
    expect(await service.automaticAllowed("0")).toMatchObject({ allowed: false, reason: "policy_revision_mismatch" });
    expect(await service.automaticAllowed("1", new Date("2026-11-26T05:00:00Z"))).toMatchObject({ allowed: false, reason: "quiet_hours" });
    expect(await service.automaticAllowed("1", new Date("2026-11-26T12:00:00Z"))).toMatchObject({ allowed: true });
    await service.save(1, { ...DEFAULT_INFRASTRUCTURE, schedule: { ...DEFAULT_INFRASTRUCTURE.schedule, enabled: false } }, "staff-test", "manual");
    expect(await service.automaticAllowed("2")).toMatchObject({ allowed: false, reason: "manual_only" });
  });
  it("coalesces provider reads without repeated external calls", async () => {
    publisher.neon.mockResolvedValue({ available: true, usedCuHours: 12 });
    const results = await Promise.all([service.usage("database"), service.usage("database")]);
    expect(results[0]).toEqual(results[1]); expect(publisher.neon).toHaveBeenCalledTimes(1);
  });
});

describe("infrastructure API authorization and manual dispatch", () => {
  const config = { sessionCookieName: "dart_session", authPepper: "synthetic-test-pepper-at-least-32-characters" };
  const csrf = "synthetic-csrf", cookie = `dart_session_staff=${randomUUID()}.${"x".repeat(43)}`;
  const auth: AuthenticatedAccount = { userId: "staff-test", accountType: "staff", status: "active", email: "staff@example.test", emailVerified: true,
    mustChangePassword: false, sessionId: randomUUID(), sessionFamilyId: randomUUID(), csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
    mfaRequired: false, mfaSatisfied: true, permissions: ["settings.manage"] };
  function fixture(account = auth) {
    const service = { get: vi.fn().mockResolvedValue({ revision: 0 }), save: vi.fn().mockResolvedValue({ revision: 1 }), usage: vi.fn(), auditManual: vi.fn() };
    const outbox = { processBatch: vi.fn().mockResolvedValue({ claimed: 1, published: 1 }), health: vi.fn().mockResolvedValue({ duePending: 0 }) };
    const app = express(); app.use(express.json(), cookieParser());
    app.use("/api/v1", createInfrastructureRouter(service as unknown as InfrastructureService, { authenticate: async () => account } as unknown as IdentityService, config, outbox as unknown as OutboxService));
    app.use(((error, _request, response, _next) => { response.status(error instanceof AppError ? error.statusCode : 422).json({ error: { code: error.code } }); }) as ErrorRequestHandler);
    return { app, service, outbox };
  }
  it("denies anonymous customers and staff without the settings permission", async () => {
    expect((await request(fixture().app).get("/api/v1/admin/infrastructure")).status).toBe(401);
    for (const account of [{ ...auth, accountType: "customer" as const }, { ...auth, permissions: [] }, { ...auth, mfaRequired: true, mfaSatisfied: false }]) {
      const f = fixture(account); expect((await request(f.app).get("/api/v1/admin/infrastructure").set("Cookie", cookie)).status).toBe(403); expect(f.service.get).not.toHaveBeenCalled();
    }
  });
  it("requires CSRF and explicit staff action for audited manual processing", async () => {
    const f = fixture();
    expect((await request(f.app).post("/api/v1/admin/infrastructure/process").set("Cookie", cookie).send({})).status).toBe(403);
    expect(f.outbox.processBatch).not.toHaveBeenCalled();
    expect((await request(f.app).post("/api/v1/admin/infrastructure/process").set("Cookie", cookie).set("x-csrf-token", csrf).send({})).status).toBe(200);
    expect(f.service.auditManual).toHaveBeenCalledTimes(1); expect(f.outbox.processBatch).toHaveBeenCalledExactlyOnceWith(5);
  });
  it("authenticates the worker before checking schedule and skips maintenance and dispatch in quiet hours", async () => {
    const outbox = { processBatch: vi.fn(), health: vi.fn() }, gate = vi.fn().mockResolvedValue({ allowed: false, reason: "quiet_hours" }), maintenance = vi.fn();
    const app = express(); app.use(createOutboxRouter(outbox as unknown as OutboxService, { outboxCronSecret: "synthetic-secret-with-at-least-32-characters" }, maintenance, gate));
    expect((await request(app).post("/internal/outbox/process")).status).toBe(401); expect(gate).not.toHaveBeenCalled();
    const response = await request(app).post("/internal/outbox/process").auth("synthetic-secret-with-at-least-32-characters", { type: "bearer" });
    expect(response.body).toMatchObject({ skipped: true }); expect(outbox.processBatch).not.toHaveBeenCalled(); expect(maintenance).not.toHaveBeenCalled();
  });
});
