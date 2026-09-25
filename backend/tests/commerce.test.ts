// DART CODE GUIDE | backend/tests/commerce.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CommerceService,
  detectCartPriceChanges,
} from "../src/modules/commerce/commerce.service.js";

describe("CommerceService public leaderboard", () => {
  it("ranks by net purchased pieces then net spend, subtracts completed refunds, keeps exchanges, and excludes active Dart Card holders", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM orders o") && sql.includes("JOIN customers c")) {
        expect(sql).toContain("LEFT JOIN customers c");
        return {
          rows: [
            {
              client_code: "DR-1",
              full_name: "Alice Example Customer",
              order_code: "K-1",
              final_minor: "10000",
              amount_refunded_minor: "5000",
              item_codes: ["A-1", "A-2"],
            },
            {
              client_code: "DR-1",
              full_name: "Alice Example Customer",
              order_code: "K-2",
              final_minor: "5000",
              amount_refunded_minor: "0",
              item_codes: ["A-3"],
            },
            {
              client_code: "DR-2",
              full_name: "Bob Example Customer",
              order_code: "K-3",
              final_minor: "20000",
              amount_refunded_minor: "0",
              item_codes: ["B-1", "B-2", "B-3"],
            },
            {
              client_code: "DR-3",
              full_name: "Card Holder Customer",
              order_code: "K-4",
              final_minor: "30000",
              amount_refunded_minor: "0",
              item_codes: ["C-1", "C-2", "C-3", "C-4"],
            },
            {
              client_code: "DR-4",
              full_name: "Expired Card Customer",
              order_code: "K-5",
              final_minor: "40000",
              amount_refunded_minor: "0",
              item_codes: ["D-1"],
            },
            {
              client_code: "DR-5",
              full_name: "Fourth Eligible Customer",
              order_code: "K-6",
              final_minor: "1000",
              amount_refunded_minor: "0",
              item_codes: ["E-1"],
            },
            {
              client_code: "DR-6",
              full_name: "Migrated Seven Piece Customer",
              order_code: "K-7",
              final_minor: "70000",
              amount_refunded_minor: "0",
              item_codes: [],
              legacy: {
                clientId: "DR-6",
                items: ["G-1", "G-2", "G-3", "G-4", "G-5", "G-6", "G-7"],
              },
            },
          ],
        };
      }

      if (sql.includes("FROM return_requests")) {
        return {
          rows: [
            {
              payload: {
                itemCode: "A-2",
                requestType: "Refund",
                status: "Completed",
                completedAt: "2026-09-20T12:00:00.000Z",
                isPostDeliveryReturn: true,
                isDeleted: false,
              },
            },
            {
              payload: {
                itemCode: "A-3",
                requestType: "Exchange",
                status: "Completed",
                completedAt: "2026-09-20T13:00:00.000Z",
                isPostDeliveryReturn: true,
                isDeleted: false,
              },
            },
          ],
        };
      }

      if (sql.includes("FROM loyalty_cards")) {
        return {
          rows: [
            {
              payload: {
                clientId: "DR-3",
                status: "Active",
                isArchived: false,
                isDeleted: false,
              },
            },
            {
              payload: {
                clientId: "DR-4",
                status: "Active",
                expDate: "2020-01-01",
                isArchived: false,
                isDeleted: false,
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected query in leaderboard test: ${sql}`);
    });

    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;

    const service = new CommerceService(pool);
    const result = await service.publicLeaderboard();

    expect(result.period).toMatch(/^\d{4}-\d{2}$/);
    expect(result.rows).toEqual([
      {
        rank: 1,
        name: "Migrated Seven Piece Customer",
        orders: 1,
        items: 7,
      },
      {
        rank: 2,
        name: "Bob Example Customer",
        orders: 1,
        items: 3,
      },
      {
        rank: 3,
        name: "Alice Example Customer",
        orders: 2,
        items: 2,
      },
      {
        rank: 4,
        name: "Expired Card Customer",
        orders: 1,
        items: 1,
      },
      {
        rank: 5,
        name: "Fourth Eligible Customer",
        orders: 1,
        items: 1,
      },
    ]);
    expect(result.rows.some((row) => row.name.includes("Card Holder"))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});


describe("CommerceService relational customer snapshot", () => {
  it("reads return, loyalty and birthday records from relational tables", async () => {
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT client_code FROM customers")) {
        return { rows: [{ client_code: "DR-1" }] };
      }
      if (sql.includes("FROM orders o") && sql.includes("WHERE o.customer_user_id")) {
        return { rows: [] };
      }
      if (sql.includes("FROM return_requests")) {
        return { rows: [{ payload: { id: "r1", clientId: "DR-1", itemCode: "I-1" } }] };
      }
      if (sql.includes("FROM loyalty_cards")) {
        return { rows: [{ payload: { id: "c1", clientId: "DR-1", status: "Active" } }] };
      }
      if (sql.includes("FROM birthday_rewards")) {
        return { rows: [{ payload: { id: "b1", clientId: "DR-1", status: "Active" } }] };
      }
      if (sql.includes("FROM message_records")) {
        expect(values[0]).toBe("birthday_messages");
        return { rows: [{ payload: { id: "m1", clientId: "DR-1", status: "Sent" } }] };
      }
      if (sql.includes("FROM customer_preferences")) {
        return { rows: [{ last_address: null }] };
      }
      throw new Error(`Unexpected query in customer snapshot test: ${sql}`);
    });
    const pool = { query } as unknown as Pool;
    const snapshot = await new CommerceService(pool).customerSnapshot(
      "123e4567-e89b-12d3-a456-426614174001",
    );

    expect(snapshot.orders).toEqual([]);
    expect(snapshot.returns).toHaveLength(1);
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.birthdayRewards).toHaveLength(1);
    expect(snapshot.birthdayMessages).toHaveLength(1);
    expect(snapshot.reviewEligible).toBe(false);
    expect(snapshot.purchaseStats).toEqual({ totalPieces: 0, monthlyPieces: 0 });
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("SELECT domain, data FROM dashboard_domain_state"),
      ),
    ).toBe(false);
  });

  it("marks a customer review-eligible when any authoritative order is Delivered", async () => {
    const now = new Date();
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT client_code FROM customers")) {
        return { rows: [{ client_code: "DR-1" }] };
      }
      if (sql.includes("FROM orders o") && sql.includes("WHERE o.customer_user_id")) {
        return {
          rows: [{
            id: "o1",
            order_code: "K-1",
            status: "Delivered",
            payment_method: "COD",
            payment_status: "Paid",
            subtotal_minor: "10000",
            order_discount_minor: "0",
            final_minor: "10000",
            delivery_cost_minor: "0",
            amount_paid_minor: "10000",
            amount_refunded_minor: "0",
            promotion: null,
            contact_snapshot: {},
            delivery_address: {},
            delivery_notes: "",
            created_at: now,
            updated_at: now,
            delivered_at: now,
            delivery_started_at: null,
            representative_user_id: null,
            representative_code: null,
            representative_name: null,
            representative_phone: null,
            courier_latitude: null,
            courier_longitude: null,
            courier_accuracy_meters: null,
            courier_updated_at: null,
            items: [
              { itemCode: "I-1" },
              { itemCode: "I-2" },
              { itemCode: "I-3" },
            ],
          }],
        };
      }
      if (sql.includes("FROM return_requests")) {
        return {
          rows: [{
            payload: {
              id: "r1",
              clientId: "DR-1",
              requestType: "Refund",
              status: "Completed",
              itemCode: "I-2",
              completedAt: now.toISOString(),
            },
          }],
        };
      }
      if (sql.includes("FROM loyalty_cards")) return { rows: [] };
      if (sql.includes("FROM birthday_rewards")) return { rows: [] };
      if (sql.includes("FROM message_records")) {
        expect(values[0]).toBe("birthday_messages");
        return { rows: [] };
      }
      if (sql.includes("FROM customer_preferences")) return { rows: [{ last_address: null }] };
      throw new Error(`Unexpected query in review eligibility snapshot test: ${sql}`);
    });
    const pool = { query } as unknown as Pool;
    const snapshot = await new CommerceService(pool).customerSnapshot(
      "123e4567-e89b-12d3-a456-426614174001",
    );
    expect(snapshot.reviewEligible).toBe(true);
    expect(snapshot.purchaseStats).toEqual({ totalPieces: 2, monthlyPieces: 2 });
  });
});


describe("CommerceService admin live operations", () => {
  it("shows an approved representative whenever at least one non-terminal order is assigned", async () => {
    const now = new Date("2026-09-25T16:00:00.000Z");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WITH active_reps AS")) {
        expect(sql).toContain("status NOT IN ('Delivered','Cancelled','Refused','Returned')");
        expect(sql).not.toContain("r.approval_status='approved'");
        expect(sql).not.toContain("u.status='active'");
        return { rows: [{
          representative_user_id: "123e4567-e89b-12d3-a456-426614174111",
          representative_code: "REP-1",
          representative_name: "Ahmed Representative",
          latitude: 30.04,
          longitude: 31.23,
          accuracy_meters: 7,
          location_updated_at: now,
          round_started_at: now,
        }] };
      }
      if (sql.includes("FROM orders o") && sql.includes("delivery_route_stops")) {
        return { rows: [{
          id: "123e4567-e89b-12d3-a456-426614174222",
          order_code: "K-40",
          representative_user_id: "123e4567-e89b-12d3-a456-426614174111",
          status: "Accepted",
          contact_snapshot: { name: "Customer" },
          delivery_address: { latitude: "30.05", longitude: "31.24", fullAddress: "Cairo" },
          final_minor: "38400",
          updated_at: now,
          delivered_at: null,
          route_state: null,
          sequence_number: 1,
          route_note: null,
        }] };
      }
      throw new Error(`Unexpected live operations query: ${sql}`);
    });
    const pool = { query } as unknown as Pool;
    const result = await new CommerceService(pool).adminLiveOperations();
    expect(result.representatives).toHaveLength(1);
    const representative = result.representatives[0];
    expect(representative).toBeDefined();
    expect(representative?.repId).toBe("REP-1");
    const representativeOrders = Array.isArray(representative?.orders)
      ? representative.orders as Array<Record<string, unknown>>
      : [];
    expect(representativeOrders).toHaveLength(1);
    expect(representativeOrders[0]?.orderId).toBe("K-40");
    expect(representativeOrders[0]?.routeState).toBe("upcoming");
    expect(result.totals.activeRepresentatives).toBe(1);
  });
});


describe("cart price review", () => {
  it("detects a changed unit price after reservation", () => {
    const changes = detectCartPriceChanges(
      [
        {
          modelId: "M-1",
          color: "Burgundy",
          size: "M",
          quantity: 1,
          discountPercent: 0,
          finalUnitMinor: 60000,
        },
      ],
      [
        {
          model_id: "M-1",
          color: "Burgundy",
          size: "M",
          selling_minor: "60000",
          discount_percent: "0",
        },
      ],
      10,
    );

    expect(changes).toEqual([
      {
        modelId: "M-1",
        color: "Burgundy",
        size: "M",
        quantity: 1,
        previousUnitPrice: 600,
        currentUnitPrice: 540,
        previousDiscountPercent: 0,
        currentDiscountPercent: 10,
      },
    ]);
  });

  it("does not require review when reserved and current prices match", () => {
    const changes = detectCartPriceChanges(
      [
        {
          modelId: "M-1",
          color: "Black",
          size: "L",
          quantity: 2,
          discountPercent: 20,
          finalUnitMinor: 48000,
        },
      ],
      [
        {
          model_id: "M-1",
          color: "Black",
          size: "L",
          selling_minor: "60000",
          discount_percent: "20",
        },
      ],
      0,
    );

    expect(changes).toEqual([]);
  });
});


describe("CommerceService customer live tracking", () => {
  it("returns only the signed-in customer's active delivery and pickup courier locations", async () => {
    const now = new Date("2026-09-22T18:00:00.000Z");
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT client_code FROM customers")) {
        expect(values[0]).toBe("123e4567-e89b-12d3-a456-426614174001");
        return { rows: [{ client_code: "DR-1" }] };
      }
      if (
        sql.includes("FROM orders o") &&
        sql.includes("status='Representative On The Way'")
      ) {
        expect(values[0]).toBe("123e4567-e89b-12d3-a456-426614174001");
        return {
          rows: [{
            id: "order-db-1",
            order_code: "K-1",
            status: "Representative On The Way",
            delivery_started_at: now,
            representative_user_id: "rep-user-1",
            latitude: 30.04,
            longitude: 31.23,
            accuracy_meters: 8,
            location_updated_at: now,
          }],
        };
      }
      if (sql.includes("FROM return_requests")) {
        expect(sql).toContain("payload->>'clientId'=$1");
        expect(values[0]).toBe("DR-1");
        return {
          rows: [{
            payload: {
              id: "return-db-1",
              returnId: "R-1",
              clientId: "DR-1",
              status: "Pickup On The Way",
              pickupStartedAt: now.toISOString(),
              representativeId: "rep-user-2",
              representativeBusinessId: "REP-2",
              isDeleted: false,
              isArchived: false,
            },
          }],
        };
      }
      if (sql.includes("FROM representatives r")) {
        expect(values[0]).toEqual(["rep-user-2", "REP-2"]);
        return {
          rows: [{
            user_id: "rep-user-2",
            representative_code: "REP-2",
            latitude: 30.05,
            longitude: 31.24,
            accuracy_meters: 6,
            location_updated_at: now,
          }],
        };
      }
      throw new Error(`Unexpected query in customer live tracking test: ${sql}`);
    });

    const pool = { query } as unknown as Pool;
    const result = await new CommerceService(pool).customerLiveTracking(
      "123e4567-e89b-12d3-a456-426614174001",
    );

    expect(result.orders).toEqual([{
      id: "order-db-1",
      orderId: "K-1",
      status: "Representative On The Way",
      deliveryStartedAt: now.toISOString(),
      courierLocation: {
        lat: 30.04,
        lng: 31.23,
        accuracy: 8,
        updatedAt: now.toISOString(),
      },
    }]);
    expect(result.returns).toEqual([{
      id: "return-db-1",
      returnId: "R-1",
      status: "Pickup On The Way",
      pickupStartedAt: now.toISOString(),
      courierLocation: {
        lat: 30.05,
        lng: 31.24,
        accuracy: 6,
        updatedAt: now.toISOString(),
      },
    }]);
  });
});
