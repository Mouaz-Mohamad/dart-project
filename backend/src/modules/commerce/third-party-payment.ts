// DART CODE GUIDE | backend/src/modules/commerce/third-party-payment.ts
// Keep the payer distinct from the gift recipient without changing sale prices.
import { AppError } from "../../http/app-error.js";
import { normalizeEgyptianPhone } from "../../security/normalization.js";

export interface ThirdPartyInput {
  collectionMode?: "Recipient" | "Third Party" | undefined;
  payerName?: string | undefined;
  payerPhone?: string | undefined;
}

export function thirdPartyDetails(input: ThirdPartyInput, previous: Record<string, unknown> = {}) {
  const collectionMode = input.collectionMode ?? (previous.collectionMode === "Third Party" ? "Third Party" : "Recipient");
  if (previous.collectionMode === "Third Party" && collectionMode !== "Third Party") {
    throw new AppError(409, "ORDER_PAYER_LOCKED", "A gift order keeps its linked income; cancel it before changing the payer type");
  }
  if (collectionMode === "Recipient") return { collectionMode, payerName: "", payerPhone: "" };
  const payerName = String(input.payerName ?? previous.payerName ?? "").trim();
  if (payerName.length < 2) throw new AppError(422, "PAYER_REQUIRED", "Enter the gift payer name and phone");
  let payerPhone: string;
  try { payerPhone = normalizeEgyptianPhone(String(input.payerPhone ?? previous.payerPhone ?? "")); }
  catch { throw new AppError(422, "PAYER_PHONE_INVALID", "Enter a valid Egyptian gift payer phone"); }
  return { collectionMode, payerName, payerPhone };
}
