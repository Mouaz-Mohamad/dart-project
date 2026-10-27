// DART CODE GUIDE | backend/tests/customer-notifications.test.ts
// Isolated PostgreSQL/PGlite acceptance: history, consent, ownership and delivery barriers.
import { createECDH, randomUUID } from "node:crypto";
import request from "supertest";
import pino from "pino";
import webPush from "web-push";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { loadConfig } from "../src/config/env.js";
import { createApp } from "../src/application.js";
import { CustomerNotificationService } from "../src/modules/notifications/notification.service.js";
import { sendNotification } from "../src/modules/notifications/notification.queue.js";
import { queueOrderNotifications } from "../src/modules/commerce/commerce.notifications.js";
import { OutboxService } from "../src/modules/outbox/outbox.service.js";
import {
  ConfiguredWebPushProvider,
  PushDeliveryError,
  type WebPushProvider,
} from "../src/modules/notifications/web-push-provider.js";
import { decryptSecret } from "../src/security/crypto.js";
import { hashCsrfToken } from "../src/security/session-token.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import type { BrowserPushSubscription } from "../src/modules/notifications/push-validation.js";

const curve = createECDH("prime256v1");
curve.generateKeys();
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://synthetic.test/dart",
  RATE_LIMIT_MAX: "1000",
  WEB_PUSH_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"),
  WEB_PUSH_VAPID_PRIVATE_KEY: curve.getPrivateKey().toString("base64url"),
  WEB_PUSH_VAPID_SUBJECT: "https://www.dartofficial.com/",
});
const csrf = "synthetic-notification-csrf",
  cookie = `dart_session=${randomUUID()}.${"x".repeat(43)}`;
function browser(
  endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
): BrowserPushSubscription {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 5).toString("base64url"),
    },
  };
}
class FakePush implements WebPushProvider {
  public readonly calls: Array<{
    subscription: BrowserPushSubscription;
    payload: string;
    topic: string;
  }> = [];
  public outcome: "accepted" | "expired" = "accepted";
  public error: Error | null = null;
  public configured() {
    return true;
  }
  public publicKey() {
    return config.webPushVapidPublicKey!;
  }
  public async send(
    subscription: BrowserPushSubscription,
    payload: string,
    topic: string,
  ) {
    this.calls.push({ subscription, payload, topic });
    if (this.error) throw this.error;
    return this.outcome;
  }
}

