import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { embeddedStore } from "./embedded-store.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";
import { encryptSecret } from "../src/security/crypto.js";
const config = { authPepper: "synthetic-document-access-pepper-32", sessionTtlDays: 30,
  emailOtpTtlMinutes: 10, mfaEncryptionKey: Buffer.alloc(32, 9) };
const metadata = { requestId: "synthetic-document-read", ipAddress: "127.0.0.1", userAgent: "vitest" };
const staff = randomUUID(), representative = randomUUID();
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2QAAAAASUVORK5CYII=";
const account = { userId: staff, accountType: "staff", status: "active", email: "staff@example.test", emailVerified: true,
  mustChangePassword: false, sessionId: randomUUID(), sessionFamilyId: randomUUID(), csrfTokenHash: "synthetic",
  mfaRequired: true, mfaSatisfied: true, permissions: ["representatives.read_applications"] } satisfies AuthenticatedAccount;
describe("private representative document access audit", () => {
  let store: Awaited<ReturnType<typeof embeddedStore>>, service: IdentityService;
  beforeAll(async () => {
    store = await embeddedStore(); service = new IdentityService(store.pool, config);
    for (const [id, type] of [[staff, "staff"], [representative, "representative"]]) {
      await store.pool.query(`INSERT INTO users(id,account_type,email,email_normalized,password_hash,status,email_verified_at)
        VALUES($1,$2,$3,$3,'synthetic','active',now())`, [id, type, `${id}@example.test`]);
    }
    await store.pool.query("INSERT INTO staff_users(user_id,display_name) VALUES($1,'Synthetic reviewer')", [staff]);
    await store.pool.query("INSERT INTO representatives(user_id,full_name,national_id_hash,national_id_last4) VALUES($1,'Synthetic courier',repeat('3',64),'3333')", [representative]);
    for (const type of ["id_front", "id_back", "face"]) {
      await store.pool.query(`INSERT INTO representative_documents(representative_user_id,document_type,content_type,encrypted_payload,byte_size,content_sha256)
        VALUES($1,$2,'image/png',$3,$4,$5)`, [representative, type, encryptSecret(image, config.mfaEncryptionKey), image.length, createHash("sha256").update(image).digest("hex")]);
    }
  }, 30000);
  afterAll(async () => { await store?.db.close(); });
  const events = async () => (await store.pool.query("SELECT actor_id,action,entity_type,entity_id,request_id,metadata FROM audit_logs WHERE action='REPRESENTATIVE_DOCUMENT_ACCESSED' ORDER BY occurred_at")).rows;
  it("records the authorized actor, target and each document type without copying image or contact data", async () => {
    for (const type of ["id_front", "id_back", "face"] as const) {
      expect(await service.representativeDocument(account, representative, type, metadata)).toEqual({ contentType: "image/png", dataUrl: image });
    }
    const rows = await events(); expect(rows).toHaveLength(3);
    expect(rows.map(row => row.metadata.documentType)).toEqual(["id_front", "id_back", "face"]);
    for (const row of rows) expect(row).toMatchObject({ actor_id: staff, entity_type: "representative_documents", entity_id: representative, request_id: metadata.requestId });
    expect(JSON.stringify(rows)).not.toMatch(/data:image|example.test|127\.0\.0\.1/);
  });
  it.each(["permission", "mfa"])("denies access without %s and writes no successful access record", async mode => {
    const denied = { ...account, ...(mode === "permission" ? { permissions: [] } : { mfaSatisfied: false }) };
    const before = (await events()).length;
    await expect(service.representativeDocument(denied, representative, "id_front", metadata)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await events()).toHaveLength(before);
  });
  it("refuses to release a document when its audit insert fails and releases the database connection", async () => {
    const release = vi.fn();
    const pool = { connect: async () => {
      const client = await store.pool.connect();
      return { query: (sql: string, params: unknown[]) => {
        if (sql.includes("INSERT INTO audit_logs")) throw new Error("Synthetic audit unavailable");
        return client.query(sql, params);
      }, release: () => { release(); client.release(); } };
    } } as unknown as Pool;
    await expect(new IdentityService(pool, config).representativeDocument(account, representative, "id_front", metadata)).rejects.toThrow("Synthetic audit unavailable");
    expect(release).toHaveBeenCalledOnce();
  });
  it("returns a missing-document error without creating a misleading access record", async () => {
    const before = (await events()).length;
    await expect(service.representativeDocument(account, randomUUID(), "face", metadata)).rejects.toMatchObject({ code: "REPRESENTATIVE_DOCUMENT_NOT_FOUND" });
    expect(await events()).toHaveLength(before);
  });
});
