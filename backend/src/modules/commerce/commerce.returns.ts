import type { PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

// Membership belongs to the sale, independent of the current catalog or discount.
export async function assertExchangeableSale(
  client: Pick<PoolClient, "query">,
  orderCode: string,
  itemCode: string,
): Promise<void> {
  const result = await client.query<{ set_component: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM order_items oi
       JOIN orders o ON o.id=oi.order_id
       JOIN order_set_components osc ON osc.order_item_id=oi.id
       WHERE o.order_code=$1 AND oi.item_code=$2
     ) AS set_component`,
    [orderCode, itemCode],
  );
  if (result.rows[0]?.set_component) {
    throw new AppError(422, "SET_EXCHANGE_NOT_ALLOWED", "Set pieces cannot be exchanged. Refunds remain subject to the return policy.");
  }
}

// A physical item can be sold again; returns belong to one sale of that item.
export function returnSaleKey(orderCode: unknown, itemCode: unknown): string {
  return `${String(orderCode || "").trim()}\u0000${String(itemCode || "").trim().toLowerCase()}`;
}

export function returnMatchesSale(
  record: Record<string, unknown>,
  orderCode: string,
  itemCode: string,
  orderItemId?: string,
): boolean {
  return returnSaleKey(record.orderId, record.itemCode) === returnSaleKey(orderCode, itemCode)
    && (!record.orderItemId || !orderItemId || String(record.orderItemId) === orderItemId);
}
