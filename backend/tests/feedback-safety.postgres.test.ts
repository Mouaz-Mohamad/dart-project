import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { DashboardStateService } from "../src/modules/dashboard/dashboard-state.service.js";

describe("feedback data-loss protection", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, state: DashboardStateService;
  const actor = randomUUID();
  const first = { id:"review-one",recordType:"review",clientName:"Synthetic Customer",status:"Active",review:"Original text",rating:5 };
  const second = { id:"review-two",recordType:"review",status:"Hidden",review:"Second original text",rating:4 };
  const contact = { id:"contact-one",recordType:"contact",source:"Contact Us",review:"Private message" };
  beforeAll(async () => {
    store=await embeddedStore(); state=new DashboardStateService(store.pool);
    await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
      VALUES($1,'staff','feedback-test@example.test','feedback-test@example.test','synthetic','active',now())`,[actor]);
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Feedback test')",[actor]);
  },30000);
  beforeEach(async () => {
    await store.pool.query("UPDATE dashboard_domain_state SET data=$2::jsonb,version=50 WHERE domain=$1",["reviews",JSON.stringify([first,second,contact])]);
    await store.pool.query("UPDATE dashboard_domain_state SET data='[]',version=1 WHERE domain='contacts'");
  });
  afterAll(async () => { await store?.db.close(); });
  it("rejects empty and partial arrays, preserving every review and legacy contact",async () => {
    for(const incoming of [[],[first]]) {
      await expect(state.write("reviews",50,incoming,actor,"incomplete")).rejects.toMatchObject({code:"FEEDBACK_SNAPSHOT_INCOMPLETE"});
      expect((await state.read("reviews")).data).toEqual([first,second]);
      expect((await state.read("contacts")).data).toEqual([contact]);
    }
  });
  it("rejects missing, duplicate and invalid identifiers without a write",async () => {
    for(const invalid of [[first,second,first],[first,second,{}],[first,second,null]]) {
      await expect(state.write("reviews",50,invalid,actor,"invalid")).rejects.toMatchObject({code:"FEEDBACK_RECORD_INVALID"});
    }
    expect((await state.read("reviews")).version).toBe(50);
  });
  it("keeps visibility, archive, edit and create controls, and records complete before/after snapshots",async () => {
    const changed={...first,status:"Hidden",isArchived:true}, added={id:"new-review",status:"Pending",review:"New genuine feedback"};
    const result=await state.write("reviews",50,[changed,second,added],actor,"feedback-edited");
    expect(result.data).toEqual([changed,second,added]);
    expect((await state.read("contacts")).data).toEqual([contact]);
    const audit=(await store.pool.query("SELECT old_values,new_values FROM audit_logs WHERE request_id='feedback-edited'")).rows[0]!;
    expect(audit.old_values.data).toEqual([first,second]);
    expect(audit.new_values.data).toEqual([changed,second,added]);
    expect(await state.publicReviews()).toEqual([]);
  });
  it("deletes exactly one explicitly selected review and retains its original content in the audit",async () => {
    expect((await state.removeFeedback("reviews",first.id,50,actor,"explicit-review-delete")).data).toEqual([second]);
    expect((await state.read("contacts")).data).toEqual([contact]);
    const audit=(await store.pool.query("SELECT metadata,old_values FROM audit_logs WHERE request_id='explicit-review-delete'")).rows[0]!;
    expect(audit.metadata.removedRecordId).toBe(first.id);
    expect(audit.old_values.data).toContainEqual(first);
    await expect(state.removeFeedback("reviews",second.id,50,actor,"stale-delete")).rejects.toMatchObject({code:"DOMAIN_VERSION_CONFLICT"});
    expect((await state.read("reviews")).data).toEqual([second]);
  });
  it("protects contacts against omissions and supports explicit deletion while preserving reviews",async () => {
    const current=await state.read("contacts");
    await expect(state.write("contacts",current.version,[],actor,"empty-contacts")).rejects.toMatchObject({code:"FEEDBACK_SNAPSHOT_INCOMPLETE"});
    expect((await state.removeFeedback("contacts",contact.id,current.version,actor,"explicit-contact-delete")).data).toEqual([]);
    expect((await state.read("reviews")).data).toEqual([first,second]);
  });
  it("rejects stale versions and absent deletion targets without changing stored feedback",async () => {
    await expect(state.write("reviews",49,[first,second],actor,"stale-write")).rejects.toMatchObject({code:"DOMAIN_VERSION_CONFLICT"});
    await expect(state.removeFeedback("reviews","missing",50,actor,"missing-delete")).rejects.toMatchObject({code:"FEEDBACK_NOT_FOUND"});
    expect((await state.read("reviews")).data).toEqual([first,second]);
  });
});
