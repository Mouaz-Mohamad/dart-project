// Isolated direct PostgreSQL/SSE experiment. Never imported by production.
import { Client } from "pg";
import type { Notification } from "pg";
import type { OrderSignal } from "../realtime-pilot/outbox.js";

export interface ListenConnection {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: "notification", fn: (notification: Notification) => void): unknown;
  on(event: "error" | "end", fn: () => void): unknown;
}
interface Subscriber { receive(signal: OrderSignal): void; disconnected(): void }

export function directConnection(connectionString: string): ListenConnection {
  const url = new URL(connectionString);
  if (url.hostname.includes("-pooler")) throw new Error("LISTEN requires an explicitly direct PostgreSQL connection");
  return new Client({ connectionString, application_name: "dart-direct-pilot-listener",
    connectionTimeoutMillis: 5000, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
}

export class DirectOrderFeed {
  private subscribers = new Set<Subscriber>();
  private connection: ListenConnection | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;
  private ready = false;
  readonly metrics = { connectionsOpened: 0, listenStatements: 0, notifications: 0 };

  constructor(private readonly factory: () => ListenConnection, readonly channel: string,
    private readonly maxSubscribers = 32) {
    if (!/^dart_pilot_orders_[a-f0-9]{32}$/.test(channel)) throw new Error("Isolated pilot channel required");
  }
  get subscriberCount() { return this.subscribers.size; }
  get connected() { return this.ready; }

  async subscribe(receive: Subscriber["receive"], disconnected: Subscriber["disconnected"]) {
    if (this.subscribers.size >= this.maxSubscribers) throw new Error("Pilot stream capacity reached");
    const subscriber = { receive, disconnected };
    this.subscribers.add(subscriber);
    try { await this.ensureConnection(); }
    catch { this.subscribers.delete(subscriber); throw new Error("Pilot database stream unavailable"); }
    if (!this.subscribers.has(subscriber) || !this.ready) throw new Error("Pilot database stream disconnected");
    return { close: () => { this.subscribers.delete(subscriber); if (!this.subscribers.size) this.close(); } };
  }

  private ensureConnection(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    const generation = ++this.generation;
    const connection = this.factory();
    this.connection = connection;
    const lost = () => { if (generation === this.generation) this.close(); };
    connection.on("error", lost); connection.on("end", lost);
    connection.on("notification", notification => {
      if (!this.ready || generation !== this.generation || notification.channel !== this.channel) return;
      try {
        const signal = JSON.parse(notification.payload || "") as OrderSignal;
        if (!/^[a-f0-9-]{36}$/.test(signal.id) || !Number.isSafeInteger(signal.version) || signal.version <= 0) return;
        this.metrics.notifications++;
        for (const subscriber of this.subscribers) subscriber.receive({ id: signal.id, version: signal.version });
      } catch { /* Invalid or oversized application signals never reach a client. */ }
    });
    const operation = (async () => {
      try {
        await connection.connect(); this.metrics.connectionsOpened++;
        if (generation !== this.generation) return;
        this.metrics.listenStatements++;
        await connection.query(`LISTEN "${this.channel}"`);
        if (generation === this.generation) this.ready = true;
      } catch { lost(); throw new Error("Pilot database stream unavailable"); }
      finally { if (generation === this.generation) this.starting = null; }
    })();
    this.starting = operation;
    return operation;
  }

  close() {
    this.generation++; this.ready = false; this.starting = null;
    const connection = this.connection; this.connection = null;
    const subscribers = [...this.subscribers]; this.subscribers.clear();
    for (const subscriber of subscribers) subscriber.disconnected();
    if (connection) void connection.end().catch(() => {});
  }
}
