import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const finance = readFileSync(new URL("../../Eye/dart-finance.js", import.meta.url), "utf8");
const orders = readFileSync(new URL("../../Eye/dart-orders-api.js", import.meta.url), "utf8");
const domains = readFileSync(new URL("../../Eye/dart-domain-state.js", import.meta.url), "utf8");
const operations = readFileSync(new URL("../../Eye/dart-operations-v4.js", import.meta.url), "utf8");
const siteSettings = readFileSync(new URL("../../Js/dart-site-settings.js", import.meta.url), "utf8");

describe("browser polling safety contracts", () => {
  it("does not start authoritative finance polling before admin authentication", () => {
    expect(finance).toContain('root.addEventListener("dart:admin-authenticated"');
    expect(finance).toContain("FINANCE_MAX_BACKOFF_MS = 300_000");
    expect(finance).not.toContain("root.setInterval(() =>");
  });

  it("gates Orders and dashboard-domain polling behind authentication", () => {
    expect(orders).toContain("if (!adminPollingEnabled || document.hidden) return");
    expect(domains).toContain("if (!adminPollingEnabled || document.hidden) return");
  });

  it("does not hydrate secure representatives from DOMContentLoaded", () => {
    const startup = operations.slice(operations.lastIndexOf("document.addEventListener('DOMContentLoaded'"));
    expect(startup).not.toContain("refreshSecureIdentityUi();");
    expect(operations).toContain("window.addEventListener('dart:admin-authenticated', refreshSecureIdentityUi)");
  });

  it("throttles public settings checks and supports conditional requests", () => {
    expect(siteSettings).toContain("SETTINGS_POLL_MS = 60_000");
    expect(siteSettings).toContain('"If-None-Match"');
    expect(siteSettings).toContain("response.status === 304");
  });
});
