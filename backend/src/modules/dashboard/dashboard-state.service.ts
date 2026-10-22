// DART CODE GUIDE | backend/src/modules/dashboard/dashboard-state.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
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
  ): Promise<{ domain: DashboardDomain; version: number; data: unknown[]; relatedVersions?: Record<string, number> }> {
    if (domain === "message_queue" || domain === "birthday_messages") {
      throw new AppError(405, "BIRTHDAY_COMMAND_REQUIRED", "Use the birthday messaging command to queue messages");
    }
    if (domain === "reviews" || domain === "contacts") {
      return this.writeFeedback(domain, expectedVersion, data, actorId, requestId);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ version: string }>(
        "SELECT version::text FROM dashboard_domain_state WHERE domain=$1 FOR UPDATE",
        [domain],
      );
      const version = Number(current.rows[0]?.version || 1);
      if (version !== expectedVersion) {
        throw new AppError(409, "DOMAIN_VERSION_CONFLICT", `${domain} changed on another device; reload and retry`);
      }
      if (domain === "returns") {
        const before = await client.query<{ payload: unknown }>("SELECT payload FROM return_requests ORDER BY position,record_id FOR UPDATE");
        data = protectReturnSnapshots(data, before.rows.map(row => row.payload));
      }
      const next = version + 1;
      await client.query(
        `UPDATE dashboard_domain_state
            SET data=$2::jsonb, version=$3, updated_by=$4, updated_at=now()
          WHERE domain=$1`,
        [domain, JSON.stringify(data), next, actorId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'DASHBOARD_DOMAIN_UPDATED','dashboard_domain_state',$2,$3,$4::jsonb)`,
        [actorId, domain, requestId, JSON.stringify({ previousVersion: version, newVersion: next, count: data.length })],
      );
      await client.query("COMMIT");
      return { domain, version: next, data };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeFeedback(domain: "reviews" | "contacts", expectedVersion: number,
    data: unknown[], actorId: string, requestId: string) {
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
        actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
      ) VALUES ('staff',$1,'DASHBOARD_DOMAIN_UPDATED','dashboard_domain_state',$2,$3,$4::jsonb)`,
      [actorId, domain, requestId, JSON.stringify({ previousVersion, newVersion: state.versions[domain], count: data.length })]);
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
  } = {}): Promise<Record<string, unknown>[]> {
    const limit = Math.min(1500, Math.max(1, Number(input.limit) || 500));
    const values: unknown[] = [];
    const conditions: string[] = [];
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
              ) AS phones
         FROM customers c
         JOIN users u ON u.id=c.user_id
         LEFT JOIN account_phones p ON p.user_id=c.user_id AND p.account_type='customer'
        GROUP BY c.user_id, c.client_code, c.full_name, c.birthday,
                 c.dart_card_draw_eligible, u.email, u.status, u.deleted_at, c.created_at
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
      const secondary = phones.find((phone) => !phone.is_primary)?.phone_display || "-";
      merged.push({
        ...previous,
        id: row.user_id,
        clientId: row.client_code,
        clientName: row.full_name,
        birthday: row.birthday || "-",
        email: row.email,
        phone1: primary,
        phone2: secondary,
        accountStatus: row.status,
        dartCardDrawEligible: row.dart_card_draw_eligible,
        registeredAt: row.created_at.toISOString(),
        serverAuthoritative: true,
        country: String(previous.country || "Egypt"),
        governorate: String(previous.governorate || ""),
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
