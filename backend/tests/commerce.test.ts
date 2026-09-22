// DART CODE GUIDE | backend/tests/commerce.test.ts
// الغرض: اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CommerceService,
  detectCartPriceChanges,
} from "../src/modules/commerce/commerce.service.js";

describe("CommerceService public leaderboard", () => {
  it("ranks delivered orders, subtracts completed refunds, keeps exchanges, and excludes active Dart Card holders", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM orders o") && sql.includes("JOIN customers c")) {
        return {
          rows: [
            {
              client_code: "DR-1",
              full_name: "Alice Example Customer",
              order_code: "K-1",
              final_minor: "10000",
              item_codes: ["A-1", "A-2"],
            },
            {
              client_code: "DR-1",
              full_name: "Alice Example Customer",
              order_code: "K-2",
              final_minor: "5000",
              item_codes: ["A-3"],
            },
            {
              client_code: "DR-2",
              full_name: "Bob Example Customer",
              order_code: "K-3",
              final_minor: "20000",
              item_codes: ["B-1", "B-2", "B-3"],
            },
            {
              client_code: "DR-3",
              full_name: "Card Holder Customer",
              order_code: "K-4",
              final_minor: "30000",
              item_codes: ["C-1", "C-2", "C-3", "C-4"],
            },
            {
              client_code: "DR-4",
              full_name: "Expired Card Customer",
              order_code: "K-5",
              final_minor: "40000",
              item_codes: ["D-1"],
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
        name: "Alice Example Customer",
        orders: 2,
        items: 2,
      },
      {
        rank: 2,
        name: "Bob Example Customer",
        orders: 1,
        items: 3,
      },
      {
        rank: 3,
        name: "Expired Card Customer",
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
