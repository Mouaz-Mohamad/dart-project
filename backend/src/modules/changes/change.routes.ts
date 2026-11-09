import { Router, type RequestHandler } from "express";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { authenticate, requireAccountType, requireMfa, requireAnyPermission } from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import { FINANCE_DOMAIN_READ_GATE_PERMISSIONS, hasDomainPermission } from "../dashboard/dashboard-state.routes.js";
import { DASHBOARD_DOMAINS, type DashboardDomain } from "../dashboard/dashboard-state.service.js";
import type { ChangeFeed, ChangeSignal } from "./change-feed.js";

const CATALOG_READ = ["catalog.manage", "catalog.read", "inventory.manage"];
export function canReceiveChange(signal: ChangeSignal, permissions: string[], admin: boolean): boolean {
  if (!admin) return signal.scope === "version" && signal.name === "catalog_inventory";
  if (signal.scope === "version" && signal.name === "admin_notifications") return permissions.includes("notifications.read");
  if (signal.scope === "version") return signal.name === "orders" ? permissions.includes("orders.read")
    : signal.name === "catalog_inventory" && CATALOG_READ.some(permission => permissions.includes(permission));
  return DASHBOARD_DOMAINS.includes(signal.name as DashboardDomain) && hasDomainPermission(signal.name as DashboardDomain, "read", permissions);
}

export function createChangeRouter(feed: ChangeFeed, identity: IdentityService, config: Pick<AppConfig, "sessionCookieName" | "corsOrigins">,
  timing = { lifetimeMs: 240_000, heartbeatMs: 15_000, coalesceMs: 100 }) {
  const router = Router(), streams = new Map<string, number>();
  const gates: RequestHandler[] = [authenticate(identity, config), requireAccountType("staff"), requireMfa,
    requireAnyPermission("orders.read", ...CATALOG_READ, ...FINANCE_DOMAIN_READ_GATE_PERMISSIONS)];
  const stream = (admin: boolean): RequestHandler => async (request, response) => {
    const origin = request.get("origin");
    if (origin && origin !== `${request.protocol}://${request.get("host")}` && !config.corsOrigins.includes(origin)) throw new AppError(403, "ORIGIN_NOT_ALLOWED", "Stream origin is not allowed");
    const key = admin ? `staff:${request.auth!.sessionId}` : `public:${request.ip}`;
    if ((streams.get(key) || 0) >= 2) {
      // Saturation is a normal fallback state, including proxy-delayed disconnects.
      // Keep the resource limit without producing repeated browser HTTP errors.
      response.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      response.end('event: unavailable\ndata: {"retryMs":60000}\n\n');
      return;
    }
    streams.set(key, (streams.get(key) || 0) + 1);
    let closed = false, opened = false, flushing = false;
    let subscription: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
    const pending = new Map<string, ChangeSignal>();
    const close = () => {
      if (closed) return; closed = true;
      clearTimeout(timer); clearTimeout(expiry); clearInterval(heartbeat); pending.clear();
      const count = (streams.get(key) || 1) - 1; if (count) streams.set(key, count); else streams.delete(key);
      subscription?.close();
      if (!opened && !response.headersSent && !response.destroyed) response.status(503).json({ code: "STREAM_UNAVAILABLE" });
      else response.end();
    };
    const write = (frame: string) => {
      if (closed || response.destroyed || response.writableEnded) return false;
      if (!response.write(frame)) { close(); return false; }
      return true;
    };
    const schedule = () => {
      if (closed || !opened || flushing || timer || !pending.size) return;
      timer = setTimeout(() => { timer = undefined; void flush(); }, timing.coalesceMs);
    };
    const flush = async () => {
      if (closed || flushing) return; flushing = true;
      try {
        if (admin) for (const middleware of gates) await new Promise<void>((resolve, reject) => {
          Promise.resolve(middleware(request, response, error => error ? reject(error) : resolve())).catch(reject);
        });
        const signals = [...pending.values()]; pending.clear();
        for (const signal of signals) if (canReceiveChange(signal, request.auth?.permissions || [], admin)) {
          if (!write(`event: change\ndata: ${JSON.stringify(signal)}\n\n`)) break;
        }
      } catch { close(); }
      finally { flushing = false; schedule(); }
    };
    response.on("close", close);
    try {
      subscription = await feed.subscribe(signal => {
        if (!canReceiveChange(signal, request.auth?.permissions || [], admin)) return;
        const key = signal.scope + ":" + signal.name, previous = pending.get(key);
        if (!previous || signal.version > previous.version) pending.set(key, signal);
        schedule();
      }, close);
      if (closed) { subscription.close(); return; }
      response.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
      response.flushHeaders(); opened = true;
      write("retry: 3000\nevent: ready\ndata: {}\n\n"); schedule();
      heartbeat = setInterval(() => write(": keepalive\n\n"), timing.heartbeatMs);
      expiry = setTimeout(close, timing.lifetimeMs);
    } catch { close(); }
  };
  router.get("/catalog/changes", stream(false));
  router.get("/admin/changes", ...gates, stream(true));
  return router;
}
