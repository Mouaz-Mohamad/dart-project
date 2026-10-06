// Test the actual browser normalization/adapter against the real secured route.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createFinanceRouter } from "../src/modules/finance/finance.routes.js";
import type { FinanceService } from "../src/modules/finance/finance.service.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { hashCsrfToken } from "../src/security/session-token.js";

const command = {
  id: "SET-FIXTURE", orderId: "K-FIXTURE", settlementDate: "2026-10-06",
  amountReceived: 540, fee: 0, reference: "", notes: "",
};
const csrf = "fixture-csrf";
const config = { sessionCookieName: "dart_session", authPepper: "fixture-pepper" };

function fixture(permissions = ["finance.manage_settlements"]) {
  const createCodSettlement = vi.fn(async (_actor: string, body: typeof command) => ({
    settlement: { ...body, status: "Received", currency: "EGP" }, version: 2,
  }));
  const identity = { authenticate: async () => ({
    userId: "11111111-1111-4111-8111-111111111111", accountType: "staff",
    permissions, mfaRequired: true, mfaSatisfied: true,
    csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
  }) };
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    // Synthetic test session; the real authentication and CSRF middleware run.
    req.cookies = { dart_session: `11111111-1111-4111-8111-111111111111.${"a".repeat(43)}` };
    next();
  });
  app.use("/api/v1", createFinanceRouter(
    { createCodSettlement } as unknown as FinanceService,
    identity as unknown as IdentityService, config,
  ));
  app.use(errorHandler);
  return { app, createCodSettlement };
}

function browser(app: ReturnType<typeof express>) {
  const posted: Record<string, unknown>[] = [];
  const window = { dispatchEvent() {}, addEventListener() {}, setInterval() {}, crypto };
  const context = createContext({
    window, globalThis: window, console, crypto, structuredClone, TextEncoder,
    location: { origin: "https://fixture.invalid" },
    document: { readyState: "loading", cookie: `dart_csrf=${csrf}`, addEventListener() {} },
    CustomEvent: class {}, setTimeout, clearTimeout,
    fetch: async (url: string, options: { method: string; body?: string; headers: Record<string, string> }) => {
      if (options.method !== "POST") {
        // A failed refresh after a confirmed POST must not falsely fail the save.
        return { ok: false, status: 503, json: async () => ({ error: { message: "Refresh unavailable" } }) };
      }
      const body = JSON.parse(options.body || "{}");
      posted.push(body);
      const response = await request(app).post(new URL(url).pathname)
        .set(options.headers).send(body);
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  });
  runInContext(readFileSync(new URL("../../Js/dart-state.js", import.meta.url), "utf8"), context);
  runInContext(readFileSync(new URL("../../Eye/dart-domain-state.js", import.meta.url), "utf8"), context);
  const finance = readFileSync(new URL("../../Eye/dart-finance.js", import.meta.url), "utf8")
    .replace('if (!root.document) return;',
      'root.testNormalize = normalizeRecord; if (!root.document) return;');
  runInContext(finance, context);
  return { posted, context };
}

describe("COD browser command contract", () => {
  it("reproduces the old full-record rejection without recording a receipt", async () => {
    const f = fixture();
    const response = await request(f.app).post("/api/v1/admin/finance/settlements")
      .set("X-CSRF-Token", csrf).send({ ...command, status: "Received", createdAt: "2026-10-06" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(f.createCodSettlement).not.toHaveBeenCalled();
  });

  it("accepts the normalized browser record, retaining the receipt id on retry", async () => {
    const f = fixture(), b = browser(f.app);
    const normalized = runInContext(`window.testNormalize("settlements", ${JSON.stringify(command)}, null)`, b.context);
    b.context.record = { ...normalized, id: command.id };
    expect(b.context.record).toHaveProperty("createdAt");
    for (let i = 0; i < 2; i++) {
      const saved = await runInContext("window.DartDomainState.createFinanceSettlement(record)", b.context);
      expect(saved.id).toBe(command.id);
    }
    expect(b.posted).toEqual([command, command]);
    expect(f.createCodSettlement).toHaveBeenCalledTimes(2);
    expect(runInContext('window.DartState.read("dart_finance_cod_settlements").length', b.context)).toBe(1);
  });

  it("preserves permission denial and never calls the settlement service", async () => {
    const f = fixture([]), b = browser(f.app);
    b.context.record = command;
    await expect(runInContext("window.DartDomainState.createFinanceSettlement(record)", b.context))
      .rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(f.createCodSettlement).not.toHaveBeenCalled();
  });

  it("keeps server validation for invalid money and security tokens", async () => {
    const f = fixture();
    const invalid = await request(f.app).post("/api/v1/admin/finance/settlements")
      .set("X-CSRF-Token", csrf).send({ ...command, fee: 541 });
    expect(invalid.status).toBe(422);
    const missingCsrf = await request(f.app).post("/api/v1/admin/finance/settlements").send(command);
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe("CSRF_INVALID");
    expect(f.createCodSettlement).not.toHaveBeenCalled();
  });
});
