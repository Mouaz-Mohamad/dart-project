// DART CODE GUIDE | backend/tests/encrypted-backup.test.ts
// الغرض: إثبات سلامة تشفير النسخة ورفض النسخ المعدلة أو كلمة المرور الخاطئة.
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const password = "synthetic-backup-test-password-32-characters";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dart-encryption-test-"));
  roots.push(root);
  const archive = join(root, "source.dump");
  const encrypted = join(root, "source.dump.enc");
  const decrypted = join(root, "restored.dump");
  const source = Buffer.alloc(1024 * 1024, "synthetic database content");
  await writeFile(archive, source);
  const helpers = await import(new URL("../scripts/encrypted-database-backup.mjs", import.meta.url).href);
  await helpers.encryptArchive(archive, encrypted, password);
  return { archive, encrypted, decrypted, source, ...helpers };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authenticated database backup encryption", () => {
  it.each([
    ["psql 'postgresql://owner:synthetic-secret@localhost/dart_test'", "invalid-database-url"],
    ["https://owner:synthetic-secret@localhost/dart_test", "invalid-database-protocol"],
    ["postgresql://owner:***@localhost/dart_test", "missing-or-masked-database-password"],
    ["postgresql://owner:synthetic-secret@ep-live-pooler.example.neon.tech/dart_test", "pooled-database-url"],
  ])("reports a safe reason for unusable configuration without exposing %s", (databaseUrl, reason) => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/encrypted-database-backup.mjs", import.meta.url)),
      "create", "unused-test-backup.dump.enc",
    ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl, DART_BACKUP_ENCRYPTION_PASSWORD: password } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`stage=configuration, reason=${reason}`);
    expect(result.stderr).not.toContain(databaseUrl);
    expect(result.stderr).not.toContain("synthetic-secret");
    expect(result.stdout).toBe("");
  });
  it("round-trips a streamed archive and creates private encrypted and plaintext files", async () => {
    const f = await fixture();
    await f.decryptArchive(f.encrypted, f.decrypted, password);
    expect(Buffer.compare(await readFile(f.decrypted), f.source)).toBe(0);
    expect((await readFile(f.encrypted)).includes(Buffer.from("synthetic database content"))).toBe(false);
    expect((await stat(f.encrypted)).mode & 0o777).toBe(0o600);
    expect((await stat(f.decrypted)).mode & 0o777).toBe(0o600);
  }, 20000);
  it.each(["wrong password", "tampered ciphertext", "truncated archive"])("rejects %s and removes unverified plaintext", async (kind) => {
    const f = await fixture();
    let key = password;
    if (kind === "wrong password") key = "different-synthetic-password-32-characters";
    else {
      const bytes = await readFile(f.encrypted);
      if (kind === "tampered ciphertext") bytes[100] = bytes[100]! ^ 1;
      await writeFile(f.encrypted, kind === "truncated archive" ? bytes.subarray(0, 20) : bytes);
    }
    await expect(f.decryptArchive(f.encrypted, f.decrypted, key)).rejects.toThrow();
    await expect(stat(f.decrypted)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20000);
  it("does not overwrite or remove an existing target", async () => {
    const f = await fixture();
    await writeFile(f.decrypted, "preserve existing file");
    await expect(f.decryptArchive(f.encrypted, f.decrypted, password)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(f.decrypted, "utf8")).toBe("preserve existing file");
    const original = await readFile(f.encrypted);
    await expect(f.encryptArchive(f.archive, f.encrypted, password)).rejects.toMatchObject({ code: "EEXIST" });
    expect(Buffer.compare(await readFile(f.encrypted), original)).toBe(0);
  }, 20000);
});
