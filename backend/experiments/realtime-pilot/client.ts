// Transport-neutral state machine. This experiment is not loaded by Dart pages.
import type { OrderSignal } from "./outbox.js";
export interface VersionedSnapshot { version: number }
export interface Subscription { close(): void }
export interface PilotSource<T extends VersionedSnapshot> {
  subscribe(receive: (signal: OrderSignal) => void, state: (connected: boolean) => void): Promise<Subscription>;
  snapshot(signal: AbortSignal): Promise<T>;
  apply(snapshot: T): void;
}
export class PilotClient<T extends VersionedSnapshot> {
  private epoch = 0;
  private active = false;
  private connected = false;
  private visible = true;
  private version = 0;
  private wanted = 0;
  private subscription: Subscription | null = null;
  private pending: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private again = false;
  private synchronized = false;
  constructor(private readonly source: PilotSource<T>, private readonly coalesceMs = 25) {}

  get healthy() { return this.active && this.connected && this.synchronized; }
  get appliedVersion() { return this.version; }

  async start() {
    this.stop();
    this.active = true;
    const epoch = this.epoch;
    // Subscribe before fetching: a write racing with the first snapshot is retained.
    const subscription = await this.source.subscribe(
      signal => { if (epoch === this.epoch) this.receive(signal); },
      connected => { if (epoch === this.epoch) this.connection(connected); },
    );
    if (epoch !== this.epoch) { subscription.close(); return; }
    this.subscription = subscription;
    await this.reconcile();
  }

  receive(signal: OrderSignal) {
    if (!this.active || !Number.isSafeInteger(signal.version) || signal.version <= this.version) return;
    this.wanted = Math.max(this.wanted, signal.version);
    if (this.visible && !this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wanted > this.version) void this.reconcile();
    }, this.coalesceMs);
  }

  connection(connected: boolean) {
    const reconnect = connected && !this.connected;
    this.connected = connected;
    if (!connected) this.synchronized = false;
    // An apparently healthy socket cannot prove an offline snapshot is current.
    if (reconnect && this.subscription && this.visible) void this.reconcile();
  }

  visibility(visible: boolean) {
    const resume = visible && !this.visible;
    this.visible = visible;
    if (resume && this.connected) return this.reconcile();
    return Promise.resolve();
  }

  reconcile(): Promise<void> {
    if (!this.active || !this.connected || !this.visible) return Promise.resolve();
    if (this.pending) { this.again = true; return this.pending; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const epoch = this.epoch;
    const abort = this.abort = new AbortController();
    const task = (async () => {
      try {
        let passes = 0;
        do {
          this.again = false;
          if (++passes > 3) throw new Error("Snapshot behind requested version");
          const snapshot = await this.source.snapshot(abort.signal);
          if (epoch !== this.epoch || !this.active || !this.connected) return;
          if (!Number.isSafeInteger(snapshot.version) || snapshot.version < this.version) throw new Error("Stale snapshot");
          this.source.apply(snapshot);
          this.version = snapshot.version;
          this.retry = 0;
        } while ((this.wanted > this.version || this.again) && epoch === this.epoch);
        this.synchronized = true;
      } catch {
        if (epoch !== this.epoch) return;
        this.synchronized = false;
        if (!this.timer) this.timer = setTimeout(() => {
          this.timer = null;
          void this.reconcile();
        }, Math.min(30_000, 500 * 2 ** Math.min(this.retry++, 6)));
      } finally {
        if (epoch === this.epoch) { this.pending = null; this.abort = null; }
      }
    })();
    this.pending = task;
    return task;
  }

  stop() {
    this.epoch++;
    this.active = this.connected = this.synchronized = false;
    this.abort?.abort(); this.abort = null;
    this.subscription?.close(); this.subscription = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.again = false; this.version = this.wanted = this.retry = 0;
  }
}
