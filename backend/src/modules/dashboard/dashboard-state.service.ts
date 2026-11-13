// DART CODE GUIDE | backend/src/modules/dashboard/dashboard-state.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import type { Pool } from "pg";
import { customerRecordError } from "../identity/customer-record.js";
import { AppError } from "../../http/app-error.js";
import { isDartCardEnabled } from "../settings/dart-card-switch.js";
import { isRelationalDashboardDomain, readRelationalDashboardDomain } from "./relational-domain.store.js";

export const DASHBOARD_DOMAINS = [
  "customers","returns","reviews","cards","representatives","damage",
  "notifications","contacts","birthday_rewards","birthday_messages","message_queue","promotions",
  "finance_expenses","finance_budgets","finance_invoices","finance_goals","finance_marketing",
  "finance_settlements","finance_audit","draw_audit",
] as const;

export type DashboardDomain = typeof DASHBOARD_DOMAINS[number];

function isContact(value: unknown): boolean {
  const row = value as Record<string, unknown> | null;
  return Boolean(row && (row.recordType === "contact" || row.source === "Contact Us"));
}

type FeedbackRow = { domain: "reviews" | "contacts"; version: string; data: unknown[] };
function feedbackState(rows: FeedbackRow[]) {
  const reviews = rows.find((row) => row.domain === "reviews");
  const contacts = rows.find((row) => row.domain === "contacts");
  if (!reviews || !contacts) throw new AppError(404, "DOMAIN_NOT_FOUND", "Dashboard domain not found");
  return { reviews, contacts, versions: {
    reviews: Number(reviews.version),
    // Contact submissions historically append to reviews. Track both stores so
    // an unseen incoming message can never be overwritten by a contact editor.
    contacts: Number(reviews.version) + Number(contacts.version) - 1,
  } };
}

function contactProjection(state: ReturnType<typeof feedbackState>): unknown[] {
  return [...state.reviews.data.filter(isContact), ...state.contacts.data].map((value) => ({
    ...(value as Record<string, unknown>), recordType: "contact", source: "Contact Us",
  }));
}

const RETURN_PRESENTATION_KEYS = new Set(["isArchived", "isDeleted", "archivedAt", "isChecked", "updatedAt"]);
function unchangedProjection(candidate: unknown, stored: unknown): boolean {
  if (Array.isArray(candidate)) return Array.isArray(stored) && candidate.length === stored.length && candidate.every((value, index) => unchangedProjection(value, stored[index]));
  if (candidate && typeof candidate === "object") return Boolean(stored && typeof stored === "object" &&
    Object.entries(candidate).every(([key, value]) => key in stored && unchangedProjection(value, (stored as Record<string, unknown>)[key])));
  return candidate === stored;
}

// Only presentation metadata may use the legacy array adapter. Workflow state,
// money, identities and inventory must use transactional Commerce commands.
export function protectReturnSnapshots(data: unknown[], stored: unknown[]): unknown[] {
  const id = (row: Record<string, unknown>) => String(row.id || row.returnId || "");
  const previous = new Map(stored.map(value => [id(value as Record<string, unknown>), value as Record<string, unknown>]));
  const selected = new Map<string, Record<string, unknown>>();
  for (const value of data) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(422, "RETURN_RECORD_INVALID", "Return records must be objects");
    const row = value as Record<string, unknown>, key = id(row), before = previous.get(key);
    if (!key || selected.has(key)) throw new AppError(422, "RETURN_RECORD_INVALID", "Return identifiers must be unique");
    if (!before || Object.entries(row).some(([field, current]) => !RETURN_PRESENTATION_KEYS.has(field) &&
      (!(field in before) || !unchangedProjection(current, before[field])))) {
      throw new AppError(405, "RETURN_COMMAND_REQUIRED", "Use the return create, edit or workflow command for operational changes");
    }
    const next = { ...before };
    for (const field of ["isArchived", "isDeleted"] as const) {
      if (row[field] !== undefined && typeof row[field] !== "boolean") throw new AppError(422, "RETURN_RECORD_INVALID", "Archive flags must be boolean");
      if (row[field] !== undefined) next[field] = row[field];
    }
    next.archivedAt = next.isArchived || next.isDeleted ? before.archivedAt || new Date().toISOString() : null;
    selected.set(key, next);
  }
  // Preserve the operational history when an old client removes a row from its
  // array. The dashboard's existing delete/restore controls remain functional.
  return stored.map(value => {
    const row = value as Record<string, unknown>;
    return selected.get(id(row)) || { ...row, isDeleted: true, isArchived: true, archivedAt: row.archivedAt || new Date().toISOString() };
  });
}

