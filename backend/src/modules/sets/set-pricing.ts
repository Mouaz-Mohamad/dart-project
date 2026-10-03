// DART CODE GUIDE | backend/src/modules/sets/set-pricing.ts
// Pure pricing helpers for Sets. No client-supplied price is trusted by these helpers.

export type SetDiscountSource = "None" | "Set" | "Birthday" | "Dart Card";

export interface SetBenefitInput {
  setDiscountPercent: number;
  birthdayEligible: boolean;
  birthdayPercent: number;
  dartCardEligible: boolean;
  dartCardPercent: number;
  dartCardRemainingPieces: number;
  setPieceCount: number;
}

export interface SetBenefitResolution {
  source: SetDiscountSource;
  percent: number;
  consumesDartCardPieces: number;
}

export function clampPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

export function applyPercentMinor(amountMinor: number, percent: number): number {
  const safeAmount = Math.max(0, Math.trunc(Number(amountMinor) || 0));
  const safePercent = clampPercent(percent);
  return Math.max(0, Math.round(safeAmount * (1 - safePercent / 100)));
}

// Priority is intentionally exclusive: Set -> Birthday -> Dart Card.
// Campaigns are not accepted as an input because campaigns never apply to Sets.
export function resolveSetBenefit(input: SetBenefitInput): SetBenefitResolution {
  const setPercent = clampPercent(input.setDiscountPercent);
  if (setPercent > 0) {
    return { source: "Set", percent: setPercent, consumesDartCardPieces: 0 };
  }

  const birthdayPercent = clampPercent(input.birthdayPercent);
  if (input.birthdayEligible && birthdayPercent > 0) {
    return { source: "Birthday", percent: birthdayPercent, consumesDartCardPieces: 0 };
  }

  const pieceCount = Math.max(0, Math.trunc(Number(input.setPieceCount) || 0));
  const remaining = Math.max(0, Math.trunc(Number(input.dartCardRemainingPieces) || 0));
  const cardPercent = clampPercent(input.dartCardPercent);
  if (
    input.dartCardEligible &&
    cardPercent > 0 &&
    pieceCount > 0 &&
    remaining >= pieceCount
  ) {
    return {
      source: "Dart Card",
      percent: cardPercent,
      consumesDartCardPieces: pieceCount,
    };
  }

  return { source: "None", percent: 0, consumesDartCardPieces: 0 };
}

/**
 * Allocate a total integer amount across positive weights while preserving the exact total.
 * Largest-remainder allocation prevents lost/created piastres and is deterministic by index.
 */
export function allocateMinorByWeights(totalMinor: number, weights: number[]): number[] {
  const total = Math.max(0, Math.trunc(Number(totalMinor) || 0));
  if (!Array.isArray(weights) || !weights.length) return [];

  const normalized = weights.map((value) => Math.max(0, Math.trunc(Number(value) || 0)));
  const weightTotal = normalized.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) {
    const result = new Array<number>(normalized.length).fill(0);
    for (let index = 0; index < total; index += 1) {
      const target = index % result.length;
      result[target] = (result[target] ?? 0) + 1;
    }
    return result;
  }

  const exact = normalized.map((weight) => (total * weight) / weightTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);

  const ranked = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let cursor = 0; remainder > 0; cursor += 1, remainder -= 1) {
    const target = ranked[cursor % ranked.length]?.index ?? 0;
    allocated[target] = (allocated[target] ?? 0) + 1;
  }
  return allocated;
}

export interface SetAllocationInput {
  modelSellingMinor: number;
  quantity?: number;
}

export interface SetUnitAllocation {
  componentIndex: number;
  unitIndex: number;
  weightMinor: number;
  baseAllocatedMinor: number;
  finalAllocatedMinor: number;
}

/**
 * Expand component quantities into physical-piece rows then allocate both Set base price
 * and final paid Set price proportionally using each model's current natural selling price.
 */
export function allocateSetPrices(
  components: SetAllocationInput[],
  setBasePriceMinor: number,
  finalSetPriceMinor: number,
): SetUnitAllocation[] {
  const expanded: Array<{ componentIndex: number; unitIndex: number; weightMinor: number }> = [];
  components.forEach((component, componentIndex) => {
    const quantity = Math.max(1, Math.trunc(Number(component.quantity) || 1));
    const weightMinor = Math.max(0, Math.trunc(Number(component.modelSellingMinor) || 0));
    for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
      expanded.push({ componentIndex, unitIndex, weightMinor });
    }
  });

  const weights = expanded.map((row) => row.weightMinor);
  const base = allocateMinorByWeights(setBasePriceMinor, weights);
  const final = allocateMinorByWeights(finalSetPriceMinor, weights);
  return expanded.map((row, index) => ({
    ...row,
    baseAllocatedMinor: base[index] ?? 0,
    finalAllocatedMinor: final[index] ?? 0,
  }));
}
