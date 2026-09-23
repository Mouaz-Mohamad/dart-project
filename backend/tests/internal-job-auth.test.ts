// DART CODE GUIDE | backend/tests/internal-job-auth.test.ts
// الغرض: يثبت أن الـinternal jobs تفشل مغلقة ولا تنفذ أي عمل عند غياب OUTBOX_CRON_SECRET.
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { DartCardDrawService } from "../src/modules/loyalty/dart-card-draw.service.js";
import { createDartCardDrawRouter } from "../src/modules/loyalty/dart-card-draw.routes.js";
import { createOutboxRouter } from "../src/modules/outbox/outbox.routes.js";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";

function outboxApp(secret: string | null) {
  const processBatch = vi.fn().mockResolvedValue({ claimed: 0, published: 0, failed: 0 });
  const app = express();
  app.use(
    createOutboxRouter(
      { processBatch } as unknown as OutboxService,
      { outboxCronSecret: secret },
    ),
  );
  return { app, processBatch };
}

describe("internal job authentication", () => {
  it("returns 401 and does not process the outbox when the secret is missing", async () => {
    const { app, processBatch } = outboxApp(null);
    const response = await request(app)
      .post("/internal/outbox/process")
      .set("authorization", `Bearer ${"x".repeat(32)}`);
    expect(response.status).toBe(401);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("returns 401 and does not process the outbox when the configured secret is too short", async () => {
    const { app, processBatch } = outboxApp("short-secret");
    const response = await request(app)
      .post("/internal/outbox/process")
      .set("authorization", "Bearer short-secret");
    expect(response.status).toBe(401);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("processes the outbox only with an exact valid secret", async () => {
    const secret = "s".repeat(32);
    const { app, processBatch } = outboxApp(secret);
    const response = await request(app)
      .post("/internal/outbox/process")
      .set("authorization", `Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(processBatch).toHaveBeenCalledOnce();
  });

  it("also blocks the monthly Dart Card internal job when the secret is missing", async () => {
    const runDue = vi.fn().mockResolvedValue({ status: "not_due" });
    const app = express();
    app.use(
      createDartCardDrawRouter(
        { runDue } as unknown as DartCardDrawService,
        {} as IdentityService,
        {
          sessionCookieName: "dart_session",
          authPepper: "a".repeat(32),
          outboxCronSecret: null,
        },
      ),
    );

    const response = await request(app)
      .post("/internal/dart-card/monthly-draw")
      .set("authorization", `Bearer ${"x".repeat(32)}`);
    expect(response.status).toBe(401);
    expect(runDue).not.toHaveBeenCalled();
  });
});
