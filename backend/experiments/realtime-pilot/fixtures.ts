import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { CommerceService } from "../../src/modules/commerce/commerce.service.js";
export async function installPilotFixture(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dart.realtime_pilot_fixture','enabled',true)");
    await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function createPilotCheckout(pool: Pool) {
  const commerce = new CommerceService(pool), user = randomUUID(), suffix = randomUUID().slice(0, 10);
  const email = `${user}@example.test`, model = `PILOT-${suffix}`, piece = `PILOT-I-${suffix}`, reservation = `CART-PILOT-${suffix}`;
  await pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
    VALUES($1,'customer',$2,$2,'synthetic','active',now())`, [user, email]);
  await pool.query("INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic pilot customer','2000-01-15')", [user]);
  await pool.query(`INSERT INTO catalog_models(model_id,name,cost_minor,selling_minor,size_options,color_options)
    VALUES($1,'Pilot model',40000,60000,'[{"name":"M","active":true}]','[{"name":"Black","active":true}]')`, [model]);
  await pool.query(`INSERT INTO inventory_items(id,item_code,model_id,color,size,status,cost_snapshot_minor)
    VALUES($1,$1,$2,'Black','M','In stock',40000)`, [piece, model]);
  await commerce.reserveCart(reservation, [{ modelId: model, color: "Black", size: "M", quantity: 1 }], user);
  const input = { reservationId: reservation, contact: { name: "Synthetic pilot customer", phone1: "+201000000001", email },
    address: { country: "Egypt", governorate: "Cairo", area: "Synthetic", street: "Synthetic street", building: "1", floor: "1", latitude: "30.05", longitude: "31.35", addressSource: "map" } };
  return { commerce, user, input, checkout: () => commerce.checkout(user, input, "pilot", undefined, `checkout-${reservation}`) };
}
