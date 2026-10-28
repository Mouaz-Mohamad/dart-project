import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createWhatsAppWebhookRouter } from "../src/modules/outbox/whatsapp-webhook.routes.js";

const secret = "test-meta-app-secret";
const verify = "v".repeat(40);
function setup(phoneId = "123") {
  const query = vi.fn(async (...args: unknown[]) => { void args; return { rowCount: 1, rows: [] }; });
  const app = express();
  app.use("/api/v1/webhooks/whatsapp", createWhatsAppWebhookRouter({ query } as never, {
    whatsappAppSecret: secret, whatsappWebhookVerifyToken: verify,
    whatsappPhoneNumberId: phoneId,
  }));
  return { app, query };
}
function statusBody(status = "delivered", phoneId = "123") {
  return { object: "whatsapp_business_account", entry: [{
    changes: [{ value: { metadata: { phone_number_id: phoneId },
      statuses: [{ id: "wamid.test", status, timestamp: "1793210000",
        biz_opaque_callback_data: "123e4567-e89b-42d3-a456-426614174000" }] } }],
  }] };
}
function signature(body: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
describe("WhatsApp webhook security", () => {
  it("responds to the genuine Meta verification challenge", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/v1/webhooks/whatsapp").query({
      "hub.mode": "subscribe", "hub.verify_token": verify, "hub.challenge": "987123",
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe("987123");
  });
  it("rejects incorrect verification tokens", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/v1/webhooks/whatsapp").query({
      "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "987123",
    });
    expect(res.status).toBe(403);
  });
  it("rejects unsigned and tampered events before accessing the database", async () => {
    const { app, query } = setup();
    const body = JSON.stringify(statusBody());
    const response = await request(app).post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json").set("x-hub-signature-256", signature(body))
      .send(body + " ");
    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("persists only signed statuses from the configured sending number", async () => {
    const { app, query } = setup();
    const body = JSON.stringify(statusBody());
    const response = await request(app).post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json").set("x-hub-signature-256", signature(body)).send(body);
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("delivery_status");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "wamid.test", "123e4567-e89b-42d3-a456-426614174000", "delivered", 1793210000, null, 3,
    ]);
    const other = JSON.stringify(statusBody("read", "different"));
    const response2 = await request(app).post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json").set("x-hub-signature-256", signature(other)).send(other);
    expect(response2.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("returns retryable failure when receipt storage fails", async () => {
    const { app, query } = setup();
    query.mockRejectedValueOnce(new Error("database unavailable"));
    const body = JSON.stringify(statusBody());
    const response = await request(app).post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json").set("x-hub-signature-256", signature(body)).send(body);
    expect(response.status).toBe(503);
  });
  it("processes all 101 statuses instead of silently truncating them", async () => {
    const { app, query } = setup();
    const payload = statusBody();
    payload.entry[0]!.changes[0]!.value.statuses = Array.from({length:101},(_,index)=>({
      id:`wamid.${index}`,status:"delivered",timestamp:"1793210000",biz_opaque_callback_data:"123e4567-e89b-42d3-a456-426614174000",
    }));
    const body = JSON.stringify(payload);
    const response = await request(app).post("/api/v1/webhooks/whatsapp").set("Content-Type","application/json")
      .set("x-hub-signature-256",signature(body)).send(body);
    expect(response.status).toBe(200); expect(query).toHaveBeenCalledTimes(101);
  });
  it("does not acknowledge or partially write an oversized signed status batch", async () => {
    const { app, query } = setup();
    const payload = statusBody();
    payload.entry[0]!.changes[0]!.value.statuses = Array.from({length:501},(_,index)=>({
      id:`wamid.${index}`,status:"delivered",timestamp:"1793210000",biz_opaque_callback_data:"123e4567-e89b-42d3-a456-426614174000",
    }));
    const body = JSON.stringify(payload);
    const response = await request(app).post("/api/v1/webhooks/whatsapp").set("Content-Type","application/json")
      .set("x-hub-signature-256",signature(body)).send(body);
    expect(response.status).toBe(503); expect(query).not.toHaveBeenCalled();
  });
});
