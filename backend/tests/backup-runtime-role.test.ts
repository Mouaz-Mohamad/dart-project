// DART CODE GUIDE | backend/tests/backup-runtime-role.test.ts
// Execute the restore workflow's role provisioning with synthetic local PostgreSQL.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("backup RLS role compatibility",()=>{
  it("accepts a previous storefront SHA only when compared files cannot affect the storefront",async()=>{
    const workflow=await readFile(new URL("../../.github/workflows/lighthouse-production.yml",import.meta.url),"utf8");
    const body=/function storefrontChanged\(files\) \{([\s\S]*?)\n          \}/.exec(workflow)?.[1];
    expect(body).toBeTruthy();
    const changed=new Function("files",body!) as (files:unknown)=>boolean;
    expect(changed([{filename:"backend/src/server.ts"},{filename:".github/workflows/database-backup.yml"}])).toBe(false);
    expect(changed([{filename:"index.html"}])).toBe(true);
    expect(changed([{filename:"backend/server.ts"},{filename:"src/dashboard/core/shared-state.js"}])).toBe(true);
    expect(changed([{filename:"docs/index.html",previous_filename:"index.html"}])).toBe(true);
    expect(changed([{}])).toBe(true);
    expect(changed(null)).toBe(true);
    expect(changed(Array.from({length:300},()=>({filename:"docs/readme.md"})))).toBe(true);
  });
  it("creates the policy role idempotently without login or administrative privileges",async()=>{
    const workflow=await readFile(new URL("../../.github/workflows/database-backup.yml",import.meta.url),"utf8");
    const sql=/await recovery\.query\(`([\s\S]+?)`\)/.exec(workflow)?.[1];
    expect(sql).toBeTruthy();
    expect(workflow.indexOf("assertRecoveryDatabaseSafety(process.env")).toBeLessThan(workflow.indexOf("await recovery.connect()"));
    const db=new PGlite();
    try {
      await db.exec(sql!);await db.exec(sql!);
      const roles=await db.query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='dart_app_runtime'");
      expect(roles.rows).toEqual([{rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false}]);
      await db.exec("CREATE TABLE restore_fixture(id int);ALTER TABLE restore_fixture ENABLE ROW LEVEL SECURITY;CREATE POLICY restored_policy ON restore_fixture TO dart_app_runtime USING(true)");
    }finally{await db.close();}
  },15000);
});
