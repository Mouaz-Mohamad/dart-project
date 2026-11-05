import { createHash } from "node:crypto";
import { Client } from "pg";
import type { AppConfig } from "../../config/env.js";

export interface ChangeSignal { scope: "version" | "domain"; name: string; version: number }
export interface ChangeConnection {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  on(event: string, callback: (...args: never[]) => void): unknown;
}
type Subscriber = { receive(signal: ChangeSignal): void; disconnected(): void };
export const CHANGE_MIGRATION = "0072_direct_change_signals.sql";

export function directListenerConnection(config: Pick<AppConfig, "databaseUrl" | "databaseSsl">): ChangeConnection {
  const url = new URL(config.databaseUrl);
  // LISTEN requires the matching direct endpoint, using the same database/role/TLS.
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  if (url.hostname.includes("-pooler")) throw new Error("Direct database listener required");
  if (config.databaseSsl) { url.searchParams.delete("sslmode"); url.searchParams.delete("uselibpqcompat"); }
  return new Client({ connectionString: url.toString(), ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    application_name: "dart-change-listener", connectionTimeoutMillis: 5000, query_timeout: 5000, keepAlive: true }) as unknown as ChangeConnection;
}

// One idle LISTEN connection per active instance. Stored versions handle reconnects.
export class ChangeFeed {
  private subscribers = new Set<Subscriber>();
  private connection: ChangeConnection | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;
  private ready = false;
  constructor(private readonly factory: () => ChangeConnection, private readonly capacity = 64) {}
  get subscriberCount() { return this.subscribers.size; }
  async subscribe(receive: Subscriber["receive"], disconnected: Subscriber["disconnected"]) {
    if (this.subscribers.size >= this.capacity) throw new Error("Change stream capacity reached");
    const subscriber = { receive, disconnected }; this.subscribers.add(subscriber);
    try { await this.ensureConnection(); }
    catch { this.subscribers.delete(subscriber); if (!this.subscribers.size) this.close(); throw new Error("Change stream unavailable"); }
    if (!this.ready || !this.subscribers.has(subscriber)) throw new Error("Change stream disconnected");
    return { close: () => { this.subscribers.delete(subscriber); if (!this.subscribers.size) this.close(); } };
  }
  private ensureConnection(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    const generation = ++this.generation, connection = this.factory(); this.connection = connection;
    const lost = () => { if (generation === this.generation) this.close(); };
    connection.on("error", lost); connection.on("end", lost);
    const operation = (async () => {
      try {
        await connection.connect();
        const result = await connection.query(`SELECT current_schema() AS schema, EXISTS(SELECT 1 FROM dart_schema_migrations WHERE name='${CHANGE_MIGRATION}') AS installed`);
        if (!result.rows[0]?.installed || typeof result.rows[0].schema !== "string") throw new Error("Change migration required");
        if (generation !== this.generation) return;
        const channel = "dart_changes_" + createHash("md5").update(result.rows[0].schema).digest("hex");
        connection.on("notification", ((notification: { channel: string; payload?: string }) => {
          if (!this.ready || generation !== this.generation || notification.channel !== channel || (notification.payload?.length || 0) > 512) return;
          try {
            const signal = JSON.parse(notification.payload || "") as ChangeSignal;
            if (!["version", "domain"].includes(signal.scope) || !/^[a-z_]{1,50}$/.test(signal.name) || !Number.isSafeInteger(signal.version) || signal.version < 1) return;
            for (const subscriber of this.subscribers) subscriber.receive({ scope: signal.scope, name: signal.name, version: signal.version });
          } catch { /* Invalid signals cannot update business state. */ }
        }) as (...args: never[]) => void);
        await connection.query(`LISTEN "${channel}"`);
        if (generation === this.generation) this.ready = true;
      } catch { lost(); throw new Error("Change listener unavailable"); }
      finally { if (generation === this.generation) this.starting = null; }
    })();
    this.starting = operation; return operation;
  }
  close() {
    this.generation++; this.ready = false; this.starting = null;
    const connection = this.connection; this.connection = null;
    const subscribers = [...this.subscribers]; this.subscribers.clear();
    for (const subscriber of subscribers) subscriber.disconnected();
    if (connection) void connection.end().catch(() => {});
  }
}
