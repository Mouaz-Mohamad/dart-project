// Pure commerce rules, extracted without changing their calculations.

export function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

export function birthdayWindow(
  birthday: string | null | undefined,
  reference = new Date(),
): { year: number; startsAt: string; expiresAt: string } | null {
  const match = String(birthday || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const today = cairoDateKey(reference).split("-").map(Number);
  const currentYear = today[0]!;
  const todayUtc = Date.UTC(today[0]!, today[1]! - 1, today[2]!);
  const month = Number(match[1]);
  const day = Number(match[2]);
  for (const year of [currentYear, currentYear - 1]) {
    const start = Date.UTC(year, month - 1, day);
    const end = start + 7 * 86_400_000;
    if (todayUtc >= start && todayUtc < end) {
      const key = (value: number) => new Date(value).toISOString().slice(0, 10);
      return { year, startsAt: key(start), expiresAt: key(end) };
    }
  }
  return null;
}

export function promotionPercentage(row: Record<string, unknown>): number {
  return Math.min(
    100,
    Math.max(
      0,
      Number(row.percent ?? row.discountPercent ?? row.discount ?? 0) || 0,
    ),
  );
}

export function promotionDateActive(row: Record<string, unknown>, today = cairoDateKey()): boolean {
  const startsAt = String(row.startsAt || row.startDate || "").slice(0, 10);
  const endsAt = String(row.endsAt || row.endDate || "").slice(0, 10);
  return (!startsAt || today >= startsAt) && (!endsAt || today <= endsAt);
}

export function promotionTargetsCustomer(
  row: Record<string, unknown>,
  stats: { deliveredOrders: number; deliveredItems: number },
): boolean {
  const type = String(
    row.targetType || row.targetSegment || row.segment || "all",
  ).trim().toLowerCase();
  const value = Number(row.targetValue ?? row.minimumPurchasedItems ?? row.minPurchasedItems ?? 0);

  if (["", "all", "everyone", "all_customers"].includes(type)) return true;
  if (["zero_orders", "0_orders", "no_orders", "customers_with_0_orders"].includes(type)) {
    return stats.deliveredOrders === 0;
  }
  if (["min_purchased_items", "purchased_items_at_least", "minimum_items"].includes(type)) {
    return stats.deliveredItems >= Math.max(0, value);
  }
  if (["exact_purchased_items", "purchased_items_exact"].includes(type)) {
    return stats.deliveredItems === Math.max(0, value);
  }
  return false;
}

export function flexibleDateExpiry(value: unknown): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const parts = text.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [a, b, d] = parts;
  const year = a! > 999 ? a! : d!;
  const month = b!;
  const day = a! > 999 ? d! : a!;
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}
