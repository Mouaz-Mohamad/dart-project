// Historical order discount labels are derived from persisted checkout snapshots.
// Never resolve a code against today's campaign settings: old codes may be expired/deleted.
import { orderBenefit, orderBenefits } from "./commerce.pricing.js";
import type { AdminOrderSnapshot } from "./commerce.types.js";

function savedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function savingsOnLine(line: AdminOrderSnapshot): boolean {
  if (Number(line.discountAmount) > 0) return true;
  const original = Number(line.originalUnitPrice);
  const final = Number(line.finalUnitPrice);
  return Number.isFinite(original) && Number.isFinite(final) && original > final;
}

function sourceOf(line: AdminOrderSnapshot): string {
  return savedText(line.discountSource).toLowerCase();
}

function discountLabel(source: string, couponCode: string, campaignCode: string): string | null {
  switch (source.trim().toLowerCase()) {
    case "discount code":
    case "discountcode":
      return couponCode ? `Discount Code: ${couponCode}` : "Discount Code";
    case "campaign":
    case "promotion":
      return campaignCode ? `Campaign: ${campaignCode}` : "Campaign";
    case "model":
    case "item":
      return "Item Discount";
    case "birthday":
      return "Birthday Discount";
    case "dart card":
      return "Dart Card";
    case "manual":
      return "Manual Discount";
    case "quantity":
    case "quantity offer":
      return "Quantity Discount";
    case "set":
    case "set price":
      return "Set Discount";
    case "none":
    case "":
    case "mixed":
      return null;
    default:
      return `${source.trim()} Discount`;
  }
}

export function orderDiscountDisplay(
  promotion: Record<string, unknown> | null,
  legacy: Record<string, unknown>,
  snapshots: AdminOrderSnapshot[],
  orderDiscountMinor: number,
): { reasonDeduction: string; discountCode: string; promotionCode: string } {
  const discountedLines = snapshots.filter(savingsOnLine);
  const legacySaving = Number(legacy.orderLevelDiscountAmount || 0);
  const hasSavings = Number(orderDiscountMinor) > 0 || discountedLines.length > 0 || legacySaving > 0;
  if (!hasSavings) return { reasonDeduction: "-", discountCode: "", promotionCode: "" };

  const couponBenefit = orderBenefit(promotion, "Discount Code");
  const campaignBenefit = orderBenefit(promotion, "Promotion");
  const couponLine = discountedLines.find(line => ["discount code", "discountcode"].includes(sourceOf(line)));
  const campaignLine = discountedLines.find(line => ["campaign", "promotion"].includes(sourceOf(line)));
  const discountCode = savedText(couponLine?.discountReference) ||
    savedText(couponBenefit?.code) || savedText(legacy.discountCode);
  const promotionCode = savedText(campaignLine?.discountReference) ||
    savedText(campaignBenefit?.code) || savedText(legacy.promotionCode);

  const reasons = new Map<string, string[]>();
  function remember(label: string | null, itemCode = ""): void {
    if (!label) return;
    if (!reasons.has(label)) reasons.set(label, []);
    if (itemCode && !reasons.get(label)!.includes(itemCode)) reasons.get(label)!.push(itemCode);
  }
  for (const line of discountedLines) {
    remember(discountLabel(sourceOf(line), discountCode, promotionCode), savedText(line.itemCode));
  }
  // A persisted benefit is also proof of use when historical line sources were not populated.
  for (const benefit of orderBenefits(promotion)) {
    if (Number(benefit.discountMinor || 0) <= 0) continue;
    remember(discountLabel(savedText(benefit.type), discountCode, promotionCode));
  }
  if (!reasons.size && discountCode) remember(`Discount Code: ${discountCode}`);
  if (!reasons.size && promotionCode) remember(`Campaign: ${promotionCode}`);

  // Mixed orders show each item's source without merging two discounts on one piece.
  const mixed = reasons.size > 1;
  const description = [...reasons].map(([label, itemCodes]) =>
    mixed && itemCodes.length ? `${label} (${itemCodes.join(", ")})` : label
  ).join(" · ");
  const existingReason = savedText(legacy.reasonDeduction);
  return {
    reasonDeduction: description || (existingReason && existingReason !== "-" ? existingReason : "Discount Applied"),
    discountCode,
    promotionCode,
  };
}
