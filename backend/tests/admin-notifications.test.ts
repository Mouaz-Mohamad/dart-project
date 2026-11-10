// DART CODE GUIDE | backend/tests/admin-notifications.test.ts
// Isolated permissions, read receipts, atomic events and native delivery acceptance.
import { createECDH,randomUUID } from "node:crypto";
import { beforeAll,afterAll,beforeEach,describe,it,expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { embeddedStore } from "./embedded-store.js";
import { loadConfig } from "../src/config/env.js";
import { createApp } from "../src/application.js";
import { AdminNotificationService } from "../src/modules/notifications/admin-notification.service.js";
import { queueAdminNotification, type AdminNotificationEvent } from "../src/modules/notifications/admin-notification.queue.js";
import { deliverAdminPush, deliverAdminTestPush } from "../src/modules/notifications/admin-push-dispatch.js";
import { queueOrderNotifications } from "../src/modules/commerce/commerce.notifications.js";
import { CustomerInteractionService } from "../src/modules/commerce/customer-interaction.service.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { WebPushProvider } from "../src/modules/notifications/web-push-provider.js";
const curve=createECDH("prime256v1");curve.generateKeys();
const config=loadConfig({NODE_ENV:"test",DATABASE_URL:"postgres://synthetic.test/dart",RATE_LIMIT_MAX:"1000",
  WEB_PUSH_VAPID_PUBLIC_KEY:curve.getPublicKey().toString("base64url"),WEB_PUSH_VAPID_PRIVATE_KEY:curve.getPrivateKey().toString("base64url"),WEB_PUSH_VAPID_SUBJECT:"https://www.dartofficial.com/"});
const permissions=["notifications.read","orders.read","returns.read","reviews.read"];
const csrf="synthetic-staff-notifications",cookie=`dart_session_staff=${randomUUID()}.${"x".repeat(43)}`;
function browser(){const key=createECDH("prime256v1");key.generateKeys();return {endpoint:`https://fcm.googleapis.com/fcm/send/${randomUUID()}`,expirationTime:null,keys:{p256dh:key.getPublicKey().toString("base64url"),auth:Buffer.alloc(16,5).toString("base64url")}};}
describe("staff notifications",()=>{
  let store:Awaited<ReturnType<typeof embeddedStore>>,service:AdminNotificationService,app:ReturnType<typeof createApp>,auth:AuthenticatedAccount;
  let userId:string,otherId:string,sessionId:string;
  beforeAll(async()=>{store=await embeddedStore(true);service=new AdminNotificationService(store.pool,config);
    app=createApp(config,{logger:pino({level:"silent"}),databasePing:async()=>{},startedAt:new Date(),version:"synthetic",
      identityService:{authenticate:async()=>auth} as unknown as IdentityService,adminNotificationService:service});
  },30000);
  afterAll(async()=>{await store?.db.close();});
  beforeEach(async()=>{
    await store.pool.query("DELETE FROM outbox_events");await store.pool.query("DELETE FROM admin_notifications");await store.pool.query("DELETE FROM admin_push_subscriptions");
    // Reset the previous synthetic owner between cases: the isolated schema permits only one owner.
    await store.pool.query("UPDATE staff_users SET is_owner=false WHERE is_owner=true");
    userId=randomUUID();otherId=randomUUID();sessionId=randomUUID();
    for(const id of [userId,otherId]){
      await store.pool.query("INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at) VALUES($1,'staff',$2,$2,'synthetic','active',now())",[id,`${id}@example.test`]);
      await store.pool.query("INSERT INTO staff_users(user_id,display_name,is_owner,mfa_required) VALUES($1,'Synthetic Staff',false,false)",[id]);
      await store.pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='Owner'",[id]);
    }
    await store.pool.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,user_session_version,expires_at) VALUES($1,$2,$3,$3,1,now()+interval '1 day')",[sessionId,userId,"a"+randomUUID().replaceAll("-","")+"b".repeat(31)]);
    auth={userId,sessionId,accountType:"staff",permissions:[...permissions],csrfTokenHash:hashCsrfToken(csrf,config.authPepper),mfaRequired:false} as AuthenticatedAccount;
  });
  async function queue(type:AdminNotificationEvent="ORDER_CREATED",id=randomUUID()){
    const client=await store.pool.connect();await queueAdminNotification(client,type,id,"K-SYNTHETIC");client.release();return id;
  }
  async function subscribe(){return service.push.subscribe(userId,sessionId,browser(),config.webPushVapidPublicKey!,"synthetic");}
  const provider=(calls:string[]):WebPushProvider=>({configured:()=>true,publicKey:()=>config.webPushVapidPublicKey!,send:async(_s,payload)=>{calls.push(payload);return "accepted";}});
  it("deduplicates and rolls back inbox/outbox with the business transaction",async()=>{
    await subscribe();const id=await queue();await queue("ORDER_CREATED",id);
    const client=await store.pool.connect();await client.query("BEGIN");await queueAdminNotification(client,"REVIEW_CREATED",randomUUID());await client.query("ROLLBACK");client.release();
    expect((await service.list(userId,permissions)).unreadCount).toBe(1);
    expect((await store.pool.query("SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_type='admin_notification'")).rows[0].count).toBe(1);
  });
  it("filters categories and keeps reads independent across accounts and pages",async()=>{
    for(const type of ["ORDER_CREATED","RETURN_CREATED","EXCHANGE_CREATED","REVIEW_CREATED"] as const)await queue(type);
    const page=await service.list(userId,permissions,2);expect(page.unread).toEqual({orders:1,returns:2,review:1});expect(page.nextCursor).toBeTruthy();
    expect((await service.list(userId,permissions,2,page.nextCursor!)).notifications).toHaveLength(2);
    for(let i=0;i<2;i++)await service.markRead(userId,permissions,page.notifications.map(n=>n.id));
    expect((await service.list(userId,permissions)).unreadCount).toBe(2);expect((await service.list(otherId,permissions)).unreadCount).toBe(4);
    expect((await service.list(userId,["notifications.read","orders.read"])).notifications).toHaveLength(1);
    expect((await service.list(userId,["orders.read"])).unreadCount).toBe(0);
  });
  it("requires staff permission/CSRF and denies inaccessible deep links",async()=>{
    await queue("REVIEW_CREATED");const event=(await service.list(userId,permissions)).notifications[0]!;
    expect((await request(app).post("/api/v1/admin/notifications/read").set("Cookie",cookie).send({ids:[event.id]})).status).toBe(403);
    expect((await request(app).post("/api/v1/admin/notifications/read").set("Cookie",cookie).set("x-csrf-token",csrf).send({ids:[event.id]})).status).toBe(200);
    auth.permissions=["notifications.read","orders.read"];
    expect((await request(app).get("/api/v1/admin/notifications/"+event.id).set("Cookie",cookie)).status).toBe(404);
    auth.accountType="customer";expect((await request(app).get("/api/v1/admin/notifications").set("Cookie",cookie)).status).toBe(403);
    auth.accountType="staff";auth.permissions=[];expect((await request(app).get("/api/v1/admin/notifications").set("Cookie",cookie)).status).toBe(403);
  });
  it("encrypts subscriptions and dispatches one generic native alert through the outbox",async()=>{
    const subscription=browser();await service.push.subscribe(userId,sessionId,subscription,config.webPushVapidPublicKey!,"synthetic");await queue();
    const stored=await store.pool.query("SELECT encrypted_subscription FROM admin_push_subscriptions WHERE customer_user_id=$1",[userId]);
    expect(Buffer.from(stored.rows[0].encrypted_subscription).toString()).not.toContain(subscription.endpoint);
    const calls:string[]=[];const outbox=new OutboxService(store.pool,config,null,provider(calls));await outbox.processBatch(10);await outbox.processBatch(10);
    expect(calls).toHaveLength(1);expect(JSON.parse(calls[0]!)).toMatchObject({eventType:"ORDER_CREATED"});expect(calls[0]).not.toContain("K-SYNTHETIC");
  });
  it("suppresses alerts after read, logout, opt-out or removal of permission",async()=>{
    for(const barrier of ["read","logout","optout","permission"]){
      await store.pool.query("UPDATE sessions SET revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[sessionId]);
      const sub=await subscribe();await queue();const event=(await service.list(userId,permissions)).notifications[0]!;
      const payload=(await store.pool.query("SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND payload->>'subscriptionId'=$2",[event.id,sub.id])).rows[0].payload;
      if(barrier==="read")await service.markRead(userId,permissions,[event.id]);
      if(barrier==="logout")await store.pool.query("UPDATE sessions SET revoked_at=now(),revoke_reason='synthetic' WHERE id=$1",[sessionId]);
      if(barrier==="optout")await service.push.unsubscribe(userId,sub.id,"synthetic");
      if(barrier==="permission")await store.pool.query("INSERT INTO user_permission_overrides(user_id,permission_id,allowed) SELECT $1,id,false FROM permissions WHERE key='orders.read'",[userId]);
      const calls:string[]=[];expect(await deliverAdminPush(store.pool,config.mfaEncryptionKey,provider(calls),payload)).toEqual({suppressed:true});expect(calls).toHaveLength(0);
    }
  });
  it("broadcasts to all subscribed staff devices without creating a fake inbox record",async()=>{
    await store.pool.query("UPDATE staff_users SET is_owner=true WHERE user_id=$1",[userId]);
    const secondSession=randomUUID();
    await store.pool.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,user_session_version,expires_at) VALUES($1,$2,$3,$3,1,now()+interval '1 day')",
      [secondSession,otherId,"b"+randomUUID().replaceAll("-","")+"c".repeat(31)]);
    await subscribe();
    await service.push.subscribe(otherId,secondSession,browser(),config.webPushVapidPublicKey!,"synthetic");
    const batch=await service.queueTestBroadcast(userId,"broadcast-synthetic");
    expect(batch.queued).toBe(2);
    expect((await service.list(userId,permissions)).unreadCount).toBe(0);
    const calls:string[]=[];
    const outbox=new OutboxService(store.pool,config,null,provider(calls));
    await outbox.processBatch(10);
    expect(calls).toHaveLength(2);
    expect(calls.every(call=>JSON.parse(call).eventType==="ADMIN_PUSH_TEST")).toBe(true);
    expect((await service.testBroadcastStatus(userId,batch.testId)).accepted).toBe(2);
    await expect(service.queueTestBroadcast(userId,"broadcast-duplicate")).rejects.toBeTruthy();
  });
  it("blocks non-owner tests and suppresses delivery if notification permission is removed",async()=>{
    await subscribe();
    await expect(service.queueTestBroadcast(userId,"not-owner")).rejects.toBeTruthy();
    await store.pool.query("UPDATE staff_users SET is_owner=true WHERE user_id=$1",[userId]);
    const batch=await service.queueTestBroadcast(userId,"owner");
    const row=await store.pool.query("SELECT payload FROM outbox_events WHERE aggregate_id=$1",[batch.testId]);
    await store.pool.query("INSERT INTO user_permission_overrides(user_id,permission_id,allowed) SELECT $1,id,false FROM permissions WHERE key='notifications.read'",[userId]);
    const calls:string[]=[];
    expect(await deliverAdminTestPush(store.pool,config.mfaEncryptionKey,provider(calls),row.rows[0].payload)).toEqual({suppressed:true});
    expect(calls).toHaveLength(0);
  });
  it("hooks new orders and public reviews without backfilling history",async()=>{
    expect((await service.list(userId,permissions)).notifications).toHaveLength(0);
    const order=await store.pool.query("INSERT INTO orders(subtotal_minor,final_minor,delivery_address) VALUES(0,0,'{}') RETURNING id::text");
    const client=await store.pool.connect();await queueOrderNotifications(client,order.rows[0].id,"order.created");await queueOrderNotifications(client,order.rows[0].id,"order.created");client.release();
    await new CustomerInteractionService(store.pool).submitPublicReview({fullName:"Synthetic",phone1:"01000000000",rating:5,review:"Synthetic acceptance review"},"synthetic");
    const page=await service.list(userId,permissions);expect(page.unread.orders).toBe(1);expect(page.unread.review).toBe(1);
  });
});
