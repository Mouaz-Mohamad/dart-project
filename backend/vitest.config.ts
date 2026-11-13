// DART CODE GUIDE | backend/vitest.config.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Embedded PostgreSQL suites allocate substantial WASM memory per worker.
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
