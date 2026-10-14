import { describe, it, expect, vi, afterEach } from "vitest";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";
const wait = vi.hoisted(() => vi.fn());
vi.mock("@vercel/functions", () => ({ waitUntil: wait }));
import { dispatchOutbox } from "../src/modules/outbox/outbox.dispatch.js";
afterEach(() => { vi.unstubAllEnvs(); wait.mockClear(); });
describe("bounded durable delivery after the response", () => {
  it("registers unfinished delivery with Vercel and releases the request", async () => {
    vi.stubEnv("VERCEL", "1"); let done!: () => void;
    const pending = new Promise<void>((resolve) => { done=resolve; });
    const processBatch=vi.fn(() => pending), outbox={processBatch} as unknown as OutboxService;
    await dispatchOutbox(outbox,20);
    expect(processBatch).toHaveBeenCalledWith(10); expect(wait).toHaveBeenCalledOnce();
    done(); await wait.mock.calls[0]![0];
  });
  it("keeps the awaited standalone fallback and contains delivery failure", async () => {
    vi.stubEnv("VERCEL", "");
    const outbox={processBatch:vi.fn().mockRejectedValue(new Error("Synthetic provider unavailable"))} as unknown as OutboxService;
    await expect(dispatchOutbox(outbox,1)).resolves.toBeUndefined(); expect(wait).not.toHaveBeenCalled();
  });
});
