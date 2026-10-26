import { waitUntil } from "@vercel/functions";
import type { OutboxService } from "./outbox.service.js";

// Durable events are already committed. Vercel keeps this bounded task alive
// after the HTTP response; standalone Node retains the awaited fallback.
export async function dispatchOutbox(outbox: OutboxService | undefined, limit: number, deduplicationKey?: string): Promise<void> {
  if (!outbox) return;
  const task = (deduplicationKey ? outbox.processBatch(1, deduplicationKey) : outbox.processBatch(Math.min(10, Math.max(1, limit)))).catch(() => undefined);
  if (process.env.VERCEL) { waitUntil(task); return; }
  await task;
}
