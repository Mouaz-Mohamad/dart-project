import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  new URL("../src/modules/commerce/commerce.service.ts", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../src/modules/commerce/commerce.routes.ts", import.meta.url),
  "utf8",
);

describe("commerce concurrency and representative safety contracts", () => {
  it("serializes every mutable return-state read", () => {
    const mutableReturnReads = service.match(
      /SELECT version::text, data FROM dashboard_domain_state WHERE domain='returns'(?: FOR UPDATE)?/g,
    ) ?? [];
    expect(mutableReturnReads.length).toBeGreaterThanOrEqual(4);
    expect(mutableReturnReads.every((query) => query.endsWith("FOR UPDATE"))).toBe(true);
  });

  it("does not expose archived deliveries as active representative work", () => {
    expect(service).toContain("AND NOT is_archived");
    expect(service).toMatch(
      /status='Representative On The Way'[\s\S]{0,100}AND NOT is_deleted[\s\S]{0,100}AND NOT is_archived/,
    );
  });

  it("makes repeated delivery and pickup starts idempotent", () => {
    expect(service).toContain(
      'action === "start" && order.status === "Representative On The Way"',
    );
    expect(service).toContain(
      'action === "start" && String(record.status || "") === "Pickup On The Way"',
    );
  });

  it("refunds only an active delivered order", () => {
    expect(service).toMatch(
      /WHERE order_code=\$1[\s\S]{0,120}AND status='Delivered'[\s\S]{0,120}AND NOT is_deleted[\s\S]{0,120}AND NOT is_archived/,
    );
  });

  it("rate-limits representative delivery and return mutations", () => {
    for (const route of [
      "/representatives/orders/:orderCode/action",
      "/representatives/returns/:returnRef/action",
    ]) {
      const start = routes.indexOf(`"${route}"`);
      expect(start).toBeGreaterThan(-1);
      expect(routes.slice(start, start + 240)).toContain("rateLimit(");
    }
  });
});
