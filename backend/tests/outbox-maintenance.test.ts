import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { createOutboxRouter } from "../src/modules/outbox/outbox.routes.js";
import { runMaintenanceTasks } from "../src/modules/outbox/maintenance.js";

const secret = "synthetic-cron-secret-with-at-least-32-characters";
function fixture(maintenance?: Parameters<typeof createOutboxRouter>[2], vercelCronSecret?: string) {
  const outbox = { processBatch: vi.fn().mockResolvedValue({ claimed: 2, published: 2, failed: 0 }),
    health: vi.fn().mockResolvedValue({ uncertain: 0, exhausted: 0, duePending: 0 }) };
  const app = express();
  app.use(createOutboxRouter(outbox as unknown as OutboxService, { outboxCronSecret: secret, vercelCronSecret }, maintenance));
  return { app, outbox };
}

describe("outbox maintenance isolation", () => {
  it("processes committed messages after maintenance throws and exposes no raw failure detail", async () => {
    const { app, outbox } = fixture(async () => { throw new Error("sensitive@example.test SQL details"); });
    const response = await request(app).post("/internal/outbox/process?limit=3").auth(secret, { type: "bearer" });
    expect(response.status).toBe(200);
    expect(outbox.processBatch).toHaveBeenCalledExactlyOnceWith(3);
    expect(response.body).toMatchObject({ published: 2, maintenance: { ok: false, failedJobs: ["maintenance"] } });
    expect(response.text).not.toMatch(/sensitive|SQL/);
  });
  it("runs every independent maintenance job, queues birthday work before delivery, and reports failed jobs", async () => {
    const order: string[] = [], report = vi.fn();
    const { app, outbox } = fixture(() => runMaintenanceTasks([
      ["reservation_cleanup", async () => { order.push("cleanup"); throw new Error("synthetic failure"); }],
      ["rate_limit_pruning", async () => { order.push("prune"); }],
      ["birthday_queue", async () => { order.push("birthday"); }],
    ], report));
    outbox.processBatch.mockImplementation(async () => { order.push("messages"); return { claimed: 2, published: 2, failed: 0 }; });
    const response = await request(app).post("/internal/outbox/process").auth(secret, { type: "bearer" });
    expect(order).toEqual(["cleanup", "prune", "birthday", "messages"]);
    expect(report).toHaveBeenCalledExactlyOnceWith("reservation_cleanup");
    expect(response.body.maintenance).toEqual({ ok: false, failedJobs: ["reservation_cleanup"] });
  });
  it("accepts the Vercel Cron bearer token on authenticated GET, but never anonymously",async()=>{
    const vercelToken="a-different-synthetic-vercel-cron-token-32-plus";
    const {app,outbox}=fixture(undefined,vercelToken);
    expect((await request(app).get("/internal/outbox/process")).status).toBe(401);
    expect((await request(app).get("/internal/outbox/process").auth("invalid-token",{type:"bearer"})).status).toBe(401);
    expect(outbox.processBatch).not.toHaveBeenCalled();
    const response=await request(app).get("/internal/outbox/process").auth(vercelToken,{type:"bearer"});
    expect(response.status).toBe(200);
    expect(outbox.processBatch).toHaveBeenCalledExactlyOnceWith(10);
    expect(response.body.health).toMatchObject({duePending:0});
  });
  it("preserves the successful/default response and refuses unauthorized processing before any work", async () => {
    const maintenance = vi.fn().mockResolvedValue(undefined), { app, outbox } = fixture(maintenance);
    expect((await request(app).post("/internal/outbox/process")).status).toBe(401);
    expect(maintenance).not.toHaveBeenCalled(); expect(outbox.processBatch).not.toHaveBeenCalled();
    const response = await request(app).post("/internal/outbox/process").auth(secret, { type: "bearer" });
    expect(response.body.maintenance).toEqual({ ok: true, failedJobs: [] });
  });
});
