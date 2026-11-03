import type { OrderSignal } from "../realtime-pilot/outbox.js";
import type { Subscription } from "../realtime-pilot/client.js";

export interface EventStream {
  addEventListener(name: string, fn: (event: { data?: string }) => void): void;
  close(): void;
}
// The real browser EventSource handles HTTP stream reconnects. No data polling.
export function subscribeToEvents(create: () => EventStream, receive: (signal: OrderSignal) => void,
  state: (connected: boolean) => void, startupMs = 7000): Promise<Subscription> {
  return new Promise((resolve, reject) => {
    const source = create(); let closed = false;
    const close = () => { if (!closed) { closed = true; clearTimeout(timeout); source.close(); state(false); } };
    const timeout = setTimeout(() => { close(); reject(new Error("Direct stream startup timed out")); }, startupMs);
    source.addEventListener("ready", () => {
      if (closed) return;
      clearTimeout(timeout); state(true); resolve({ close });
    });
    source.addEventListener("error", () => { if (!closed) state(false); });
    source.addEventListener("orders.changed", event => {
      if (closed) return;
      try {
        const signal = JSON.parse(event.data || "") as OrderSignal;
        if (/^[a-f0-9-]{36}$/.test(signal.id) && Number.isSafeInteger(signal.version) && signal.version > 0) receive(signal);
      } catch { /* An invalid signal never changes business data. */ }
    });
  });
}