describe("customer notification foundation", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>,
    service: CustomerNotificationService;
  let auth: AuthenticatedAccount, app: ReturnType<typeof createApp>;
  let userId: string,
    otherId: string,
    sessionId: string,
    orderId: string,
    push: FakePush,
    outbox: OutboxService;
  beforeAll(async () => {
    store = await embeddedStore(true);
    service = new CustomerNotificationService(store.pool, config);
    app = createApp(config, {
      logger: pino({ level: "silent" }),
      databasePing: async () => {},
      startedAt: new Date(),
      version: "synthetic",
      identityService: {
        authenticate: async () => auth,
      } as unknown as IdentityService,
      customerNotificationService: service,
    });
  }, 30000);
  afterAll(async () => {
    await store?.db.close();
  });
  beforeEach(async () => {
    userId = randomUUID();
    otherId = randomUUID();
    sessionId = randomUUID();
    for (const id of [userId, otherId]) {
      await store.pool.query(
        `INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,'customer',$2,$2,'synthetic','active',now())`,
        [id, `${id}@example.test`],
      );
      await store.pool.query(
        "INSERT INTO customers(user_id,full_name,birthday) VALUES($1,'Synthetic Customer','2000-01-01')",
        [id],
      );
    }
    await store.pool.query(
      `INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,user_session_version,expires_at)
      VALUES($1,$2,$3,$3,1,now()+interval '1 day')`,
      [
        sessionId,
        userId,
        "a" + randomUUID().replaceAll("-", "") + "b".repeat(31),
      ],
    );
    const order = await store.pool.query(
      `INSERT INTO orders(customer_user_id,status,subtotal_minor,final_minor,contact_snapshot,delivery_address)
      VALUES($1,'New',0,0,'{"name":"Synthetic","email":"order@example.test"}','{"country":"Egypt","governorate":"Cairo","area":"Synthetic","street":"Street","building":"1","floor":"1","latitude":30.05,"longitude":31.35}') RETURNING id::text`,
      [userId],
    );
    orderId = order.rows[0]!.id;
    auth = {
      userId,
      sessionId,
      accountType: "customer",
      permissions: [],
      csrfTokenHash: hashCsrfToken(csrf, config.authPepper),
    } as unknown as AuthenticatedAccount;
    push = new FakePush();
    outbox = new OutboxService(store.pool, config, null, push);
  });
  const queue = async (
    eventType:
      | "ORDER_PLACED"
      | "ORDER_OUT_FOR_DELIVERY"
      | "ORDER_DELIVERED" = "ORDER_PLACED",
  ) => {
    const client = await store.pool.connect();
    try {
      await client.query("BEGIN");
      await sendNotification(client, {
        customerUserId: userId,
        orderId,
        orderCode: "K-SYNTHETIC",
        eventType,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const subscribe = () =>
    service.subscribe(
      userId,
      sessionId,
      browser(),
      config.webPushVapidPublicKey!,
      "synthetic",
    );
  const event = async () =>
    (
      await store.pool.query(
        "SELECT id::text,deduplication_key,payload FROM outbox_events WHERE aggregate_type='customer_notification' AND aggregate_id IN(SELECT id::text FROM customer_notifications WHERE customer_user_id=$1) ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    ).rows[0]!;

  it("enables deny-by-default row security on both private tables", async () => {
    const rows = await store.pool
      .query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()
        AND c.relname IN ('customer_notifications','web_push_subscriptions')`);
    expect(rows.rows).toHaveLength(2);
    expect(
      rows.rows.every((row) => row.relrowsecurity && !row.relforcerowsecurity),
    ).toBe(true);
  });
  it("shows only the signed-in customer's notifications, with stable keyset pagination", async () => {
    await queue();
    await queue("ORDER_OUT_FOR_DELIVERY");
    await queue("ORDER_DELIVERED");
    const first = await service.list(userId, 1);
    const second = await service.list(userId, 1, first.nextCursor!);
    expect(first.unreadCount).toBe(3);
    expect(first.notifications).toHaveLength(1);
    expect(second.notifications[0]!.id).not.toBe(first.notifications[0]!.id);
    expect((await service.list(otherId)).notifications).toEqual([]);
    await expect(service.list(userId, 25, "invalid")).rejects.toMatchObject({
      statusCode: 422,
    });
  });
  it("marks only explicit owned IDs, preserves newly arrived notifications and is idempotent", async () => {
    await queue();
    const id = (await service.list(userId)).notifications[0]!.id;
    expect(await service.markRead(otherId, [id])).toEqual({ updated: 0 });
    await queue("ORDER_DELIVERED");
    expect(await service.markRead(userId, [id])).toEqual({ updated: 1 });
    expect(await service.markRead(userId, [id])).toEqual({ updated: 0 });
    expect((await service.list(userId)).unreadCount).toBe(1);
  });
  it("commits one history row and one event per subscribed device despite replay", async () => {
    await subscribe();
    await queue();
    await queue();
    expect((await service.list(userId)).notifications).toHaveLength(1);
    const rows = await store.pool.query(
      "SELECT payload FROM outbox_events WHERE aggregate_id=(SELECT id::text FROM customer_notifications WHERE customer_user_id=$1)",
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain("fcm.googleapis");
    const key = (await event()).deduplication_key;
    expect((await outbox.processBatch(1, key)).published).toBe(1);
    expect((await outbox.processBatch(1, key)).claimed).toBe(0);
    expect(push.calls).toHaveLength(1);
    expect(JSON.parse(push.calls[0]!.payload)).toEqual({
      notificationId: (await service.list(userId)).notifications[0]!.id,
    });
    expect(push.calls[0]!.topic).toHaveLength(32);
  });
  it("rolls history and all delivery events back with the order operation", async () => {
    await subscribe();
    const client = await store.pool.connect();
    try {
      await client.query("BEGIN");
      await sendNotification(client, {
        customerUserId: userId,
        orderId,
        orderCode: "SYNTHETIC",
        eventType: "ORDER_PLACED",
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await service.list(userId)).notifications).toEqual([]);
    expect(await event()).toBeUndefined();
  });
  it("keeps existing email status events and emits only the three approved in-site events", async () => {
    const client = await store.pool.connect();
    try {
      await queueOrderNotifications(client, orderId, "order.created");
      await store.pool.query(
        "UPDATE orders SET status='Accepted',version=version+1 WHERE id=$1",
        [orderId],
      );
      await queueOrderNotifications(client, orderId, "order.status_changed");
      await store.pool.query(
        "UPDATE orders SET status='Out With Representative',version=version+1 WHERE id=$1",
        [orderId],
      );
      await queueOrderNotifications(client, orderId, "order.status_changed");
      expect((await service.list(userId)).notifications).toHaveLength(1);
      await store.pool.query(
        "UPDATE orders SET status='Representative On The Way',version=version+1 WHERE id=$1",
        [orderId],
      );
      await queueOrderNotifications(client, orderId, "order.status_changed");
      await store.pool.query(
        "UPDATE orders SET status='Delivered',version=version+1 WHERE id=$1",
        [orderId],
      );
      await queueOrderNotifications(client, orderId, "order.status_changed");
      expect((await service.list(userId)).notifications).toHaveLength(3);
      expect(
        (
          await store.pool.query(
            "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND payload->>'channel'='email'",
            [orderId],
          )
        ).rows,
      ).toHaveLength(5);
      expect(
        (
          await store.pool.query(
            "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND payload->>'channel'='whatsapp'",
            [orderId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      client.release();
    }
  });
  it("persists in-site events without requiring a usable email recipient", async () => {
    await store.pool.query("UPDATE users SET email='invalid' WHERE id=$1", [
      userId,
    ]);
    const client = await store.pool.connect();
    try {
      await queueOrderNotifications(client, orderId, "order.created");
    } finally {
      client.release();
    }
    expect((await service.list(userId)).notifications).toHaveLength(1);
  });
  it("encrypts subscription secrets, audits consent and accepts identical retries without version churn", async () => {
    const subscription = browser();
    const first = await service.subscribe(
      userId,
      sessionId,
      subscription,
      config.webPushVapidPublicKey!,
      "synthetic",
    );
    const retry = await service.subscribe(
      userId,
      sessionId,
      subscription,
      config.webPushVapidPublicKey!,
      "synthetic",
    );
    expect(retry.id).toBe(first.id);
    const row = (
      await store.pool.query(
        "SELECT * FROM web_push_subscriptions WHERE id=$1",
        [first.id],
      )
    ).rows[0]!;
    expect(row.version).toBe(1);
    expect(Buffer.from(row.encrypted_subscription).toString()).not.toContain(
      subscription.endpoint,
    );
    expect(
      JSON.parse(
        decryptSecret(
          Buffer.from(row.encrypted_subscription),
          config.mfaEncryptionKey,
        ),
      ),
    ).toEqual(subscription);
    expect(
      (
        await store.pool.query(
          "SELECT id FROM audit_logs WHERE entity_id=$1 AND action='WEB_PUSH_ENABLED'",
          [first.id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      JSON.stringify(await service.subscriptions(userId, sessionId)),
    ).not.toContain(subscription.keys.auth);
  });
  it("refuses to transfer another customer's endpoint and ignores foreign unsubscribe IDs", async () => {
    const subscription = browser();
    const first = await service.subscribe(
      userId,
      sessionId,
      subscription,
      config.webPushVapidPublicKey!,
      "synthetic",
    );
    await service.unsubscribe(otherId, first.id, "synthetic");
    expect(
      (await service.subscriptions(userId, sessionId)).subscriptions[0]!
        .enabled,
    ).toBe(true);
    // Own valid session still cannot claim a foreign endpoint.
    const otherSession = randomUUID();
    await store.pool.query(
      `INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,user_session_version,expires_at)
      VALUES($1,$2,$3,$3,1,now()+interval '1 day')`,
      [
        otherSession,
        otherId,
        "c" + randomUUID().replaceAll("-", "") + "d".repeat(31),
      ],
    );
    await expect(
      service.subscribe(
        otherId,
        otherSession,
        subscription,
        config.webPushVapidPublicKey!,
        "synthetic",
      ),
    ).rejects.toMatchObject({ code: "PUSH_BROWSER_IN_USE" });
  });
  it("suppresses a queued send after opt-out and does not replay it after re-enabling", async () => {
    const subscription = browser();
    const saved = await service.subscribe(
      userId,
      sessionId,
      subscription,
      config.webPushVapidPublicKey!,
      "synthetic",
    );
    await queue();
    const key = (await event()).deduplication_key;
    await service.unsubscribe(userId, saved.id, "synthetic");
    await service.unsubscribe(userId, saved.id, "synthetic");
    await service.subscribe(
      userId,
      sessionId,
      subscription,
      config.webPushVapidPublicKey!,
      "synthetic",
    );
    expect((await outbox.processBatch(1, key)).published).toBe(1);
    expect(push.calls).toHaveLength(0);
  });
  it.each(["logout", "session_version", "suspended", "deleted", "expired"])(
    "suppresses queued delivery after %s",
    async (reason) => {
      await subscribe();
      await queue();
      const key = (await event()).deduplication_key;
      if (reason === "logout")
        await store.pool.query(
          "UPDATE sessions SET revoked_at=now(),revoke_reason='logout' WHERE id=$1",
          [sessionId],
        );
      if (reason === "session_version")
        await store.pool.query(
          "UPDATE users SET session_version=session_version+1 WHERE id=$1",
          [userId],
        );
      if (reason === "suspended")
        await store.pool.query(
          "UPDATE users SET status='suspended' WHERE id=$1",
          [userId],
        );
      if (reason === "deleted")
        await store.pool.query(
          "UPDATE users SET deleted_at=now() WHERE id=$1",
          [userId],
        );
      if (reason === "expired")
        await store.pool.query(
          "UPDATE sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
          [sessionId],
        );
      await outbox.processBatch(1, key);
      expect(push.calls).toHaveLength(0);
    },
  );
  it("retains consent through secure session rotation and stops after replacement logout", async () => {
    await subscribe();
    await queue();
    const key = (await event()).deduplication_key,
      replacement = randomUUID();
    await store.pool.query(
      `INSERT INTO sessions(id,user_id,family_id,token_hash,csrf_token_hash,user_session_version,expires_at)
      SELECT $2,user_id,family_id,$3,$3,user_session_version,now()+interval '1 day' FROM sessions WHERE id=$1`,
      [
        sessionId,
        replacement,
        "r" + randomUUID().replaceAll("-", "") + "s".repeat(31),
      ],
    );
    await store.pool.query(
      "UPDATE sessions SET revoked_at=now(),revoke_reason='rotated',replaced_by_session_id=$2 WHERE id=$1",
      [sessionId, replacement],
    );
    expect(
      (await service.subscriptions(userId, replacement)).subscriptions[0]!
        .enabled,
    ).toBe(true);
    await outbox.processBatch(1, key);
    expect(push.calls).toHaveLength(1);
    await queue("ORDER_DELIVERED");
    const next = (await event()).deduplication_key;
    await store.pool.query(
      "UPDATE sessions SET revoked_at=now(),revoke_reason='logout' WHERE id=$1",
      [replacement],
    );
    await outbox.processBatch(1, next);
    expect(push.calls).toHaveLength(1);
  });
  it("expires old events and suppresses delivery under an old VAPID key", async () => {
    const saved = await subscribe();
    await queue();
    const key = (await event()).deduplication_key;
    await store.pool.query(
      "UPDATE web_push_subscriptions SET vapid_fingerprint='old' WHERE id=$1",
      [saved.id],
    );
    await outbox.processBatch(1, key);
    expect(push.calls).toHaveLength(0);
    expect(
      (
        await store.pool.query(
          "SELECT active FROM web_push_subscriptions WHERE id=$1",
          [saved.id],
        )
      ).rows[0]!.active,
    ).toBe(false);
    await subscribe();
    await queue("ORDER_DELIVERED");
    const old = (await event()).deduplication_key;
    await store.pool.query(
      "UPDATE customer_notifications SET created_at=now()-interval '2 days' WHERE customer_user_id=$1",
      [userId],
    );
    await outbox.processBatch(1, old);
    expect(push.calls).toHaveLength(0);
  });
  it("disables expired provider subscriptions and never retries an ambiguous acceptance", async () => {
    const saved = await subscribe();
    await queue();
    let key = (await event()).deduplication_key;
    push.outcome = "expired";
    await outbox.processBatch(1, key);
    expect(
      (await service.subscriptions(userId, sessionId)).subscriptions.find(
        (s) => s.id === saved.id,
      )!.enabled,
    ).toBe(false);
    await subscribe();
    await queue("ORDER_DELIVERED");
    key = (await event()).deduplication_key;
    push.error = new PushDeliveryError(
      "unknown",
      "Push delivery outcome requires reconciliation",
    );
    expect((await outbox.processBatch(1, key)).uncertain).toBe(1);
    await store.pool.query(
      "UPDATE outbox_events SET available_at=now() WHERE deduplication_key=$1",
      [key],
    );
    expect((await outbox.processBatch(1, key)).claimed).toBe(0);
    expect((await outbox.health()).uncertain).toBeGreaterThan(0);
  });
  it("requires customer authentication, CSRF and bounded valid HTTP input", async () => {
    await request(app).get("/api/v1/me/notifications").expect(401);
    await request(app)
      .get("/api/v1/me/notifications?limit=999")
      .set("Cookie", cookie)
      .expect(422);
    await request(app)
      .post("/api/v1/me/notifications/read")
      .set("Cookie", cookie)
      .send({ ids: [] })
      .expect(403);
    await request(app)
      .post("/api/v1/me/notifications/read")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ ids: ["bad"] })
      .expect(422);
    const good = await request(app)
      .get("/api/v1/me/notifications")
      .set("Cookie", cookie)
      .expect(200);
    expect(good.headers["cache-control"]).toBe("no-store");
    auth = { ...auth, accountType: "staff" };
    await request(app)
      .get("/api/v1/me/push/config")
      .set("Cookie", cookie)
      .expect(403);
  });
  it("rejects SSRF endpoints and malformed browser key material before storage", async () => {
    for (const endpoint of [
      "https://127.0.0.1/push",
      "http://fcm.googleapis.com/push",
      "https://fcm.googleapis.com.attacker.test/push",
      "https://fcm.googleapis.com:444/push",
      "https://user@fcm.googleapis.com/push",
      "https://fcm.googleapis.com/push#fragment",
    ]) {
      await request(app)
        .post("/api/v1/me/push/subscriptions")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({
          subscription: browser(endpoint),
          publicKey: config.webPushVapidPublicKey,
        })
        .expect(422);
    }
    const subscription = browser();
    subscription.keys.p256dh = "A".repeat(87);
    await expect(
      service.subscribe(
        userId,
        sessionId,
        subscription,
        config.webPushVapidPublicKey!,
        "synthetic",
      ),
    ).rejects.toThrow();
    await expect(
      service.subscribe(userId, sessionId, browser(), "stale-key", "synthetic"),
    ).rejects.toMatchObject({ code: "PUSH_KEY_CHANGED" });
    expect(
      (await service.subscriptions(userId, sessionId)).subscriptions,
    ).toEqual([]);
  });
  it("enforces the ten-active-device cap", async () => {
    for (let i = 0; i < 10; i++) await subscribe();
    await expect(subscribe()).rejects.toMatchObject({
      code: "PUSH_DEVICE_LIMIT",
    });
  });
  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "serializes concurrent registration at the device cap and deduplicates concurrent events",
    async () => {
      for (let i = 0; i < 9; i++) await subscribe();
      const attempts = await Promise.allSettled([subscribe(), subscribe()]);
      expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await Promise.all([queue(), queue()]);
      expect((await service.list(userId)).notifications).toHaveLength(1);
      const key = (await event()).deduplication_key;
      // Workers lease a single event using PostgreSQL's SKIP LOCKED barrier.
      const results = await Promise.all([
        outbox.processBatch(1, key),
        outbox.processBatch(1, key),
      ]);
      expect(results.reduce((sum, row) => sum + row.claimed, 0)).toBe(1);
      expect(push.calls).toHaveLength(1);
    },
  );
});

describe("VAPID configuration validation", () => {
  it("permits disabled configuration and rejects partial or mismatched keys without exposing their values", () => {
    expect(
      loadConfig({ DATABASE_URL: "synthetic" }).webPushVapidPublicKey,
    ).toBe("");
    expect(() =>
      loadConfig({
        DATABASE_URL: "synthetic",
        WEB_PUSH_VAPID_PUBLIC_KEY: config.webPushVapidPublicKey,
      }),
    ).toThrow("WEB_PUSH_VAPID");
    const other = createECDH("prime256v1");
    other.generateKeys();
    expect(() =>
      loadConfig({
        DATABASE_URL: "synthetic",
        WEB_PUSH_VAPID_PUBLIC_KEY: config.webPushVapidPublicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: other.getPrivateKey().toString("base64url"),
        WEB_PUSH_VAPID_SUBJECT: "https://www.dartofficial.com/",
      }),
    ).toThrow("WEB_PUSH_VAPID");
  });
});

describe("Web Push provider outcomes", () => {
  afterEach(() => vi.restoreAllMocks());
  it("passes bounded per-request VAPID options and a stable collapse topic", async () => {
    const send = vi
      .spyOn(webPush, "sendNotification")
      .mockResolvedValue({ statusCode: 201, headers: {}, body: "" });
    const global = vi.spyOn(webPush, "setVapidDetails");
    const provider = new ConfiguredWebPushProvider(config),
      subscription = browser();
    expect(
      await provider.send(
        subscription,
        '{"notificationId":"synthetic"}',
        "topic",
      ),
    ).toBe("accepted");
    expect(send).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      expect.any(String),
      expect.objectContaining({
        TTL: 86400,
        timeout: 8000,
        topic: "topic",
        contentEncoding: "aes128gcm",
        vapidDetails: expect.objectContaining({
          subject: "https://www.dartofficial.com/",
        }),
      }),
    );
    expect(global).not.toHaveBeenCalled();
  });
  it.each([
    [404, "expired"],
    [410, "expired"],
    [429, "retryable"],
    [400, "terminal"],
    [503, "unknown"],
    [0, "unknown"],
  ] as const)(
    "classifies provider HTTP %i without exposing endpoint or response material",
    async (status, outcome) => {
      vi.spyOn(webPush, "sendNotification").mockRejectedValue(
        Object.assign(
          new Error("https://fcm.googleapis.com/private-token secret-auth"),
          { statusCode: status, body: "private" },
        ),
      );
      const task = new ConfiguredWebPushProvider(config).send(
        browser(),
        "{}",
        "topic",
      );
      if (outcome === "expired") expect(await task).toBe("expired");
      else
        await expect(task).rejects.toMatchObject({
          disposition: outcome,
          message: expect.not.stringContaining("private"),
        });
    },
  );
  it.each([
    ["ECONNREFUSED", "connect", "retryable"],
    ["ECONNREFUSED", "write", "unknown"],
    ["ENOTFOUND", "getaddrinfo", "retryable"],
    ["ETIMEDOUT", "write", "unknown"],
    ["ECONNRESET", "write", "unknown"],
  ] as const)(
    "treats %s during %s according to whether acceptance is possible",
    async (code, syscall, disposition) => {
      vi.spyOn(webPush, "sendNotification").mockRejectedValue(
        Object.assign(new Error("private endpoint"), { code, syscall }),
      );
      await expect(
        new ConfiguredWebPushProvider(config).send(browser(), "{}", "topic"),
      ).rejects.toMatchObject({ disposition });
    },
  );
});
