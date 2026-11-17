// Read-only production integrity guard. No personal data, identifiers or amounts are logged.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CRITICAL_CHECKS = Object.freeze([
  "order_total_mismatches",
  "orders_without_items",
  "active_deleted_users",
  "reserved_without_cart",
  "received_gift_not_paid",
  "pending_gift_already_paid",
]);

export const INTEGRITY_SQL = `
SELECT
  (SELECT count(*) FROM orders o JOIN (
    SELECT order_id, sum(final_unit_minor) AS total FROM order_items GROUP BY order_id
  ) lines ON lines.order_id=o.id
   WHERE lines.total + o.shipping_fee_minor <> o.final_minor) AS order_total_mismatches,
  (SELECT count(*) FROM orders o WHERE NOT o.is_deleted
   AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)) AS orders_without_items,
  (SELECT count(*) FROM users WHERE status='active' AND deleted_at IS NOT NULL) AS active_deleted_users,
  (SELECT count(*) FROM inventory_items i WHERE lower(i.status)='cart reserved'
   AND (i.cart_reservation_id IS NULL OR NOT EXISTS (
     SELECT 1 FROM cart_reservations r WHERE r.id=i.cart_reservation_id
   ))) AS reserved_without_cart,
  (SELECT count(*) FROM finance_income_entries i JOIN orders o ON o.id=i.order_id
   WHERE i.status='Received' AND o.amount_paid_minor=0
     AND NOT o.is_deleted AND NOT o.is_archived) AS received_gift_not_paid,
  (SELECT count(*) FROM finance_income_entries i JOIN orders o ON o.id=i.order_id
   WHERE i.status='Pending' AND o.amount_paid_minor>0
     AND NOT o.is_deleted AND NOT o.is_archived) AS pending_gift_already_paid,
  (SELECT count(*) FROM inventory_items i WHERE lower(i.status)='cart reserved'
   AND i.reservation_until<now()) AS expired_cart_holds
`;

export function evaluateIntegrity(row) {
  const names = [...CRITICAL_CHECKS, "expired_cart_holds"];
  const counts = {};
  for (const name of names) {
    const value = Number(row?.[name]);
    if (!Number.isSafeInteger(value) || value < 0 || row?.[name] == null) {
      throw new Error("Invalid integrity aggregate");
    }
    counts[name] = value;
  }
  const critical = CRITICAL_CHECKS.filter((name) => counts[name] > 0);
  return {
    status: critical.length ? "critical" : counts.expired_cart_holds ? "warning" : "ok",
    checks: counts,
    critical,
  };
}

export async function readIntegrityReport(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await client.query(INTEGRITY_SQL);
    if (result.rows.length !== 1) throw new Error("Integrity aggregate missing");
    const report = evaluateIntegrity(result.rows[0]);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing read-only database connection");
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    options: "-c default_transaction_read_only=on -c statement_timeout=30000",
  });
  try {
    const client = await pool.connect();
    try {
      const report = await readIntegrityReport(client);
      console.log(JSON.stringify({ integrity: report }));
      if (report.status === "critical") process.exitCode = 1;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Database errors sometimes embed connection metadata. Never print raw errors.
    console.error("DART_INTEGRITY_CHECK_UNAVAILABLE");
    process.exitCode = 2;
  });
}
