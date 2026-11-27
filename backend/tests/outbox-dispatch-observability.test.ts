import { expect, it, vi } from "vitest";
import { dispatchOutbox } from "../src/modules/outbox/outbox.dispatch.js";
import type { OutboxService } from "../src/modules/outbox/outbox.service.js";
it("records background failures without leaking provider messages or losing retryable events", async () => {
  const log = vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const processBatch = vi.fn().mockRejectedValue(new Error("SECRET_TOKEN_AND_RECIPIENT"));
  try {
    await dispatchOutbox({processBatch} as unknown as OutboxService,1000);
    expect(processBatch).toHaveBeenCalledWith(10);
    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(log.mock.calls[0]![0] as string);
    expect(record.event).toBe("outbox_dispatch_failed");
    expect(record.incidentId).toBeTruthy();
    expect(JSON.stringify(record)).not.toContain("SECRET_TOKEN_AND_RECIPIENT");
  } finally { log.mockRestore(); }
});
