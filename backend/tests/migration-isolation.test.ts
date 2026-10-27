import { expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";

it("validates and executes dependent SQL functions inside an isolated migration schema", async () => {
  const store = await embeddedStore(true);
  try {
    const schema = (await store.pool.query("SELECT current_schema() AS schema")).rows[0].schema as string;
    expect(schema).toMatch(/^dart_/); expect(schema).not.toBe("public");
    const row = (await store.pool.query(`SELECT dart_order_reward_benefits(gen_random_uuid(),'{"type":"Birthday","rewardId":"synthetic"}'::jsonb) AS benefits`)).rows[0];
    expect((await store.pool.query("SELECT 1 AS value")).rowCount).toBe(1);
    expect(row.benefits).toEqual([{ type: "Birthday", rewardId: "synthetic" }]);
    expect((await store.pool.query("SELECT current_setting('check_function_bodies') AS enabled")).rows[0].enabled).toBe("on");
    expect((await store.pool.query("SELECT count(*)::int AS n FROM dart_schema_migrations")).rows[0].n).toBe(65);
  } finally { await store.db.close(); }
}, 30000);
