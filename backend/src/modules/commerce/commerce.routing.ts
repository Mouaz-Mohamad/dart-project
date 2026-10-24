// Pure commerce rules, extracted without changing their calculations.

export function distanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const firstLat = radians(latitude1);
  const secondLat = radians(latitude2);
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLat) *
      Math.cos(secondLat) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function suggestedStopOrder<T extends { latitude: number; longitude: number }>(
  startLatitude: number | null,
  startLongitude: number | null,
  stops: T[],
): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let latitude = Number.isFinite(startLatitude) ? Number(startLatitude) : null;
  let longitude = Number.isFinite(startLongitude) ? Number(startLongitude) : null;

  while (remaining.length) {
    if (latitude === null || longitude === null) {
      const next = remaining.shift()!;
      ordered.push(next);
      latitude = next.latitude;
      longitude = next.longitude;
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const stop = remaining[index]!;
      const distance = distanceKm(latitude, longitude, stop.latitude, stop.longitude);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next!);
    latitude = next!.latitude;
    longitude = next!.longitude;
  }
  return ordered;
}

export function adaptiveSuggestedStopOrder<T extends { latitude: number; longitude: number; routeState?: string }>(
  startLatitude: number | null,
  startLongitude: number | null,
  stops: T[],
): T[] {
  const currentIndex = stops.findIndex((stop) => stop.routeState === "current");
  if (currentIndex < 0) {
    return suggestedStopOrder(startLatitude, startLongitude, stops);
  }

  const current = stops[currentIndex]!;
  const remaining = stops.filter((_, index) => index !== currentIndex);
  return [
    current,
    ...suggestedStopOrder(current.latitude, current.longitude, remaining),
  ];
}
