import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function postgresEnvironment(connectionString, base = process.env) {
  if (!connectionString) throw new Error("DATABASE_URL is required to create a backup");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name");
  const env = {
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

export function defaultBackupPath(
  now = new Date(),
  cwd = process.cwd(),
) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return resolve(cwd, "backups", `dart-${stamp}.dump`);
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error(`${command} is not installed or not available on PATH`));
        return;
      }
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        new Error(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

export async function verifyBackup(filePath) {
  const target = resolve(filePath);
  const info = await stat(target);
  if (!info.isFile() || info.size <= 0) throw new Error("Backup file is empty or missing");
  await run("pg_restore", ["--list", target]);
  return { path: target, bytes: info.size };
}

function sameDatabase(left, right) {
  const normalize = (value) => {
    const url = new URL(value);
    return [
      url.hostname.toLowerCase(),
      url.port || "5432",
      decodeURIComponent(url.pathname.replace(/^\\//, "")),
      decodeURIComponent(url.username),
    ].join("|");
  };
  return normalize(left) === normalize(right);
}

function assertRecoveryDatabaseSafety(productionUrl, recoveryUrl) {
  if (!recoveryUrl) {
    throw new Error("DART_RECOVERY_DATABASE_URL is required for a restore drill");
  }
  if (sameDatabase(productionUrl, recoveryUrl)) {
    throw new Error("Refusing to restore into the production database");
  }
  const recovery = new URL(recoveryUrl);
  const name = decodeURIComponent(recovery.pathname.replace(/^\\//, ""));
  if (!/(?:recovery|restore|drill|test)/i.test(name)) {
    throw new Error(
      "Recovery database name must include recovery, restore, drill or test",
    );
  }
}

export async function restoreBackupForVerification(filePath) {
  const productionUrl = process.env.DATABASE_URL;
  const recoveryUrl = process.env.DART_RECOVERY_DATABASE_URL;
  if (!productionUrl) throw new Error("DATABASE_URL is required for restore safety checks");
  assertRecoveryDatabaseSafety(productionUrl, recoveryUrl);

  const verified = await verifyBackup(filePath);
  const env = postgresEnvironment(recoveryUrl);
  await run(
    "pg_restore",
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      env.PGDATABASE,
      verified.path,
    ],
    env,
  );
  return verified;
}

export async function createBackup(filePath = defaultBackupPath()) {
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true });
  const env = postgresEnvironment(process.env.DATABASE_URL);
  await run(
    "pg_dump",
    [
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      "--file",
      target,
    ],
    env,
  );
  return verifyBackup(target);
}

async function main() {
  const [command = "create", filePath] = process.argv.slice(2);
  if (command === "create") {
    const result = await createBackup(filePath);
    process.stdout.write(`Verified PostgreSQL backup: ${result.path} (${result.bytes} bytes)\n`);
    return;
  }
  if (command === "verify") {
    if (!filePath) throw new Error("verify requires a backup file path");
    const result = await verifyBackup(filePath);
    process.stdout.write(`Backup archive is readable: ${result.path} (${result.bytes} bytes)\n`);
    return;
  }
  if (command === "restore-verify") {
    if (!filePath) throw new Error("restore-verify requires a backup file path");
    const result = await restoreBackupForVerification(filePath);
    process.stdout.write(
      `Backup restored successfully into the isolated recovery database: ${result.path}\n`,
    );
    return;
  }
  throw new Error(
    "Usage: database-backup.mjs create [output.dump] | verify <backup.dump> | restore-verify <backup.dump>",
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Backup operation failed"}\n`);
    process.exitCode = 1;
  });
}
