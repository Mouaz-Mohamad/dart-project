import type { PoolClient } from "pg";

// 0085 historically rewrote empty version envelopes as if they were source
// collections. Suspend only that adapter trigger inside the migration's locked
// transaction. Row tables remain authoritative; 0088 canonicalizes their aliases.
export async function protectRelationalMigration(client: Pick<PoolClient, "query">, name: string, enabled: boolean): Promise<void> {
  if (name !== "0085_unified_customer_records.sql") return;
  await client.query(`ALTER TABLE dashboard_domain_state ${enabled ? "DISABLE" : "ENABLE"} TRIGGER dashboard_domain_relational_sync`);
}
