// DART CODE GUIDE | backend/tests/version-alignment.test.ts
// الغرض: يمنع اختلاف نسخة الـBackend أو أنواع Node عن بيئة التشغيل الفعلية.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function text(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("backend version and Node runtime alignment", () => {
  it("keeps package, health runtime and OpenAPI on the same backend version", async () => {
    const packageJson = JSON.parse(await text("../package.json")) as { version: string };
    const appSource = await text("../src/app.ts");
    const openApi = await text("../openapi.yaml");

    expect(packageJson.version).toBe("0.6.2");
    expect(appSource).toContain(`version: "${packageJson.version}"`);
    expect(openApi).toContain(`version: ${packageJson.version}`);
  });

  it("keeps Node typings on the same major as the supported Node runtime", async () => {
    const packageJson = JSON.parse(await text("../package.json")) as {
      engines: { node: string };
      devDependencies: Record<string, string>;
    };
    const lock = JSON.parse(await text("../package-lock.json")) as {
      packages: Record<string, {
        version?: string;
        devDependencies?: Record<string, string>;
      }>;
    };

    expect(packageJson.engines.node).toBe(">=24 <25");
    expect(packageJson.devDependencies["@types/node"]).toMatch(/^24\./);
    expect(lock.packages[""]?.devDependencies?.["@types/node"]).toMatch(/^24\./);
    expect(lock.packages["node_modules/@types/node"]?.version).toMatch(/^24\./);
  });
});
