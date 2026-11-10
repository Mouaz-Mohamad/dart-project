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

// Process every eligible device in bounded parallel workers. Each work item
// is already committed and protected by outbox attempts and SKIP LOCKED.
export async function dispatchAdminTestBroadcast(outbox: OutboxService | undefined, testId: string, deviceCount: number): Promise<void> {
  if(!outbox || !deviceCount)return;
  const workers=Math.min(4,Math.ceil(deviceCount/10));
  const task=Promise.all(Array.from({length:workers},async()=>{
    while(true){
      const result=await outbox.processBatch(10,undefined,testId);
      if(!result.claimed)break;
    }
  })).catch(()=>undefined);
  if(process.env.VERCEL){waitUntil(task);return;}
  await task;
}