export class DashboardStateService {
  constructor(private readonly pool: Pool) {}

  async versions(): Promise<Record<DashboardDomain, number>> {
    const result = await this.pool.query<{ domain: DashboardDomain; version: string }>(
      `SELECT domain, version::text
         FROM dashboard_domain_state
        WHERE domain = ANY($1::text[])`,
      [DASHBOARD_DOMAINS],
    );
    const versions = Object.fromEntries(
      DASHBOARD_DOMAINS.map((domain) => [domain, 1]),
    ) as Record<DashboardDomain, number>;
    for (const row of result.rows) {
      versions[row.domain] = Number(row.version || 1);
    }
    versions.contacts += versions.reviews - 1;
    return versions;
  }

  async readMany(
    domains: DashboardDomain[],
  ): Promise<Array<{ domain: DashboardDomain; version: number; data: unknown[] }>> {
    return Promise.all(domains.map((domain) => this.read(domain)));
  }

  async read(domain: DashboardDomain): Promise<{ domain: DashboardDomain; version: number; data: unknown[] }> {
    if (domain === "reviews" || domain === "contacts") {
      const result = await this.pool.query<FeedbackRow>(
        "SELECT domain, version::text, data FROM dashboard_domain_state WHERE domain = ANY($1::text[])",
        [["reviews", "contacts"]],
      );
      const state = feedbackState(result.rows);
      return { domain, version: state.versions[domain], data: domain === "reviews"
        ? state.reviews.data.filter((value) => !isContact(value)) : contactProjection(state) };
    }
    const result = await this.pool.query<{ version: string; data: unknown[] }>(
      "SELECT version::text, data FROM dashboard_domain_state WHERE domain=$1",
      [domain],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "DOMAIN_NOT_FOUND", "Dashboard domain not found");
    const stored = Array.isArray(row.data) ? row.data : [];
    let data = isRelationalDashboardDomain(domain)
      ? await readRelationalDashboardDomain(this.pool, domain)
      : stored;
    if (domain === "customers") data = await this.mergeRegisteredCustomers(stored);
    if (domain === "representatives") data = await this.mergeRegisteredRepresentatives(stored);
    return { domain, version: Number(row.version || 1), data };
  }

