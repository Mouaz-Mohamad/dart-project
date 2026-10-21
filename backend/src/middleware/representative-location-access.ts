// Staff location permission applies to full snapshots and mutation responses alike.
import type { RequestHandler } from "express";

function redact(value: unknown, representative = false): unknown {
  if (Array.isArray(value)) {
    const rows = value.map((row) => redact(row, representative));
    return rows.some((row, index) => row !== value[index]) ? rows : value;
  }
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const record = value as Record<string, unknown>;
  let changed = false;
  const entries = Object.entries(record).map(([key, current]) => {
    const location = key === "courierLocation" || key === "representativeLocation" ||
      (representative && ["location", "lastLocation", "latitude", "longitude", "lat", "lng"].includes(key));
    const next = location ? null : redact(current,
      key === "representatives" || (record.domain === "representatives" && key === "data"));
    if (next !== current) changed = true;
    return [key, next];
  });
  return changed ? Object.fromEntries(entries) : value;
}

export const representativeLocationAccess: RequestHandler = (request, response, next) => {
  const json = response.json;
  response.json = function (body: unknown) {
    const restricted = /^\/api\/v1\/admin(?:\/|\?|$)/i.test(request.originalUrl) &&
      request.auth?.accountType === "staff" &&
      !request.auth.permissions.includes("representative_location.read");
    return json.call(this, restricted ? redact(body) : body);
  };
  next();
};
