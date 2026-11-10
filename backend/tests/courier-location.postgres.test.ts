import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { CommerceService } from "../src/modules/commerce/commerce.service.js";

describe("courier GPS persistence and trip authorization", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: CommerceService;
  const rep = randomUUID(), unassigned = randomUUID(), staff = randomUUID();
  beforeAll(async () => {
    // Embedded locally, or the named loopback test database supplied by CI; never a production URL.
    if (process.env.TEST_DATABASE_URL) {
      const target = new URL(process.env.TEST_DATABASE_URL);
      if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/test/i.test(target.pathname)) {
        throw new Error("This GPS regression requires an isolated local test database");
      }
    }
    store = await embeddedStore(true); service = new CommerceService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff',$2,$2,'synthetic','active',now())`, [staff, `${staff}@example.test`]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic approver')", [staff]);
    for (const id of [rep, unassigned]) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,'representative',$2,$2,'synthetic','active',now())`, [id, `${id}@example.test`]);
      await store.pool.query(`INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4,approval_status,approved_by,approved_at)
        VALUES($1,'Synthetic Courier',$2,'0000','approved',$3,now())`, [id, id.replaceAll("-", "").repeat(2), staff]);
    }
    await store.pool.query(`INSERT INTO return_requests(record_id,payload) VALUES('synthetic-pickup',$1::jsonb)`,
      [JSON.stringify({id:"synthetic-pickup",representativeId:rep,status:"Pickup On The Way"})]);
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  it("accepts an assigned pickup without reading all return payloads, and rejects an unassigned account", async () => {
    const response = await service.updateRepresentativeLocation(rep, 30.04, 31.25, 5, new Date(Date.now()-10_000).toISOString());
    expect(response.accepted).toBe(true);
    await expect(service.updateRepresentativeLocation(unassigned, 30, 31, 5)).rejects.toMatchObject({code:"NO_ACTIVE_TRIP"});
  });
  it("keeps a newer fix when an older request arrives later, and avoids duplicate writes", async () => {
    const latest = new Date(Date.now()-1000).toISOString();
    expect((await service.updateRepresentativeLocation(rep, 30.06, 31.26, 8, latest)).accepted).toBe(true);
    expect((await service.updateRepresentativeLocation(rep, 30.01, 31.21, 8, new Date(Date.now()-5000).toISOString())).accepted).toBe(false);
    expect((await service.updateRepresentativeLocation(rep, 30.06, 31.26, 8, latest)).accepted).toBe(false);
    expect((await service.updateRepresentativeLocation(rep, 30.07, 31.27, 8, new Date(Date.parse(latest)+2000).toISOString())).accepted).toBe(false);
    const row = (await store.pool.query("SELECT latitude,longitude,updated_at FROM representative_locations WHERE representative_user_id=$1", [rep])).rows[0];
    expect(row.latitude).toBe(30.06); expect(new Date(row.updated_at).toISOString()).toBe(latest);
  });
  it("rejects expired and future-dated GPS samples before persistence", async () => {
    for (const offset of [-121_000, 31_000]) {
      await expect(service.updateRepresentativeLocation(rep, 30, 31, 5, new Date(Date.now()+offset).toISOString()))
        .rejects.toMatchObject({code:"LOCATION_SAMPLE_STALE"});
    }
  });
  it("does not authorize an archived or deleted return", async () => {
    await store.pool.query("UPDATE return_requests SET payload=payload || '{\"isArchived\":true}'::jsonb WHERE record_id='synthetic-pickup'");
    await expect(service.updateRepresentativeLocation(rep, 30, 31, 5)).rejects.toMatchObject({code:"NO_ACTIVE_TRIP"});
  });
});
