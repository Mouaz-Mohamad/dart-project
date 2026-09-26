// DART CODE GUIDE | backend/src/modules/commerce/road-routing-provider.ts
// الغرض: عزل مزود الطرق الحقيقي عن الواجهة؛ الخريطة تطلب Road Geometry من Backend فقط.

export interface RoadRoutePoint {
  latitude: number;
  longitude: number;
}

export interface RoadRouteSegment {
  fromIndex: number;
  toIndex: number;
  geometry: Array<[number, number]>;
}

export interface RoadRouteResult {
  provider: "osrm";
  geometry: Array<[number, number]>;
  segments: RoadRouteSegment[];
}

const MAX_PROVIDER_WAYPOINTS = 20;
const PROVIDER_TIMEOUT_MS = 8_000;

function providerBaseUrl(): string {
  return String(process.env.DART_ROUTING_PROVIDER_URL || "https://router.project-osrm.org")
    .trim()
    .replace(/\/+$/, "");
}

function appendGeometry(
  target: Array<[number, number]>,
  coordinates: unknown,
): void {
  if (!Array.isArray(coordinates)) return;
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const longitude = Number(point[0]);
    const latitude = Number(point[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const normalized: [number, number] = [latitude, longitude];
    const last = target[target.length - 1];
    if (last && last[0] === normalized[0] && last[1] === normalized[1]) continue;
    target.push(normalized);
  }
}

function legGeometry(leg: unknown): Array<[number, number]> {
  if (!leg || typeof leg !== "object") return [];
  const steps = (leg as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const geometry: Array<[number, number]> = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const stepGeometry = (step as { geometry?: { coordinates?: unknown } }).geometry;
    appendGeometry(geometry, stepGeometry?.coordinates);
  }
  return geometry;
}

async function fetchChunk(
  points: RoadRoutePoint[],
  offset: number,
): Promise<RoadRouteSegment[]> {
  const coordinates = points
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(";");
  const url = new URL(`${providerBaseUrl()}/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "false");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");
  url.searchParams.set("continue_straight", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Route Provider Unavailable");
    const payload = await response.json() as { routes?: Array<{ legs?: unknown[] }> };
    const legs = payload.routes?.[0]?.legs;
    if (!Array.isArray(legs) || legs.length !== points.length - 1) {
      throw new Error("Route Provider Unavailable");
    }
    return legs.map((leg, index) => {
      const geometry = legGeometry(leg);
      if (geometry.length < 2) throw new Error("Route Provider Unavailable");
      return {
        fromIndex: offset + index,
        toIndex: offset + index + 1,
        geometry,
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRoadRoute(points: RoadRoutePoint[]): Promise<RoadRouteResult> {
  if (points.length < 2 || points.length > 100) {
    throw new Error("Road route requires between 2 and 100 points");
  }
  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      point.longitude < -180 ||
      point.longitude > 180
    ) {
      throw new Error("Road route contains invalid coordinates");
    }
  }

  const segments: RoadRouteSegment[] = [];
  for (let start = 0; start < points.length - 1; start += MAX_PROVIDER_WAYPOINTS - 1) {
    const chunk = points.slice(start, Math.min(start + MAX_PROVIDER_WAYPOINTS, points.length));
    if (chunk.length < 2) break;
    segments.push(...await fetchChunk(chunk, start));
  }
  if (segments.length !== points.length - 1) {
    throw new Error("Route Provider Unavailable");
  }

  const geometry: Array<[number, number]> = [];
  for (const segment of segments) {
    for (const point of segment.geometry) {
      const last = geometry[geometry.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      geometry.push(point);
    }
  }
  if (geometry.length < 2) throw new Error("Route Provider Unavailable");
  return { provider: "osrm", geometry, segments };
}
