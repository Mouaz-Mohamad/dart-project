// DART CODE GUIDE | backend/tests/runtime-role.test.ts
// Exercise RLS and DML grants without bypass privileges.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";

describe.skipIf(Boolean(process.env.TEST_DATABASE_URL))("restricted runtime role", () => {
  it("can use business rows but cannot alter schema, migrations or old audit",async()=>{
    const store=await embeddedStore();
    try {
      await store.pool.query("CREATE ROLE dart_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS");
      await store.pool.query(await readFile("scripts/provision-runtime-grants.sql","utf8"));
      await store.pool.query("SET ROLE dart_app_runtime");
      expect((await store.pool.query("SELECT count(*)::int n FROM dashboard_domain_state")).rows[0].n).toBeGreaterThan(0);
      expect((await store.pool.query(`UPDATE dashboard_domain_state SET data='[{"id":"ROLE-EXP","amount":1}]',version=version+1 WHERE domain='finance_expenses' RETURNING version`)).rows).toHaveLength(1);
      expect((await store.pool.query("SELECT count(*)::int n FROM finance_records WHERE domain='finance_audit'")).rows[0].n).toBe(1);
      await expect(store.pool.query("UPDATE audit_logs SET action='forged'")).rejects.toThrow(/permission denied/i);
      await expect(store.pool.query("DELETE FROM dart_schema_migrations")).rejects.toThrow(/permission denied/i);
      await expect(store.pool.query("ALTER TABLE customers ADD COLUMN forbidden text")).rejects.toThrow(/owner|permission/i);
      await expect(store.pool.query("ALTER ROLE dart_app_runtime BYPASSRLS")).rejects.toThrow(/permission|superuser/i);
    } finally { await store.db.close(); }
  },30000);
});
