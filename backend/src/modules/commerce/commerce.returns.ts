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
