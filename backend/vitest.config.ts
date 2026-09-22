// DART CODE GUIDE | backend/vitest.config.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
