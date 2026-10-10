import { describe, expect, it } from "vitest";

const moduleUrl = new URL("../../scripts/load-store.mjs", import.meta.url).href;
interface Options { baseUrl?: string; users?: number; duration?: number; maxRequests?: number; thinkMs?: number;
  profile?: string; cookie?: string; allowRemote?: boolean }
interface Report { requests: number; errors: number; p95Ms: number; passed: boolean; stopReason: string }
const { normalizeOptions, runLoad }: {
  normalizeOptions: (input: Options) => Options;
  runLoad: (input: Options, dependencies: { fetch: typeof fetch }) => Promise<Report>;
} = await import(moduleUrl);

describe("bounded read-only store load runner", () => {
  it("requires explicit remote testing, refuses embedded credentials and bounds users and requests", () => {
    for (const options of [{ baseUrl: "https://dart.example" }, { baseUrl: "http://dart.example", allowRemote: true },
      { baseUrl: "https://user:secret@dart.example", allowRemote: true }, { users: 51 }, { maxRequests: 2001 },
      { profile: "admin" }, { baseUrl: "https://dart.example", allowRemote: true, thinkMs: 0 }]) {
      expect(() => normalizeOptions(options)).toThrow();
    }
  });

  it("sends only fixed GET requests and reports latency, errors and bytes without leaking a session", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchRequest = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response('{"version":1,"orders":[]}', { status: 200 });
    }) as typeof fetch;
    const report = await runLoad({ users: 3, duration: 1, thinkMs: 0, maxRequests: 12, profile: "admin", cookie: "private-test-session" },
      { fetch: fetchRequest });
    expect(report).toMatchObject({ requests: 12, errors: 0, passed: true, stopReason: "request_limit" });
    expect(calls.every((call) => call.method === "GET" && call.url.startsWith("http://127.0.0.1:4000/api/v1/"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private-test-session");
  });

  it("stops issuing requests on rate limiting and never retries a write", async () => {
    let count = 0;
    const report = await runLoad({ users: 1, duration: 1, thinkMs: 0 }, { fetch: (async () => {
      count += 1; return new Response('{"error":{"code":"RATE_LIMITED"}}', { status: 429 });
    }) as typeof fetch });
    expect(count).toBe(1);
    expect(report).toMatchObject({ passed: false, stopReason: "rate_limited", errors: 1 });
  });

  it("does not count an HTML error page or a non-JSON response as success", async () => {
    const report = await runLoad({ users: 1, duration: 1, thinkMs: 0, maxRequests: 2 },
      { fetch: (async () => new Response("<html>Error</html>", { status: 200 })) as typeof fetch });
    expect(report).toMatchObject({ passed: false, errors: 2 });
  });
});
