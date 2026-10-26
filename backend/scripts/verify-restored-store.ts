import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { verifyRecoveredStore } from "../src/modules/monitoring/store-recovery-check.js";

const connectionString = process.env.DART_RECOVERY_DATABASE_URL;
if (!connectionString) throw new Error("A local isolated recovery database is required");
const target = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/(?:recovery|restore|drill|test)/i.test(target.pathname)) {
  throw new Error("Only a local isolated recovery database is permitted");
}
// Enforced on every pooled connection, including application service reads.
const pool = new Pool({ connectionString, max: 2, options: "-c default_transaction_read_only=on -c statement_timeout=60000" });
try {
  const migrations = readdirSync(resolve(process.cwd(), "migrations")).filter((file) => /^\d+.*\.sql$/.test(file));
  console.log(JSON.stringify({ recoveryApplicationAcceptance: await verifyRecoveredStore(pool, migrations) }));
} finally { await pool.end(); }
