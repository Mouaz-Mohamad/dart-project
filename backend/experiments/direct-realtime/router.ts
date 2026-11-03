// Local experimental endpoint only. HTTP/SSE both use Dart's actual access gates.
import { Router } from "express";
import type { RequestHandler } from "express";
import type { AppConfig } from "../../src/config/env.js";
import { AppError } from "../../src/http/app-error.js";
import { authenticate, requireAccountType, requireMfa, requirePermission } from "../../src/middleware/authentication.js";
import type { CommerceService } from "../../src/modules/commerce/commerce.service.js";
import type { IdentityService } from "../../src/modules/identity/identity.service.js";
import type { OrderSignal } from "../realtime-pilot/outbox.js";
import type { DirectOrderFeed } from "./notifications.js";

export function directPilotRouter(identity: IdentityService, commerce: CommerceService,
  config: Pick<AppConfig, "sessionCookieName">, feed: DirectOrderFeed,
  timing = { lifetimeMs: 240_000, heartbeatMs: 15_000, coalesceMs: 25 }) {
  const router = Router(), streamsBySession = new Map<string, number>();
  const access: RequestHandler[] = [authenticate(identity, config), requireAccountType("staff"), requireMfa, requirePermission("orders.read")];
  router.use(...access);
  router.use((_request, response, next) => { response.set("Cache-Control", "private, no-store"); next(); });
  router.get("/snapshot", async (_request, response) => response.json(await commerce.adminOrders()));
  router.get("/version", async (_request, response) => response.json({ version: await commerce.adminOrdersVersion() }));
  router.get("/events", async (request, response) => {
    const origin = request.get("origin");
    if (origin && origin !== `${request.protocol}://${request.get("host")}`) throw new AppError(403, "FORBIDDEN", "Stream origin is not allowed");
    const session = request.auth!.sessionId;
    if ((streamsBySession.get(session) || 0) >= 2) throw new AppError(429, "STREAM_LIMIT", "Too many open streams");
    streamsBySession.set(session, (streamsBySession.get(session) || 0) + 1);
    let closed = false, opened = false, flushing = false, cursor = 0;
    let latest: OrderSignal | null = null;
    let subscription: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer); clearTimeout(expiry); clearInterval(heartbeat);
      const remaining = (streamsBySession.get(session) || 1) - 1;
      if (remaining) streamsBySession.set(session, remaining); else streamsBySession.delete(session);
      subscription?.close();
      if (!opened && !response.headersSent && !response.destroyed) response.status(503).json({ code: "STREAM_UNAVAILABLE" });
      else response.end();
    };
    const authorize = async () => {
      for (const middleware of access) await new Promise<void>((resolve, reject) => {
        Promise.resolve(middleware(request, response, error => error ? reject(error) : resolve())).catch(reject);
      });
    };
    const write = (frame: string) => {
      if (closed || response.destroyed || response.writableEnded) return false;
      // Bounded slow consumer: reconnect + authoritative snapshot instead of queues.
      if (!response.write(frame)) { close(); return false; }
      return true;
    };
    const schedule = () => {
      if (closed || !opened || flushing || timer || !latest) return;
      timer = setTimeout(() => { timer = undefined; void flush(); }, timing.coalesceMs);
    };
    const flush = async () => {
      if (closed || flushing || !latest) return;
      flushing = true;
      try {
        await authorize(); // Re-read session and central permissions before every signal batch.
        const signal = latest; latest = null;
        if (signal && signal.version > cursor && write(`id: ${signal.version}\nevent: orders.changed\ndata: ${JSON.stringify(signal)}\n\n`)) cursor = signal.version;
      } catch { close(); }
      finally { flushing = false; schedule(); }
    };
    response.on("close", close);
    try {
      subscription = await feed.subscribe(signal => {
        if (!latest || signal.version > latest.version) latest = signal;
        schedule();
      }, close);
      if (closed) { subscription.close(); return; }
      response.set({ "Content-Type": "text/event-stream", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
      response.flushHeaders(); opened = true;
      // Every new/reconnected stream forces an HTTP snapshot. NOTIFY isn't durable replay.
      write("retry: 1000\nevent: ready\ndata: {}\n\n");
      schedule();
      heartbeat = setInterval(() => write(": keepalive\n\n"), timing.heartbeatMs);
      expiry = setTimeout(close, timing.lifetimeMs);
    } catch {
      if (!closed) { close(); }
    }
  });
  return router;
}
