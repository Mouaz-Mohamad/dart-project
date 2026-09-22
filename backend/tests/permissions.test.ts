// DART CODE GUIDE | backend/tests/permissions.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  requireActionPermission,
  requireAnyPermission,
} from "../src/middleware/authentication.js";

function invoke(
  middleware: ReturnType<typeof requireAnyPermission>,
  permissions: string[],
  body: Record<string, unknown> = {},
) {
  const next = vi.fn();
  middleware(
    {
      auth: { permissions } as Request["auth"],
      body,
    } as Request,
    {} as Response,
    next as unknown as NextFunction,
  );
  return next;
}

describe("fine-grained permission middleware", () => {
  it("accepts either a legacy parent permission or the specific action permission", () => {
    const middleware = requireAnyPermission("orders.manage", "orders.create");
    expect(invoke(middleware, ["orders.create"])).toHaveBeenCalledWith();
    expect(invoke(middleware, ["orders.manage"])).toHaveBeenCalledWith();
  });

  it("rejects a staff account that has neither accepted permission", () => {
    const next = invoke(
      requireAnyPermission("orders.manage", "orders.create"),
      ["orders.read"],
    );
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0] as { statusCode?: number; code?: string };
    expect(error?.statusCode).toBe(403);
    expect(error?.code).toBe("FORBIDDEN");
  });

  it("maps each return action to its own permission while keeping the parent fallback", () => {
    const middleware = requireActionPermission("action", {
      approve: ["returns.manage", "returns.review"],
      assign: ["returns.manage", "returns.assign"],
      inspect: ["returns.manage", "returns.inspect"],
    });
    expect(invoke(middleware, ["returns.assign"], { action: "assign" }))
      .toHaveBeenCalledWith();

    const denied = invoke(middleware, ["returns.assign"], { action: "inspect" });
    const error = denied.mock.calls[0]?.[0] as { statusCode?: number };
    expect(error?.statusCode).toBe(403);

    expect(invoke(middleware, ["returns.manage"], { action: "inspect" }))
      .toHaveBeenCalledWith();
  });

  it("lets schema validation handle an unknown action instead of authorizing it implicitly", () => {
    const middleware = requireActionPermission("action", {
      archive: ["orders.manage", "orders.archive"],
    });
    expect(invoke(middleware, [], { action: "unknown" })).toHaveBeenCalledWith();
  });
});
