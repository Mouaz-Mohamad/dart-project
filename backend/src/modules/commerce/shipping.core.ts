// DART | Shipping & Fulfillment: pure domain rules.
// A shipment is not a second order. External carriers do not receive representative credentials.
export const EGYPT_GOVERNORATES = Object.freeze([
  "Cairo", "Giza", "Alexandria", "Qalyubia", "Sharqia", "Dakahlia",
  "Gharbia", "Monufia", "Beheira", "Kafr El Sheikh", "Damietta",
  "Port Said", "Ismailia", "Suez", "North Sinai", "South Sinai",
  "Red Sea", "Fayoum", "Beni Suef", "Minya", "Assiut", "Sohag",
  "Qena", "Luxor", "Aswan", "New Valley", "Matrouh",
]);

export type ShippingType = "dart" | "external";

export interface ShippingCompany {
  id: string;
  name: string;
  trackingUrl: string;
  active: boolean;
  governorates: string[];
}

export interface DispatchedShipment {
  type: ShippingType;
  companyId: string;
  companyName: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  dispatchedAt: string;
  status: "Handed Over";
}

export const DART_CARRIER: ShippingCompany = Object.freeze({
  id: "dart", name: "Dart Delivery", trackingUrl: "", active: true,
  governorates: [],
});

export function normalizeTrackingNumber(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{1,79}$/.test(value)) {
    throw new Error("Tracking number must be 2–80 letters, digits, /, _ or -.");
  }
  return value;
}

export function validTrackingPortal(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 2000) throw new Error("Tracking portal HTTPS URL is required.");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Invalid tracking portal URL."); }
  if (url.protocol !== "https:" || url.username || url.password ||
      !url.hostname.includes(".") || /^(?:localhost|127\.0\.0\.1)$/i.test(url.hostname)) {
    throw new Error("Tracking portal must be an official HTTPS URL.");
  }
  return url.toString();
}

export function selectShippingCompany(
  companies: readonly ShippingCompany[], companyId: string, governorate = "",
): ShippingCompany {
  const selected = companies.find((company) => company.id === companyId && company.active);
  if (!selected) throw new Error("Shipping company is inactive or missing.");
  if (selected.governorates.length && (!governorate ||
      !selected.governorates.some((name) => name.toLocaleLowerCase() === governorate.toLocaleLowerCase()))) {
    throw new Error("Shipping company does not cover this governorate.");
  }
  return selected;
}

export function dispatchShipment(
  companies: readonly ShippingCompany[], input: {
    companyId: string;
    trackingNumber?: string | undefined;
    representativeId?: string | undefined;
    governorate: string;
    now: string;
  },
): DispatchedShipment {
  const company = selectShippingCompany(companies, input.companyId, input.governorate);
  if (company.id === "dart") {
    if (!input.representativeId?.trim()) throw new Error("Dart representative is required.");
    if (input.trackingNumber) throw new Error("Dart tracking uses representative live tracking.");
    return {
      type: "dart", companyId: "dart", companyName: company.name,
      trackingNumber: null, trackingUrl: null,
      dispatchedAt: input.now, status: "Handed Over",
    };
  }
  if (input.representativeId) throw new Error("External shipping cannot assign a Dart representative.");
  return {
    type: "external", companyId: company.id, companyName: company.name,
    trackingNumber: normalizeTrackingNumber(input.trackingNumber),
    trackingUrl: validTrackingPortal(company.trackingUrl),
    dispatchedAt: input.now, status: "Handed Over",
  };
}
