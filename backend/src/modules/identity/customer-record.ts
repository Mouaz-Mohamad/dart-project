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
  const postgres = error as { code?: string; constraint?: string } | null;
  if (postgres?.code === "23505" && ["account_phones_realm_phone_unique", "users_realm_email_unique"].includes(postgres.constraint || "")) {
    throw new AppError(409, "CUSTOMER_IDENTITY_CONFLICT", "Check your phone and email together, or contact Dart support. Your cart is still reserved.");
  }
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

// A guest can purchase with a phone already used as someone else's login,
// but that number remains a contact only; it NEVER authenticates the new buyer.
// All writes run in the caller's checkout transaction and advisory identity lock.
export async function guestCheckoutCustomer(client: PoolClient, input: CustomerRecordInput): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dart_unified_customer_identity'))");
  const email = normalizeEmail(input.email || "");
  const phone = normalizeEgyptianPhone(input.phone1);
  const [emailMatch, phoneMatch] = await Promise.all([
    client.query<{ id: string; status: string }>(
      `SELECT u.id::text,u.status FROM users u
        WHERE u.account_type='customer' AND u.deleted_at IS NULL
          AND u.status<>'deleted' AND u.email_normalized=$1`, [email]),
    client.query<{ id: string; status: string }>(
      `SELECT u.id::text,u.status FROM account_phones p
        JOIN users u ON u.id=p.user_id
        WHERE p.account_type='customer' AND p.phone_normalized=$1
          AND u.account_type='customer' AND u.deleted_at IS NULL AND u.status<>'deleted'`, [phone]),
  ]);
  const emailOwner = emailMatch.rows[0];
  const phoneOwner = phoneMatch.rows[0];

  // A suspended/rejected customer's identity must not be recycled through
  // guest checkout. This check also covers legacy non-primary login numbers.
  if ([emailOwner,phoneOwner].some(row => row && !["active","pending_verification"].includes(row.status))) {
    throw new AppError(409,"CHECKOUT_CONTACT_UNAVAILABLE","Please contact Dart support to complete this order.");
  }
  if (emailOwner && phoneOwner && emailOwner.id !== phoneOwner.id) {
    // A previous, explicitly separated guest contact may place another order.
    // An arbitrary phone/email pair does not prove that two logins are one person.
    const linked = await client.query<{ allowed: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM customer_contact_phones
        WHERE customer_user_id=$1::uuid AND phone_normalized=$2
          AND source='guest_checkout_shared_phone') AS allowed`,
      [emailOwner.id,phone]);
    if (!linked.rows[0]?.allowed) {
      throw new AppError(409,"CHECKOUT_CONTACT_CONFLICT",
        "Check your phone and email together, or contact Dart support. Your cart is still reserved.");
    }
  }
  if (emailOwner) return emailOwner.id;

  if (phoneOwner) {
    // The email belongs to no existing active customer, but the login phone
    // does. Preserve its owner, create a separate email-login customer, and
    // retain the supplied phone only as an unverified order contact.
    const emailDisplay = (input.email || "").trim();
    if (!email || !emailDisplay || !email.includes("@")) {
      throw new AppError(422,"CHECKOUT_EMAIL_REQUIRED","Enter a valid email address to complete checkout.");
    }
    try {
      const created = await client.query<{ id: string }>(
        `INSERT INTO users(account_type,email,email_normalized,password_hash,status)
          VALUES('customer',$1,$2,NULL,'active') RETURNING id::text`,
        [emailDisplay,email]);
      const customerId = created.rows[0]!.id;
      await client.query(
        `INSERT INTO customers(user_id,full_name,birthday)
          VALUES($1::uuid,$2,$3::date)`,
        [customerId,input.name.trim(),input.birthday || null]);
      await client.query(
        `INSERT INTO user_roles(user_id,role_id)
          SELECT $1::uuid,id FROM roles WHERE name='Customer'`, [customerId]);
      await client.query(
        `INSERT INTO customer_profile_details(customer_user_id,name_source,birthday_source,country,governorate)
          VALUES($1::uuid,'website',$2,$3,$4)`,
        [customerId,input.birthday ? "website" : "admin",input.country?.trim() || "Egypt",input.governorate?.trim() || ""]);
      const contacts = [{ raw: input.phone1, normalized: phone }];
      if (input.phone2?.trim()) {
        const second = normalizeEgyptianPhone(input.phone2);
        if (second !== phone) contacts.push({ raw: input.phone2, normalized: second });
      }
      for (const contact of contacts) {
        await client.query(
          `INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source)
            VALUES($1::uuid,$2,$3,'guest_checkout_shared_phone')
            ON CONFLICT(customer_user_id,phone_normalized) DO NOTHING`,
          [customerId,contact.normalized,contact.raw.trim()]);
      }
      // Store a restricted reconciliation marker, not an authorization link
      // or automatic merge. Never expose the existing owner's identity to guests.
      await client.query(
        `INSERT INTO customer_identity_conflicts(record_key,original_record,reason)
          VALUES($1,jsonb_build_object('guestCustomerId',$2::text,'phoneLoginOwnerId',$3::text),
            'GUEST_SHARED_LOGIN_PHONE_CONTACT_ONLY')`,
        [`guest_shared_phone:${customerId}`,customerId,phoneOwner.id]);
      await client.query(
        `INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
          VALUES('system','GUEST_SHARED_LOGIN_PHONE_CONTACT_ONLY','customers',$1,
            jsonb_build_object('existingLoginRetained',true,'customerPhoneIsContactOnly',true))`,
        [customerId]);
      return customerId;
    } catch (error) { customerRecordError(error); }
  }

  // The unique login-phone index also covers deleted accounts. Retire only
  // a tombstone's claim without changing its orders or contact history.
  const retired = await client.query<{
    id: string; user_id: string; phone_normalized: string; phone_display: string; created_at: Date;
  }>(`SELECT p.id::text,p.user_id::text,p.phone_normalized,p.phone_display,p.created_at
       FROM account_phones p JOIN users u ON u.id=p.user_id
       WHERE p.account_type='customer' AND p.phone_normalized=$1
         AND (u.deleted_at IS NOT NULL OR u.status='deleted')
       FOR UPDATE OF u,p`, [phone]);
  for (const oldPhone of retired.rows) {
    await client.query(`INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source,recorded_at)
      VALUES($1,$2,$3,'retired_login',$4)
      ON CONFLICT(customer_user_id,phone_normalized) DO NOTHING`,
    [oldPhone.user_id,oldPhone.phone_normalized,oldPhone.phone_display,oldPhone.created_at]);
    await client.query("DELETE FROM account_phones WHERE id=$1", [oldPhone.id]);
    await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata)
      VALUES('system','DELETED_CUSTOMER_PHONE_RETIRED','customers',$1,$2::jsonb)`,
    [oldPhone.user_id,JSON.stringify({ reason: "guest_checkout_phone_reuse", phoneIdentityId: oldPhone.id })]);
  }
  return upsertCustomerRecord(client,input,"website");
}
