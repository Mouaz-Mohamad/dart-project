// DART CODE GUIDE | backend/tests/internal-job-routes.contract.test.ts
// الغرض: يمنع رجوع Internal jobs التي تغيّر البيانات إلى GET ويحافظ على POST-only execution.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("internal state-changing job routes", () => {
  it("keeps outbox processing POST-only", async () => {
    const text = await source("../src/modules/outbox/outbox.routes.ts");
    expect(text).toContain('router.post("/internal/outbox/process", process);');
    expect(text).not.toContain('router.get("/internal/outbox/process"');
  });

  it("keeps the monthly Dart Card draw POST-only", async () => {
    const text = await source("../src/modules/loyalty/dart-card-draw.routes.ts");
    expect(text).toContain('router.post("/internal/dart-card/monthly-draw", runDue);');
    expect(text).not.toContain('router.get("/internal/dart-card/monthly-draw"');
  });
});
