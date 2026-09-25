// DART CODE GUIDE | backend/tests/commerce-integrity.contract.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
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

  it("binds each birthday reward to one customer-year and only reactivates cancelled/refused reservations while still valid", () => {
    expect(service).toContain("const rewardId = `BDAY-${customerPromotion.client_code}-${birthday.year}`;");
    expect(service).toContain('birthdayReward.status = "Reserved"');
    expect(service).toContain('if (nextStatus === "Delivered")');
    expect(service).toContain('reward.status = "Used"');
    expect(service).toContain('["Cancelled", "Refused"].includes(nextStatus)');
    expect(service).toContain('reward.status = String(reward.expiresAt || "") > cairoDateKey() ? "Active" : "Expired"');
  });

  it("keeps leaderboard relational reads sequential and does not exclude active Dart Card holders", () => {
    const leaderboardStart = service.indexOf("public async publicLeaderboard");
    const leaderboardEnd = service.indexOf("public async validatePromotionCode", leaderboardStart);
    const leaderboardSource = service.slice(leaderboardStart, leaderboardEnd);

    expect(leaderboardSource).not.toMatch(/Promise\.all\([\s\S]*readRelationalDashboardDomain\(client/);
    expect(leaderboardSource).toContain(
      'const returnRows = await readRelationalDashboardDomain(client, "returns");',
    );
    expect(leaderboardSource).not.toContain(
      'readRelationalDashboardDomain(client, "cards")',
    );
    expect(leaderboardSource).not.toContain("excludedClients");
    expect(leaderboardSource).toContain(".filter((row) => row.items > 0)");
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

  it("claims the same guest reservation after authentication without releasing its items", () => {
    expect(routes).toContain('"/me/cart/claim"');
    expect(service).toContain("public async claimGuestCart(");
    expect(service).toContain("SET customer_user_id=$2");
    expect(service).toContain("guest_owner_hash=NULL");
    expect(service).toContain("CART_RESERVATION_EXPIRED");
  });

  it("keeps customer live tracking lightweight, private, and within the approved three-second GPS cadence", () => {
    expect(routes).toContain('"/me/tracking/live"');
    const liveRoute = routes.indexOf('"/me/tracking/live"');
    expect(liveRoute).toBeGreaterThan(-1);
    expect(routes.slice(liveRoute, liveRoute + 260)).toContain("limit: 120");
    expect(service).toContain("public async customerLiveTracking(");
    expect(service).toContain("payload->>'clientId'=$1");
    expect(service).toContain("status='Representative On The Way'");
    const customerLiveStart = service.indexOf("public async customerLiveTracking(");
    const customerLiveEnd = service.indexOf("public async customerSnapshot(", customerLiveStart);
    const customerLiveSource = service.slice(customerLiveStart, customerLiveEnd);
    expect(customerLiveSource).not.toContain("AND o.delivery_started_at IS NOT NULL");
    expect(service).toContain("payload->>'status'='Pickup On The Way'");

    const locationRoute = routes.indexOf('"/representatives/location"');
    expect(locationRoute).toBeGreaterThan(-1);
    expect(routes.slice(locationRoute, locationRoute + 260)).toContain("limit: 30");
  });

  it("commits admin order workflow changes atomically and rejects stale UI state", () => {
    expect(routes).toContain('"/admin/orders/:orderRef/workflow"');
    expect(service).toContain("public async adminOrderWorkflowAction(");
    expect(service).toContain('"ORDER_STATE_STALE"');
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("await this.applyOrderStatusTransition(");
    expect(service).toContain("'ORDER_WORKFLOW_CHANGED'");
    expect(service).toContain("direction: isBack ? \"back\" : \"forward\"");
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

  it("allows exchange color and size changes inside the original model", () => {
    expect(service).not.toContain("Replacement must match the original model, color and size");
    expect(service).toContain("replacement.model_id !== originalItem.model_id");
    expect(service).toContain("record.requestedColor && replacement.color !== String(record.requestedColor)");
    expect(service).toContain("record.requestedSize && replacement.size !== String(record.requestedSize)");
    expect(service).toContain("original model and the color/size selected for this exchange");
  });

});
