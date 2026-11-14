import type { PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { normalizeEmail, normalizeEgyptianPhone } from "../../security/normalization.js";

export interface CustomerRecordInput {
  name: string;
  phone1: string;
  phone2?: string | undefined;
  email?: string | undefined;
  birthday?: string | null | undefined;
  country?: string | undefined;
  governorate?: string | undefined;
}

export function customerRecordError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CUSTOMER_IDENTITY_CONFLICT")) {
    throw new AppError(409, "CUSTOMER_IDENTITY_CONFLICT", "Phone and email belong to different customers. Review both records before saving.");
  }
  if (message.includes("CUSTOMER_ACCOUNT_UNAVAILABLE")) {
    throw new AppError(403, "ACCOUNT_UNAVAILABLE", "This customer account is not available");
  }
  if (message.includes("CUSTOMER_NOT_FOUND")) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer not found");
  if (/CUSTOMER_(PHONE|NAME|EMAIL)_INVALID/.test(message)) {
    throw new AppError(422, "CUSTOMER_DETAILS_INVALID", "Check the customer name, Egyptian phone numbers and email");
  }
  throw error;
}

export async function upsertCustomerRecord(client: PoolClient, input: CustomerRecordInput,
  origin: "website" | "admin" | "profile", targetId?: string) {
  try {
    const result = await client.query<{ id: string }>(
      "SELECT dart_upsert_customer_record($1::jsonb,$2,$3::uuid)::text AS id",
      [JSON.stringify(input), origin, targetId || null],
    );
    return result.rows[0]!.id;
  } catch (error) { customerRecordError(error); }
}

export async function resolveCustomerReference(client: PoolClient, ref: string) {
  const result = await client.query<{ user_id: string }>(
    `SELECT c.user_id::text FROM customers c WHERE c.client_code=$1 OR c.user_id::text=$1
     UNION SELECT customer_user_id::text FROM customer_identity_aliases WHERE alias=$1`, [ref],
  );
  if (result.rows.length > 1) throw new AppError(409, "CUSTOMER_IDENTITY_CONFLICT", "Customer reference is ambiguous");
  return result.rows[0]?.user_id || null;
}

// Checkout can link a contact internally, but never changes an existing login
// identity or grants a session based on unverified contact details.
export async function guestCheckoutCustomer(client: PoolClient, input: CustomerRecordInput) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dart_unified_customer_identity'))");
  const matches = await client.query<{ id: string; status: string; email_normalized: string | null }>(
    `SELECT DISTINCT u.id::text,u.status,u.email_normalized FROM users u
      WHERE u.account_type='customer' AND u.deleted_at IS NULL AND
        (u.email_normalized=$1 OR EXISTS (SELECT 1 FROM account_phones p
          WHERE p.user_id=u.id AND p.is_primary AND p.phone_normalized=$2))`,
    [normalizeEmail(input.email || ""), normalizeEgyptianPhone(input.phone1)],
  );
  if (matches.rows.length > 1) {
    throw new AppError(409, "CHECKOUT_CONTACT_CONFLICT", "Check your phone and email together, or contact Dart support. Your cart is still reserved.");
  }
  const existing = matches.rows[0];
  // A phone can be shared, mistyped or pre-registered by someone else. A new
  // order must never become visible to a different email owner on that basis.
  if (existing?.email_normalized && existing.email_normalized !== normalizeEmail(input.email || "")) {
    throw new AppError(409, "CHECKOUT_CONTACT_CONFLICT", "Check your phone and email together, or contact Dart support. Your cart is still reserved.");
  }
  if (existing && !["active", "pending_verification"].includes(existing.status)) {
    throw new AppError(409, "CHECKOUT_CONTACT_UNAVAILABLE", "Please contact Dart support to complete this order.");
  }
  return existing?.id || upsertCustomerRecord(client, input, "website");
}
