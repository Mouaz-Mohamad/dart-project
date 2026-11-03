// Synthetic delivery service, never a substitute for a verified hosted broker.
import type { OrderSignal, Publisher } from "./outbox.js";
export class BrokerFixture implements Publisher {
  readonly messages: OrderSignal[] = [];
  private readonly delivered = new Set<string>();
  private readonly subscribers = new Set<{
    allowed: () => Promise<boolean>; receive: (signal: OrderSignal) => void; state: (connected: boolean) => void;
  }>();
  fail = false;
  connected = true;
  async subscribe(allowed: () => Promise<boolean>, receive: (signal: OrderSignal) => void, state: (connected: boolean) => void) {
    if (!await allowed()) throw new Error("Subscription denied");
    const subscriber = { allowed, receive, state };
    this.subscribers.add(subscriber); state(this.connected);
    return { close: () => { this.subscribers.delete(subscriber); } };
  }
  connection(connected: boolean) {
    this.connected = connected;
    for (const subscriber of this.subscribers) subscriber.state(connected);
  }
  async publish(signal: OrderSignal) {
    if (this.fail) throw new Error("Synthetic broker unavailable");
    if (this.delivered.has(signal.id)) return;
    this.delivered.add(signal.id); this.messages.push(signal);
    for (const subscriber of this.subscribers) {
      if (!await subscriber.allowed()) {
        this.subscribers.delete(subscriber); subscriber.state(false);
      } else if (this.connected) subscriber.receive(signal);
    }
  }
}
