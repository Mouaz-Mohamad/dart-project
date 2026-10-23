// Pure commerce rules, extracted without changing their calculations.
import type { LockedItem } from "./commerce.types.js";

export function finalModelPriceMinor(sellingMinor: number, discountPercent: number): number {
  return Math.max(0, Math.round(sellingMinor * (1 - Math.min(100, Math.max(0, discountPercent)) / 100)));
}

export function resolveItemDiscount(
  modelDiscountPercent: number,
  benefit: Record<string, unknown> | null,
  dartCardSlotsRemaining = Number.POSITIVE_INFINITY,
): { percent: number; source: string; reference: string; consumesDartCardSlot: boolean } {
  const modelPercent = Math.min(100, Math.max(0, Number(modelDiscountPercent) || 0));
  if (modelPercent > 0) {
    return { percent: modelPercent, source: "Model", reference: "", consumesDartCardSlot: false };
  }
  if (!benefit) return { percent: 0, source: "None", reference: "", consumesDartCardSlot: false };
  const type = String(benefit.type || "");
  if (type === "Dart Card" && dartCardSlotsRemaining <= 0) {
    return { percent: 0, source: "None", reference: "", consumesDartCardSlot: false };
  }
  const percent = Math.min(100, Math.max(0, Number(benefit.percent) || 0));
  if (!percent) return { percent: 0, source: "None", reference: "", consumesDartCardSlot: false };
  return {
    percent,
    source: type === "Promotion" ? "Campaign" : type,
    reference: String(benefit.code || benefit.rewardId || benefit.cardId || ""),
    consumesDartCardSlot: type === "Dart Card",
  };
}

export function detectCartPriceChanges(
  reservedPricing: Array<Record<string, unknown>>,
  items: Array<Pick<LockedItem, "model_id" | "color" | "size" | "selling_minor" | "discount_percent">>,
  siteDiscountPercent: number,
): Array<Record<string, unknown>> {
  const changes: Array<Record<string, unknown>> = [];
  const currentByVariant = new Map<
    string,
    { discountPercent: number; finalUnitMinor: number }
  >();

  for (const row of items) {
    const key = JSON.stringify([row.model_id, row.color, row.size]);
    if (currentByVariant.has(key)) continue;
    const sellingMinor = Number(row.selling_minor || 0);
    const modelDiscountPercent = Number(row.discount_percent || 0);
    const discountPercent = siteDiscountPercent || modelDiscountPercent;
    currentByVariant.set(key, {
      discountPercent,
      finalUnitMinor: finalModelPriceMinor(sellingMinor, discountPercent),
    });
  }

  for (const snapshot of reservedPricing) {
    const key = JSON.stringify([
      String(snapshot.modelId || ""),
      String(snapshot.color || ""),
      String(snapshot.size || ""),
    ]);
    const current = currentByVariant.get(key);
    if (!current) continue;
    const previousFinalMinor = Number(snapshot.finalUnitMinor || 0);
    if (previousFinalMinor === current.finalUnitMinor) continue;
    changes.push({
      modelId: snapshot.modelId,
      color: snapshot.color,
      size: snapshot.size,
      quantity: Number(snapshot.quantity || 1),
      previousUnitPrice: previousFinalMinor / 100,
      currentUnitPrice: current.finalUnitMinor / 100,
      previousDiscountPercent: Number(snapshot.discountPercent || 0),
      currentDiscountPercent: current.discountPercent,
    });
  }
  return changes;
}
