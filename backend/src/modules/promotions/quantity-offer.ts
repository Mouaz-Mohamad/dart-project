// Immutable quantity-offer allocation and cumulative refund settlement in integer piastres.
import type { PoolClient } from "pg";

export type OfferLine = { itemCode: string; modelId: string; baseMinor: number; finalMinor: number };
export type QuantityOfferSnapshot = {
  minQuantity: number; minOrderMinor: number; eligibleItemCodes: string[];
  discountKind: "percent" | "fixed"; discountAmountMinor: number;
};

// Allocate a fixed order saving exactly once, using integer piastres and a stable
// largest-remainder split. No line can become negative and no rounding is lost.
export function allocateFixedSaving(lines: Array<{ id: string; baseMinor: number }>, amount: number): Map<string, number> {
  const total = lines.reduce((sum, line) => sum + line.baseMinor, 0);
  const saving = Math.min(total, Math.max(0, Math.round(amount)));
  const shares = lines.map((line) => {
    const numerator = BigInt(saving) * BigInt(line.baseMinor);
    return { id: line.id, minor: total ? Number(numerator / BigInt(total)) : 0, remainder: total ? Number(numerator % BigInt(total)) : 0 };
  });
  let remaining = saving - shares.reduce((sum, share) => sum + share.minor, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))) {
    if (remaining <= 0) break;
    share.minor += 1; remaining -= 1;
  }
  return new Map(shares.map((share) => [share.id, share.minor]));
}

export function quantityRefund(
  policy: QuantityOfferSnapshot, lines: OfferLine[], returnedCodes: Set<string>, paidMinor: number, refundedMinor: number,
) {
  const eligible = new Set(policy.eligibleItemCodes);
  const kept = lines.filter((line) => !returnedCodes.has(line.itemCode));
  const keptEligible = kept.filter((line) => eligible.has(line.itemCode));
  const subtotal = keptEligible.reduce((sum, line) => sum + line.baseMinor, 0);
  const qualifies = new Set(keptEligible.map((line) => line.modelId)).size >= policy.minQuantity && subtotal >= policy.minOrderMinor;
  const saving = !qualifies ? 0 : policy.discountKind === "fixed" ? Math.min(subtotal, policy.discountAmountMinor)
    : keptEligible.reduce((sum, line) => sum + line.baseMinor - line.finalMinor, 0);
  const retainedMinor = kept.filter((line) => !eligible.has(line.itemCode)).reduce((sum, line) => sum + line.finalMinor, 0) + subtotal - saving;
  const targetRefundMinor = Math.max(0, paidMinor - retainedMinor);
  const refundMinor = Math.max(0, targetRefundMinor - refundedMinor);
  return { refundMinor, retainedMinor, qualifies, targetRefundMinor };
}

// Call only while holding the original order row lock. Completed zero-value
// refunds also remove a model from the count. Exchanges keep their model slot.
export async function quantityReturnRefund(
  client: PoolClient, orderId: string, promotion: Record<string, unknown> | null,
  itemCode: string, paidMinor: number, refundedMinor: number, excludeRecord = "",
) {
  const benefits = Array.isArray(promotion?.benefits) ? promotion.benefits : promotion ? [promotion] : [];
  const benefit = benefits.find((row: Record<string, unknown>) => row.type === "Promotion" && row.quantityOffer);
  if (!benefit) return null;
  const policy = benefit.quantityOffer as QuantityOfferSnapshot;
  const lines = await client.query<{ item_code: string; model_id: string; original_unit_minor: string; final_unit_minor: string }>(
    "SELECT item_code,model_id,original_unit_minor::text,final_unit_minor::text FROM order_items WHERE order_id=$1", [orderId]);
  const completed = await client.query<{ item_code: string }>(
    `SELECT item_code FROM return_requests WHERE order_id=$1 AND record_id<>$2
      AND lower(request_type) IN ('refund','return')
      AND (lower(status) IN ('completed','good','damaged') OR payload->>'financialCompletionApplied'='true')`, [orderId, excludeRecord]);
  const returned = new Set([...completed.rows.map((row) => row.item_code), itemCode]);
  const result = quantityRefund(policy, lines.rows.map((line) => ({ itemCode: line.item_code, modelId: line.model_id,
    baseMinor: Number(line.original_unit_minor), finalMinor: Number(line.final_unit_minor) })), returned, paidMinor, refundedMinor);
  const originalRefundMinor = Number(lines.rows.find((line) => line.item_code === itemCode)?.final_unit_minor || 0);
  return { ...result, originalRefundMinor, offerAdjustmentMinor: originalRefundMinor - result.refundMinor };
}
