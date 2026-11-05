import type { PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { governorateFromText } from "./shipping.coverage.js";
import { DART_CARRIER, dispatchShipment, type ShippingCompany } from "./shipping.core.js";

export interface DispatchAssignment {
  companyId: string;
  companyName: string;
  representativeId: string | null;
  representativeName: string;
  trackingNumber: string;
  coverageConfirmed: boolean;
  deliveryGroupId: string;
}

// Used at preparation AND handover: a saved plan is never proof that a courier
// remains active or that the destination remains covered.
export async function validateDispatchAssignment(client: PoolClient, orderId: string, input: {
  shippingCompanyId?: string | undefined;
  representativeId?: string | undefined;
  trackingNumber?: string | undefined;
  coverageConfirmed?: boolean | undefined;
  deliveryGroupId?: string | undefined;
}) {
  const companyId = String(input.shippingCompanyId || "dart").trim();
  const destination = (await client.query<{ governorate: string; city: string; area: string }>(
    `SELECT COALESCE(delivery_address->>'governorate','') AS governorate,
       COALESCE(delivery_address->>'city','') AS city,
       COALESCE(delivery_address->>'coverageArea',delivery_address->>'area','') AS area
     FROM orders WHERE id=$1`, [orderId],
  )).rows[0]!;
  const settings = (await client.query<{ data: Record<string, unknown> }>(
    "SELECT data FROM site_settings WHERE id='main' FOR SHARE", [],
  )).rows[0]?.data || {};
  if (Array.isArray(settings.blockedGovernorates) && settings.blockedGovernorates.includes(governorateFromText(destination.governorate) || destination.governorate)) {
    throw new AppError(422, "DELIVERY_GOVERNORATE_BLOCKED", "Delivery to this governorate is disabled");
  }
  let representativeId: string | null = null;
  let representativeName = "";
  if (companyId === "dart") {
    if (!input.representativeId?.trim()) throw new AppError(422, "REPRESENTATIVE_REQUIRED", "Choose a representative before preparing dispatch");
    const representative = (await client.query<{ user_id: string; full_name: string }>(
      `SELECT r.user_id::text,r.full_name FROM representatives r JOIN users u ON u.id=r.user_id
       WHERE (r.user_id::text=$1 OR r.representative_code=$1)
         AND r.approval_status='approved' AND u.status='active' FOR SHARE OF r,u`, [input.representativeId],
    )).rows[0];
    if (!representative) throw new AppError(409, "REPRESENTATIVE_UNAVAILABLE", "Choose an active representative");
    representativeId = representative.user_id;
    representativeName = representative.full_name;
  }
  const companies = Array.isArray(settings.shippingCompanies) ? settings.shippingCompanies as ShippingCompany[] : [];
  try {
    const shipment = dispatchShipment([DART_CARRIER, ...companies], {
      companyId, representativeId: representativeId || input.representativeId,
      trackingNumber: input.trackingNumber, coverageConfirmed: input.coverageConfirmed,
      ...destination, now: new Date().toISOString(),
    });
    const assignment: DispatchAssignment = {
      companyId, companyName: shipment.companyName, representativeId, representativeName,
      trackingNumber: shipment.trackingNumber || "", coverageConfirmed: input.coverageConfirmed === true,
      deliveryGroupId: companyId === "dart" ? String(input.deliveryGroupId || "") : "",
    };
    return { assignment, shipment: shipment.type === "external" ? shipment : null };
  } catch (error) {
    throw new AppError(422, "EXTERNAL_DISPATCH_INVALID", error instanceof Error ? error.message : "Invalid shipping details");
  }
}
