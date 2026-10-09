// DART CODE GUIDE | backend/scripts/encrypted-database-backup.mjs
// الغرض: حفظ نسخة PostgreSQL مشفرة واختبار استعادتها في قاعدة منفصلة فقط.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createBackup, restoreBackupForVerification } from "./database-backup.mjs";

const MAGIC = Buffer.from("DARTBACKUP1");
const HEADER_SIZE = MAGIC.length + 16 + 12;
const TAG_SIZE = 16;

function keyFor(password, salt) {
  if (typeof password !== "string" || password.length < 32) {
    throw new Error("DART_BACKUP_ENCRYPTION_PASSWORD must contain at least 32 characters");
  }
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function encryptArchive(source, target, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const key = keyFor(password, salt);
  let created = false;
  try {
    const file = await open(target, "wx", 0o600);
    created = true;
    try { await file.writeFile(header); } finally { await file.close(); }
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: "a", mode: 0o600 }));
    await appendFile(target, cipher.getAuthTag());
  } catch (error) {
    if (created) await rm(target, { force: true });
    throw error;
  } finally { key.fill(0); }
}

export async function decryptArchive(source, target, password) {
  const file = await open(source, "r");
  let key;
  let created = false;
  try {
    const { size } = await file.stat();
    if (size <= HEADER_SIZE + TAG_SIZE) throw new Error("Encrypted backup is truncated");
    const header = Buffer.alloc(HEADER_SIZE);
    const tag = Buffer.alloc(TAG_SIZE);
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - TAG_SIZE);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unsupported encrypted backup format");
    key = keyFor(password, header.subarray(MAGIC.length, MAGIC.length + 16));
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length + 16));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const output = await open(target, "wx", 0o600);
    created = true;
    await output.close();
    await pipeline(
      createReadStream(source, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }),
      decipher,
      createWriteStream(target, { flags: "a", mode: 0o600 }),
    );
  } catch (error) {
    if (created) await rm(target, { force: true });
    throw error;
  } finally {
    key?.fill(0);
    await file.close();
  }
}

async function main() {
  const [command, filePath] = process.argv.slice(2);
  if (!["create", "restore-verify"].includes(command) || !filePath) {
    throw new Error("Usage: encrypted-database-backup.mjs create <output.dump.enc> | restore-verify <backup.dump.enc>");
  }
  const password = process.env.DART_BACKUP_ENCRYPTION_PASSWORD;
  if (!password || password.length < 32) throw new Error("DART_BACKUP_ENCRYPTION_PASSWORD must contain at least 32 characters");
  const target = resolve(filePath);
  const tempRoot = resolve(process.env.DART_BACKUP_TMP_ROOT || tmpdir());
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(tempRoot, "dart-backup-"));
  const archive = join(workspace, "database.dump");
  try {
    if (command === "create") {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await createBackup(archive);
      await encryptArchive(archive, target, password);
      process.stdout.write(`Encrypted PostgreSQL backup created (${(await stat(target)).size} bytes)\n`);
    } else {
      // Authentication must finish before any PostgreSQL restore process starts.
      await decryptArchive(target, archive, password);
      await restoreBackupForVerification(archive);
      process.stdout.write("Encrypted backup authenticated and restored into the isolated recovery database\n");
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "")) {
  main().catch(() => {
    process.stderr.write("Encrypted backup operation failed; no verified recovery result was produced\n");
    process.exitCode = 1;
  });
}
