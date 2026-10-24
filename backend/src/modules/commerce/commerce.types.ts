// Shared commerce contracts; existing service exports remain compatible.
import type { CodRiskLevel, CodVerificationStatus } from "./cod-risk.js";

export interface CartLineInput {
  modelId: string;
  color: string;
  size: string;
  quantity: number;
}

export interface OrderResponseOptions {
  responseMode: "delta";
  baseVersion: number;
}

export interface AdminOrdersState {
  version: number;
  orders: Record<string, unknown>[];
  responseMode?: "delta";
  baseVersion?: number;
  refreshRequired?: boolean;
}

export interface AdminOrdersScope {
  orderIds: string[];
  customerIds: string[];
  expectedVersion: number;
}

export interface CartReservationLine {
  modelId: string;
  color: string;
  size: string;
  quantity: number;
  setGroupId?: string;
  setId?: string;
  setUnitIndex?: number;
  setCartComponentId?: string;
  setComponentId?: string;
  setComponentUnitIndex?: number;
}

export interface CheckoutInput {
  reservationId: string;
  contact: {
    name: string;
    phone1: string;
    phone2?: string | undefined;
    email: string;
  };
  address: {
    country: string;
    governorate: string;
    area: string;
    street: string;
    building: string;
    floor: string;
    latitude: string;
    longitude: string;
    fullAddress?: string | undefined;
    addressSource?: string | undefined;
  };
  deliveryNotes?: string | undefined;
  promotionCode?: string | undefined;
  acceptPriceChanges?: boolean | undefined;
}

export interface LockedItem {
  id: string;
  item_code: string;
  model_id: string;
  color: string;
  size: string;
  model_name: string;
  cost_snapshot_minor: string;
  selling_minor: string;
  discount_percent: string;
}

export interface AdminOrderSnapshot {
  itemId?: string;
  itemCode?: string;
  modelCode?: string;
  name?: string;
  color?: string;
  size?: string;
  qty?: number;
  originalUnitPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  discountSource?: string;
  discountReference?: string;
  finalUnitPrice?: number;
  costSnapshot?: number;
}

export interface AdminOrderRow {
  id: string;
  order_code: string;
  status: string;
  cod_risk_level: CodRiskLevel;
  cod_risk_score: string | number;
  cod_risk_reasons: string[] | null;
  cod_refusals_in_window: string | number;
  cod_risk_policy_version: string | number;
  cod_verification_required: boolean;
  cod_verification_status: CodVerificationStatus;
  cod_verification_reason: string;
  cod_verified_at: Date | string | null;
  customer_cod_risk_level: CodRiskLevel | null;
  customer_cod_risk_score: string | number | null;
  customer_cod_refusals_in_window: string | number | null;
  refusal_history: Array<{
    orderId: string;
    refusedAt: Date | string;
    reason: string;
  }> | null;
  created_at: Date | string;
  delivered_at: Date | string | null;
  client_code: string | null;
  contact_snapshot: Record<string, unknown> | null;
  delivery_address: Record<string, unknown> | null;
  item_rows: AdminOrderSnapshot[] | null;
  subtotal_minor: string | number;
  order_discount_minor: string | number;
  final_minor: string | number;
  delivery_cost_minor: string | number;
  payment_method: string;
  payment_status: string;
  amount_paid_minor: string | number;
  amount_refunded_minor: string | number;
  promotion: Record<string, unknown> | null;
  delivery_notes: string;
  order_source: string;
  is_archived: boolean;
  is_deleted: boolean;
  version: string | number;
  legacy: Record<string, unknown> | null;
  representative_user_id: string | null;
  representative_code: string | null;
  representative_name: string | null;
  representative_phone: string | null;
  delivery_started_at: Date | string | null;
  courier_latitude: number | null;
  courier_longitude: number | null;
  courier_accuracy_meters: number | null;
  courier_location_updated_at: Date | string | null;
}
