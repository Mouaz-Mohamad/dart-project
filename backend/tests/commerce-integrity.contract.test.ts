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
const platform = readFileSync(
  new URL("../../Js/dart-platform.js", import.meta.url),
  "utf8",
);
const customerInteractions = readFileSync(
  new URL("../src/modules/commerce/customer-interaction.service.ts", import.meta.url),
  "utf8",
);

describe("commerce concurrency and representative safety contracts", () => {
  it("enforces checkout idempotency inside the order transaction", () => {
    expect(routes).toContain('request.get("Idempotency-Key")');
    expect(service).toContain("INSERT INTO idempotency_keys");
    expect(service).toContain('status === "completed" && existing.response_body');
    expect(service).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(service).toMatch(/SET status='completed', response_code=201, response_body=/);
    expect(platform).toContain('"Idempotency-Key": `checkout-${CART_RESERVATION_ID}`');
    expect(platform.indexOf('setCartReservationId(uid("CART"))')).toBeGreaterThan(
      platform.indexOf('await apiRequest("/api/v1/orders"'),
    );
  });

  it("fails closed when a guest reservation has no matching owner proof", () => {
    expect(service.match(/!\w+\.guest_owner_hash/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("verifies every reserved item moved to the created order", () => {
    expect(service).toContain("inventoryUpdate.rowCount");
    expect(service).toContain("RESERVATION_CHANGED");
  });

  it("validates checkout coordinates and address provenance", () => {
    expect(routes).toContain('z.coerce.number().finite().min(-90).max(90).transform(String)');
    expect(routes).toContain('z.enum(["map", "manual"])');
  });

  it("reads critical return data from relational rows while keeping the version envelope locked", () => {
    expect(service).toContain('readRelationalDashboardDomain');
    for (const domain of ["returns", "cards", "damage", "promotions", "birthday_rewards"]) {
      expect(service).not.toContain(
        `SELECT data FROM dashboard_domain_state WHERE domain='${domain}'`,
      );
      expect(service).not.toContain(
        `SELECT version::text, data FROM dashboard_domain_state WHERE domain='${domain}'`,
      );
    }
    const lockedVersions = service.match(
      /SELECT version::text FROM dashboard_domain_state WHERE domain='returns' FOR UPDATE/g,
    ) ?? [];
    expect(lockedVersions.length).toBeGreaterThanOrEqual(4);
    expect(service).not.toContain(
      "SELECT domain, data FROM dashboard_domain_state WHERE domain IN ('returns','cards','birthday_rewards','birthday_messages')",
    );
  });

  it("never runs relational leaderboard reads concurrently on one pg client", () => {
    expect(service).not.toMatch(
      /Promise\.all\(\[\s*readRelationalDashboardDomain\(client, "returns"\),\s*readRelationalDashboardDomain\(client, "cards"\)/,
    );
    expect(service).toContain(
      'const returnRows = await readRelationalDashboardDomain(client, "returns");',
    );
    expect(service).toContain(
      'const cardRows = await readRelationalDashboardDomain(client, "cards");',
    );
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

  it("serializes customer return creation and preserves exchange-chain identity", () => {
    expect(customerInteractions).toContain('this.lockDomain(client, "returns")');
    expect(customerInteractions).toContain("resolveExchangeChain(existingReturns, line.item_code)");
    expect(customerInteractions).toContain(
      '"SELECT version::text FROM dashboard_domain_state WHERE domain=$1 FOR UPDATE"',
    );
    expect(customerInteractions).toContain("readRelationalDashboardDomain(client, domain)");
  });
});