  async write(
    domain: DashboardDomain,
    expectedVersion: number,
    data: unknown[],
    actorId: string,
    requestId: string,
    removeId?: string,
  ): Promise<{ domain: DashboardDomain; version: number; data: unknown[]; relatedVersions?: Record<string, number> }> {
    if (domain === "promotions") {
      throw new AppError(405, "PROMOTION_COMMAND_REQUIRED", "Use the validated promotion campaign commands");
    }
    if (domain === "finance_audit") {
      throw new AppError(405, "FINANCE_AUDIT_READ_ONLY", "Financial history is recorded by the server and cannot be edited");
    }
    if (domain === "message_queue" || domain === "birthday_messages") {
      throw new AppError(405, "BIRTHDAY_COMMAND_REQUIRED", "Use the birthday messaging command to queue messages");
    }
    if (domain === "reviews" || domain === "contacts") {
      return this.writeFeedback(domain, expectedVersion, data, actorId, requestId);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dart.finance_actor_id',$1,true),set_config('dart.finance_request_id',$2,true)", [actorId, requestId]);
      if (domain === "cards") {
        const policy = await client.query<{data: Record<string, unknown>}>(
          "SELECT data FROM site_settings WHERE id='main' FOR SHARE"
        );
        if (!isDartCardEnabled(policy.rows[0]?.data)) {
          throw new AppError(409, "DART_CARD_DISABLED", "Dart Card is paused; existing records are read-only.");
        }
      }
      const current = await client.query<{ version: string; data: unknown[] }>(
        "SELECT version::text, data FROM dashboard_domain_state WHERE domain=$1 FOR UPDATE",
        [domain],
      );
      const version = Number(current.rows[0]?.version || 1);
      if (version !== expectedVersion) {
        throw new AppError(409, "DOMAIN_VERSION_CONFLICT", `${domain} changed on another device; reload and retry`);
      }
      const previousData = isRelationalDashboardDomain(domain)
        ? await readRelationalDashboardDomain(client, domain) : current.rows[0]?.data || [];
      const id = (value: unknown): string => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "";
        const row = value as Record<string, unknown>;
        return String(row.id || row.returnId || row.cardId || row.damageId || row.code || JSON.stringify(row));
      };
      if (removeId !== undefined) {
        if (!["cards", "damage", "notifications", "returns"].includes(domain)) {
          throw new AppError(405, "DOMAIN_COMMAND_REQUIRED", "Use this record's account or workflow command");
        }
        if (!previousData.some(row => id(row) === removeId)) throw new AppError(404, "DOMAIN_RECORD_NOT_FOUND", "Record not found");
        data = previousData.filter(row => id(row) !== removeId);
        await client.query("SELECT set_config('dart.domain_remove_id',$1,true)", [removeId]);
      }
      const ids = data.map(id), incoming = new Set(ids);
      if (ids.some(key => !key) || incoming.size !== ids.length) {
        throw new AppError(422, "DOMAIN_RECORD_INVALID", "Records require unique identifiers");
      }
      if (previousData.some(row => !incoming.has(id(row)) && id(row) !== removeId)) {
        throw new AppError(409, "DOMAIN_SNAPSHOT_INCOMPLETE", "List is incomplete. Reload it; deletion requires a specific record command.");
      }
      if (domain === "returns") {
        const before = await client.query<{ payload: unknown }>("SELECT payload FROM return_requests ORDER BY position,record_id FOR UPDATE");
        data = protectReturnSnapshots(data, before.rows.map(row => row.payload));
      }
      const next = version + 1;
      const written = await client.query<{ data: unknown[] }>(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb, version=$3, updated_by=$4, updated_at=now()
          WHERE domain=$1 RETURNING data`,
        [domain, JSON.stringify(data), next, actorId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, old_values, new_values
         ) VALUES ('staff',$1,'DASHBOARD_DOMAIN_UPDATED','dashboard_domain_state',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
        [actorId, domain, requestId, JSON.stringify({ previousVersion: version, newVersion: next, count: data.length,
          ...(removeId === undefined ? {} : { removedRecordId: removeId }) }),
          JSON.stringify({ data: previousData }), JSON.stringify({ data })],
      );
      await client.query("COMMIT");
      return { domain, version: next, data: domain === "customers" && Array.isArray(written.rows[0]?.data) ? written.rows[0].data : data };
    } catch (error) {
      await client.query("ROLLBACK");
      customerRecordError(error);
    } finally {
      client.release();
    }
  }

  async removeFeedback(domain: "reviews" | "contacts", recordId: string, expectedVersion: number,
    actorId: string, requestId: string) {
    return this.writeFeedback(domain, expectedVersion, [], actorId, requestId, recordId);
  }

  private async writeFeedback(domain: "reviews" | "contacts", expectedVersion: number,
    data: unknown[], actorId: string, requestId: string, removeId?: string) {
    if (domain === "reviews" && data.some(isContact)) {
      throw new AppError(403, "FORBIDDEN", "Contact messages require contacts.manage");
    }
    if (domain === "contacts" && data.some((value) => !value || typeof value !== "object" || Array.isArray(value))) {
      throw new AppError(422, "INVALID_CONTACT", "Contact records must be objects");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<FeedbackRow>(
        `SELECT domain, version::text, data FROM dashboard_domain_state
          WHERE domain = ANY($1::text[]) ORDER BY domain FOR UPDATE`, [["reviews", "contacts"]],
      );
      const state = feedbackState(result.rows), previousVersion = state.versions[domain];
      if (previousVersion !== expectedVersion) {
        throw new AppError(409, "DOMAIN_VERSION_CONFLICT", `${domain} changed on another device; reload and retry`);
      }
      const previousData = domain === "reviews" ? state.reviews.data.filter(value => !isContact(value)) : contactProjection(state);
      const recordId = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
        ? (typeof (value as Record<string, unknown>).id === "string" ? String((value as Record<string, unknown>).id).trim() : "") : "";
      if (removeId !== undefined) {
        if (!previousData.some(value => recordId(value) === removeId)) {
          throw new AppError(404, "FEEDBACK_NOT_FOUND", "Feedback record not found");
        }
        data = previousData.filter(value => recordId(value) !== removeId);
      }
      const ids = data.map(recordId);
      if (ids.some(id => !id || id.length > 200) || new Set(ids).size !== ids.length) {
        throw new AppError(422, "FEEDBACK_RECORD_INVALID", "Feedback records require unique identifiers");
      }
      const incomingIds = new Set(ids);
      if (previousData.some(value => !incomingIds.has(recordId(value)) && recordId(value) !== removeId)) {
        throw new AppError(409, "FEEDBACK_SNAPSHOT_INCOMPLETE", "Feedback list is incomplete. Reload it; deletion requires a specific record command.");
      }
      const legacyContacts = state.reviews.data.filter(isContact);
      const reviewData = domain === "reviews" ? [...data, ...legacyContacts]
        : state.reviews.data.filter((value) => !isContact(value));
      const contactData = domain === "contacts" ? data.map((value) => ({
        ...(value as Record<string, unknown>), recordType: "contact", source: "Contact Us",
      })) : state.contacts.data;
      // Consolidation happens only inside a permitted contact save. Review
      // writes preserve all existing contact messages, even if omitted by UI.
      if (domain === "reviews" || legacyContacts.length) {
        await client.query(`UPDATE dashboard_domain_state SET data=$2::jsonb, version=version+1,
          updated_by=$3, updated_at=now() WHERE domain=$1`, ["reviews", JSON.stringify(reviewData), actorId]);
        state.versions.reviews += 1;
        state.versions.contacts += 1;
      }
      if (domain === "contacts") {
        await client.query(`UPDATE dashboard_domain_state SET data=$2::jsonb, version=version+1,
          updated_by=$3, updated_at=now() WHERE domain=$1`, ["contacts", JSON.stringify(contactData), actorId]);
        state.versions.contacts += 1;
      }
      await client.query(`INSERT INTO audit_logs (
        actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, old_values, new_values
      ) VALUES ('staff',$1,'DASHBOARD_DOMAIN_UPDATED','dashboard_domain_state',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [actorId, domain, requestId, JSON.stringify({ previousVersion, newVersion: state.versions[domain], count: data.length,
        ...(removeId !== undefined ? { removedRecordId: removeId } : {}) }),
        JSON.stringify({ data: previousData }), JSON.stringify({ data: domain === "contacts" ? contactData : data })]);
      await client.query("COMMIT");
      return { domain, version: state.versions[domain], data: domain === "contacts" ? contactData : data,
        relatedVersions: state.versions };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async audit(input: {
    limit?: number;
    entityType?: string;
    entityId?: string;
    allowedEntityTypes?: string[];
    allowedDomains?: string[];
  } = {}): Promise<Record<string, unknown>[]> {
    const limit = Math.min(1500, Math.max(1, Number(input.limit) || 500));
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (input.allowedEntityTypes) {
      values.push(input.allowedEntityTypes, input.allowedDomains || []);
      conditions.push(`(entity_type=ANY($${values.length - 1}::text[]) OR (entity_type='dashboard_domain_state' AND entity_id=ANY($${values.length}::text[])))`);
    }
    if (input.entityType) {
      values.push(input.entityType);
      conditions.push(`entity_type=$${values.length}`);
    }
    if (input.entityId) {
      values.push(input.entityId);
      conditions.push(`entity_id=$${values.length}`);
    }
    values.push(limit);
    const result = await this.pool.query<{
      id: string;
      actor_type: string;
      actor_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
      metadata: Record<string, unknown>;
      request_id: string | null;
      occurred_at: Date;
    }>(
      `SELECT id::text, actor_type, actor_id::text, action, entity_type, entity_id,
              old_values, new_values, metadata, request_id, occurred_at
         FROM audit_logs
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY occurred_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      timestamp: row.occurred_at.toISOString(),
      oldValues: row.old_values || {},
      newValues: row.new_values || {},
      actorRole: row.actor_type,
      actorId: row.actor_id,
      note: String(row.metadata?.note || row.metadata?.message || ""),
      metadata: row.metadata || {},
      requestId: row.request_id,
    }));
  }

  async publicReviews(): Promise<unknown[]> {
    const state = await this.read("reviews");
    return state.data.filter((raw) => {
      const review = raw as Record<string, unknown>;
      return String(review.status || "").toLowerCase() === "active"
        && !review.isArchived
        && !review.isDeleted;
    }).map((raw) => {
      const review = raw as Record<string, unknown>;
      return {
        id: review.id,
        name: review.clientName || "Dart Customer",
        date: review.date || review.createdAt || "",
        rating: Number(review.rating) || 0,
        title: review.title || "",
        comment: review.review || review.comment || "",
      };
    });
  }

  private async mergeRegisteredCustomers(stored: unknown[]): Promise<unknown[]> {
    const legacy = new Map<string, Record<string, unknown>>();
    for (const raw of stored) {
      const row = raw as Record<string, unknown>;
      const key = String(row.clientId || row.client_code || "").trim();
      if (key) legacy.set(key, row);
    }

    const result = await this.pool.query<{
      user_id: string;
      client_code: string;
      full_name: string;
      birthday: string | null;
      dart_card_draw_eligible: boolean;
      email: string;
      status: string;
      deleted_at: Date | null;
      created_at: Date;
      phones: Array<{ phone_display: string; is_primary: boolean }>;
      contacts: string[]; address_governorate: string; address_country: string; aliases: string[];
      addresses: Record<string, unknown>[];
    }>(
      `SELECT c.user_id::text, c.client_code, c.full_name, c.birthday::text,
              c.dart_card_draw_eligible, u.email, u.status, u.deleted_at, c.created_at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'phone_display', p.phone_display,
                    'is_primary', p.is_primary
                  ) ORDER BY p.is_primary DESC, p.created_at
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::jsonb
              ) AS phones,
              ARRAY(SELECT cp.phone_display FROM customer_contact_phones cp WHERE cp.customer_user_id=c.user_id
                AND NOT EXISTS(SELECT 1 FROM account_phones ap WHERE ap.user_id=c.user_id AND ap.phone_normalized=cp.phone_normalized)
                ORDER BY cp.recorded_at DESC,cp.phone_normalized) AS contacts,
              COALESCE(NULLIF(d.governorate,''),NULLIF(pref.last_address->>'governorate',''),
                (SELECT address->>'governorate' FROM customer_address_history h WHERE h.customer_user_id=c.user_id
                 AND NULLIF(address->>'governorate','') IS NOT NULL ORDER BY recorded_at DESC,source_key DESC LIMIT 1),'') AS address_governorate,
              COALESCE(d.country,'Egypt') AS address_country,
              ARRAY(SELECT alias FROM customer_identity_aliases a WHERE a.customer_user_id=c.user_id) AS aliases,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('address',address,'source',source_key,'date',recorded_at)
                ORDER BY recorded_at DESC,source_key) FROM customer_address_history h WHERE h.customer_user_id=c.user_id),'[]') AS addresses
         FROM customers c
         JOIN users u ON u.id=c.user_id
         LEFT JOIN customer_profile_details d ON d.customer_user_id=c.user_id
         LEFT JOIN customer_preferences pref ON pref.customer_user_id=c.user_id
         LEFT JOIN account_phones p ON p.user_id=c.user_id AND p.account_type='customer'
        GROUP BY c.user_id, c.client_code, c.full_name, c.birthday,
                 c.dart_card_draw_eligible, u.email, u.status, u.deleted_at, c.created_at, d.customer_user_id,pref.customer_user_id
        ORDER BY c.created_at DESC`,
    );

    const merged: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      seen.add(row.client_code);
      if (row.deleted_at) continue;
      const previous = legacy.get(row.client_code) || {};
      const phones = Array.isArray(row.phones) ? row.phones : [];
      const primary = phones.find((phone) => phone.is_primary)?.phone_display || phones[0]?.phone_display || "";
      const secondary = row.contacts?.[0] || "-";
      merged.push({
        ...previous,
        id: row.user_id,
        clientId: row.client_code,
        clientName: row.full_name,
        birthday: row.birthday || "-",
        email: row.email,
        phone1: primary,
        phone2: secondary,
        contactPhones: row.contacts || [],
        aliases: row.aliases || [],
        addresses: row.addresses || [],
        accountStatus: row.status,
        dartCardDrawEligible: row.dart_card_draw_eligible,
        registeredAt: row.created_at.toISOString(),
        serverAuthoritative: true,
        country: String(row.address_country || previous.country || "Egypt"),
        governorate: String(row.address_governorate || previous.governorate || ""),
        isArchived: row.status === "suspended" || Boolean(previous.isArchived),
        isDeleted: false,
        isChecked: false,
      });
    }

    for (const [clientId, row] of legacy) {
      if (!seen.has(clientId)) merged.push(row);
    }
    return merged;
  }


  private async mergeRegisteredRepresentatives(stored: unknown[]): Promise<unknown[]> {
    const legacy = new Map<string, Record<string, unknown>>();
    for (const raw of stored) {
      const row = raw as Record<string, unknown>;
      const key = String(row.repId || row.representative_code || "").trim();
      if (key) legacy.set(key, row);
    }

    const result = await this.pool.query<{
      user_id: string;
      representative_code: string;
      full_name: string;
      national_id_last4: string;
      address_text: string;
      approval_status: string;
      rejection_reason: string | null;
      email: string;
      user_status: string;
      deleted_at: Date | null;
      created_at: Date;
      phones: Array<{ phone_display: string; is_primary: boolean }>;
    }>(
      `SELECT r.user_id::text, r.representative_code, r.full_name,
              r.national_id_last4, r.address_text, r.approval_status,
              r.rejection_reason, u.email, u.status AS user_status, u.deleted_at, r.created_at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'phone_display', p.phone_display,
                    'is_primary', p.is_primary
                  ) ORDER BY p.is_primary DESC, p.created_at
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::jsonb
              ) AS phones
         FROM representatives r
         JOIN users u ON u.id=r.user_id
         LEFT JOIN account_phones p
           ON p.user_id=r.user_id AND p.account_type='representative'
        GROUP BY r.user_id, r.representative_code, r.full_name,
                 r.national_id_last4, r.address_text, r.approval_status,
                 r.rejection_reason, u.email, u.status, u.deleted_at, r.created_at
        ORDER BY r.created_at DESC`,
    );

    const merged: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      seen.add(row.representative_code);
      if (row.deleted_at) continue;
      const previous = legacy.get(row.representative_code) || {};
      const phones = Array.isArray(row.phones) ? row.phones : [];
      const primary =
        phones.find((phone) => phone.is_primary)?.phone_display ||
        phones[0]?.phone_display ||
        "";
      const secondary =
        phones.find((phone) => !phone.is_primary)?.phone_display || "-";
      const status =
        row.approval_status === "approved"
          ? "Active"
          : row.approval_status === "pending"
            ? "Pending Approval"
            : row.approval_status === "rejected"
              ? "Rejected"
              : "Suspended";
      merged.push({
        ...previous,
        id: row.user_id,
        repId: row.representative_code,
        name: row.full_name,
        email: row.email,
        phone1: primary,
        phone2: secondary,
        address: row.address_text,
        nationalIdLast4: row.national_id_last4,
        approvalStatus: row.approval_status,
        accountStatus: row.user_status,
        rejectionReason: row.rejection_reason || "",
        status,
        createdAt: row.created_at.toISOString(),
        serverAuthoritative: true,
        isArchived:
          row.user_status === "suspended" ||
          row.approval_status === "suspended" ||
          Boolean(previous.isArchived),
        isDeleted: false,
        isChecked: false,
      });
    }

    for (const [repId, row] of legacy) {
      if (!seen.has(repId)) merged.push(row);
    }
    return merged;
  }

}
