import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { installPilotFixture } from "../realtime-pilot/fixtures.js";

export async function installDirectFixture(pool: Pool) {
  await installPilotFixture(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dart.realtime_pilot_fixture','enabled',true)");
    await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
    const result = await client.query<{ channel: string }>("SELECT 'dart_pilot_orders_' || md5(current_schema()) AS channel");
    await client.query("COMMIT");
    return result.rows[0]!.channel;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
