import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

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
          ],
        };
      }

      if (sql.includes("FROM dashboard_domain_state")) {
        return {
          rows: [
            {
              domain: "returns",
              data: [
                {
                  itemCode: "A-2",
                  requestType: "Refund",
                  status: "Completed",
                  completedAt: "2026-09-20T12:00:00.000Z",
                  isPostDeliveryReturn: true,
                  isDeleted: false,
                },
                {
                  itemCode: "A-3",
                  requestType: "Exchange",
                  status: "Completed",
                  completedAt: "2026-09-20T13:00:00.000Z",
                  isPostDeliveryReturn: true,
                  isDeleted: false,
                },
              ],
            },
            {
              domain: "cards",
              data: [
                {
                  clientId: "DR-3",
                  status: "Active",
                  isArchived: false,
                  isDeleted: false,
                },
              ],
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
    ]);
    expect(result.rows.some((row) => row.name.includes("Card Holder"))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
