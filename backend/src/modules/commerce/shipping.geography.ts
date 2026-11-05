// Offline administrative-boundary checks: no per-order external service or API key.
import boundaries from "./egypt-governorates.json" with { type: "json" };
import { governorateFromText } from "./shipping.coverage.js";

function insideRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!, b = ring[i]!;
    const ax = a[0]!, ay = a[1]!, bx = b[0]!, by = b[1]!;
    // The closing zero-length segment must not classify every point as boundary.
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    const dot = (x - ax) * (bx - ax) + (y - ay) * (by - ay);
    if (length > 0 && Math.abs(cross) < 1e-12 && dot >= 0 && dot <= length) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function governoratesAtPoint(latitude: unknown, longitude: unknown): string[] {
  if (latitude === "" || longitude === "" || latitude == null || longitude == null) return [];
  const y = Number(latitude), x = Number(longitude);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  return boundaries.governorates.filter(({ bounds, polygons }) =>
    x >= bounds[0]! && x <= bounds[2]! && y >= bounds[1]! && y <= bounds[3]! &&
    polygons.some((rings) => insideRing(x, y, rings[0]!) &&
      !rings.slice(1).some((hole) => insideRing(x, y, hole))))
    .map((row) => row.id);
}

export function matchesDeliveryGovernorate(governorate: string, latitude: unknown, longitude: unknown): boolean {
  const canonical = governorateFromText(governorate);
  return Boolean(canonical && governoratesAtPoint(latitude, longitude).includes(canonical));
}
