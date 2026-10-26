// Read-only application acceptance after restoring an encrypted backup.
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { CommerceService } from "../commerce/commerce.service.js";
import { FinanceService } from "../finance/finance.service.js";

export async function verifyRecoveredStore(pool: Pool, expectedMigrations: string[]) {
  const migrations = await pool.query<{ name: string }>("SELECT name FROM dart_schema_migrations ORDER BY name");
  assert.deepEqual(migrations.rows.map((row) => row.name), [...expectedMigrations].sort(), "Restored schema is not current");
  const invariants = (await pool.query<{ line_mismatches: number; deleted_active: number; refund_mismatches: number }>(`
    SELECT
      (SELECT count(*)::int FROM orders o JOIN (
        SELECT order_id,sum(final_unit_minor) AS total FROM order_items GROUP BY order_id
      ) lines ON lines.order_id=o.id WHERE lines.total<>o.final_minor) AS line_mismatches,
      (SELECT count(*)::int FROM users WHERE status='active' AND deleted_at IS NOT NULL) AS deleted_active,
      (SELECT count(*)::int FROM orders o JOIN (
        SELECT order_code,sum(round((payload->>'refundAmount')::numeric*100)) AS refunded
        FROM return_requests WHERE lower(request_type) IN ('refund','return')
          AND payload->>'isPostDeliveryReturn'='true'
          AND (COALESCE(payload->>'completedAt','')<>'' OR lower(status) IN ('completed','good','damaged','bad'))
          AND COALESCE(payload->>'refundAmount','0') ~ '^[0-9]+([.][0-9]+)?$' GROUP BY order_code
      ) refunds ON refunds.order_code=o.order_code WHERE refunds.refunded>o.amount_refunded_minor) AS refund_mismatches
  `)).rows[0]!;
  assert.equal(invariants.line_mismatches, 0, "Restored order totals differ from their lines");
  assert.equal(invariants.deleted_active, 0, "Restored deleted identities are active");
  assert.equal(invariants.refund_mismatches, 0, "Restored orders lost completed refunds");
  const commerce = new CommerceService(pool), version = await commerce.adminOrdersVersion();
  const order = (await pool.query<{ id: string }>("SELECT id::text FROM orders WHERE NOT is_deleted ORDER BY created_at LIMIT 1")).rows[0];
  if (order) {
    const view = await commerce.adminOrders({ orderIds: [order.id], customerIds: [], expectedVersion: version });
    assert.ok(view.orders.some((row) => String(row.id) === order.id), "Application cannot read a restored order");
  }
  const customer = (await pool.query<{ user_id: string }>("SELECT c.user_id::text FROM customers c JOIN users u ON u.id=c.user_id WHERE u.status='active' AND u.deleted_at IS NULL ORDER BY c.created_at LIMIT 1")).rows[0];
  if (customer) await commerce.customerSnapshot(customer.user_id);
  const finance = await new FinanceService(pool).summary("2000-01-01", "2099-12-31");
  for (const [key, value] of Object.entries(finance)) if (typeof value === "number") assert.ok(Number.isFinite(value), `Invalid restored finance metric: ${key}`);
  // Never return identities, addresses, amounts, tokens or outbox payloads.
  return { migrations: migrations.rows.length, invariants, orderProjection: order ? "passed" : "empty",
    customerProjection: customer ? "passed" : "empty", financeProjection: "passed" };
}
