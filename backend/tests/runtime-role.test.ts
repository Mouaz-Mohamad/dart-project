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
      // Production regression: the four passwordless auth tables are readable
      // only through the restricted app runtime role, not through anonymous SQL.
      for (const table of [
        "customer_email_otp_challenges",
        "customer_verified_sessions",
        "customer_passkey_credentials",
        "customer_passkey_challenges",
      ]) {
        const policy = await store.pool.query<{ enabled: boolean }>(
          `SELECT EXISTS(
            SELECT 1 FROM pg_policies
            WHERE schemaname='public' AND tablename=$1
              AND policyname='dart_customer_auth_runtime'
              AND qual LIKE '%dart_app_runtime%'
          ) AS enabled`,[table],
        );
        expect(policy.rows[0]?.enabled, table + " must have runtime RLS").toBe(true);
        await expect(store.pool.query(`SELECT count(*)::int n FROM ${table}`))
          .resolves.toBeDefined();
      }
      const syntheticId = "123e4567-e89b-42d3-a456-426614174022";
      await store.pool.query(
        `INSERT INTO customer_email_otp_challenges
          (id,purpose,email,email_normalized,signup_data,code_hash,expires_at)
         VALUES ($1,'register','rls-test@example.invalid','rls-test@example.invalid',
                 '{"name":"RLS fixture","phone1":"01000000000","birthday":"2000-01-01"}'::jsonb,
                 repeat('0',64),now()+interval '1 minute')`,
        [syntheticId],
      );
      expect((await store.pool.query(
        "SELECT count(*)::int n FROM customer_email_otp_challenges WHERE id=$1",
        [syntheticId],
      )).rows[0].n).toBe(1);
      await store.pool.query("DELETE FROM customer_email_otp_challenges WHERE id=$1",[syntheticId]);
      await store.pool.query(
        `INSERT INTO customer_passkey_challenges
          (id,action,challenge,rp_id,expected_origin,expires_at)
         VALUES ($1,'authenticate','synthetic','dartofficial.com','https://www.dartofficial.com',
                 now()+interval '1 minute')`,[syntheticId],
      );
      await store.pool.query("DELETE FROM customer_passkey_challenges WHERE id=$1",[syntheticId]);
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
