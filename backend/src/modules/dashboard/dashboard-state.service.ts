import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export const DASHBOARD_DOMAINS = [
  "customers","returns","reviews","cards","representatives","damage",
  "notifications","contacts","finance_expenses","finance_budgets",
  "finance_invoices","finance_goals","finance_marketing","finance_settlements",
] as const;

export type DashboardDomain = typeof DASHBOARD_DOMAINS[number];

export class DashboardStateService {
  constructor(private readonly pool: Pool) {}

  async read(domain: DashboardDomain): Promise<{ domain: DashboardDomain; version: number; data: unknown[] }> {
    const result = await this.pool.query<{ version: string; data: unknown[] }>(
      "SELECT version::text, data FROM dashboard_domain_state WHERE domain=$1",
      [domain],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "DOMAIN_NOT_FOUND", "Dashboard domain not found");
    return { domain, version: Number(row.version || 1), data: Array.isArray(row.data) ? row.data : [] };
  }

  async write(
    domain: DashboardDomain,
    expectedVersion: number,
    data: unknown[],
    actorId: string,
    requestId: string,
  ): Promise<{ domain: DashboardDomain; version: number; data: unknown[] }> {
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
}
