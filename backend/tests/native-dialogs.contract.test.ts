import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const nativeDialogPattern = /(?<![\w.$])(alert|confirm|prompt)\s*\(|(?:window|root)\.(alert|confirm|prompt)\s*\(/g;

function browserFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "backend", "node_modules", "tests"].includes(entry.name)) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...browserFiles(absolute));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".html")) output.push(absolute);
  }
  return output;
}

describe("Dart custom browser dialogs", () => {
  it("contains no native alert, confirm or prompt calls in browser code", () => {
    const offenders = browserFiles(repoRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      nativeDialogPattern.lastIndex = 0;
      return nativeDialogPattern.test(source) ? [file.replace(`${repoRoot}/`, "")] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("loads DartDialog before the storefront and dashboard runtimes", () => {
    const storefront = readFileSync(join(repoRoot, "cart-checkout.html"), "utf8");
    expect(storefront.indexOf('src="Js/dart-dialog.js"')).toBeGreaterThan(-1);
    expect(storefront.indexOf('src="Js/dart-dialog.js"')).toBeLessThan(
      storefront.indexOf('src="Js/dart-platform.js"'),
    );

    const dashboard = readFileSync(join(repoRoot, "Eye/Dart Eye.html"), "utf8");
    expect(dashboard.indexOf('src="../Js/dart-dialog.js"')).toBeGreaterThan(-1);
    expect(dashboard.indexOf('src="../Js/dart-dialog.js"')).toBeLessThan(
      dashboard.indexOf('src="dart-admin-auth.js"'),
    );
  });

  it("keeps checkout order success and failure messages unchanged", () => {
    const checkout = readFileSync(join(repoRoot, "Js/dart-ui.js"), "utf8");
    for (const message of [
      'showToast(`تم إنشاء الطلب ${order.orderId} بنجاح.`);',
      'showToast("لم يتم إنشاء الطلب. راجع الأسعار الجديدة في السلة.");',
      'showToast(retryError.message || "تعذر إنشاء الطلب بعد مراجعة السعر.");',
      'showToast(error.message || "تعذر إنشاء الطلب.");',
      'showToast("تم إتمام طلبك بنجاح! شكراً لك.");',
    ]) {
      expect(checkout).toContain(message);
    }
  });
});
