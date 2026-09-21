import type { Pool, PoolClient } from "pg";

export const RELATIONAL_DASHBOARD_DOMAINS = [
  "returns","damage","promotions","cards","birthday_rewards","notifications",
  "birthday_messages","message_queue",
  "finance_expenses","finance_budgets","finance_invoices","finance_goals",
  "finance_marketing","finance_settlements","finance_audit",
] as const;

export type RelationalDashboardDomain =
  (typeof RELATIONAL_DASHBOARD_DOMAINS)[number];

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const SIMPLE_TABLES: Partial<Record<RelationalDashboardDomain,string>> = {
  returns: "return_requests",
  damage: "damage_records",
  promotions: "promotion_records",
  cards: "loyalty_cards",
  birthday_rewards: "birthday_rewards",
  notifications: "notification_records",
};

export function isRelationalDashboardDomain(
  domain: string,
): domain is RelationalDashboardDomain {
  return (RELATIONAL_DASHBOARD_DOMAINS as readonly string[]).includes(domain);
}

export async function readRelationalDashboardDomain(
  db: Queryable,
  domain: RelationalDashboardDomain,
): Promise<unknown[]> {
  const simple = SIMPLE_TABLES[domain];
  if (simple) {
    const result = await db.query<{ payload: unknown }>(
      `SELECT payload FROM ${simple} ORDER BY position, record_id`,
    );
    return result.rows.map((row) => row.payload);
  }

  if (domain === "birthday_messages" || domain === "message_queue") {
    const result = await db.query<{ payload: unknown }>(
      "SELECT payload FROM message_records WHERE domain=$1 ORDER BY position, record_id",
      [domain],
    );
    return result.rows.map((row) => row.payload);
  }

  const result = await db.query<{ payload: unknown }>(
    "SELECT payload FROM finance_records WHERE domain=$1 ORDER BY position, record_id",
    [domain],
  );
  return result.rows.map((row) => row.payload);
}
