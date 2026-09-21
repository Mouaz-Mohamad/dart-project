import { Router } from "express";

export interface HealthDependencies {
  databasePing: () => Promise<void>;
  startedAt: Date;
  version: string;
}

export function createHealthRouter(dependencies: HealthDependencies): Router {
  const router = Router();

  router.get("/live", (_request, response) => {
    response.status(200).json({
      status: "ok",
      service: "dart-backend",
      version: dependencies.version,
      apiCompatibility: "dart-database-v1",
      capabilities: [
        "database-authoritative-v1",
        "staff-onboarding-v1",
        "guest-cart-v1",
        "dashboard-domain-state-v1",
        "bulk-domain-state-v1",
        "catalog-assets-v1",
        "whatsapp-cloud-api-direct-v1",
      ],
      startedAt: dependencies.startedAt.toISOString(),
      uptimeSeconds: Math.max(
        0,
        Math.floor((Date.now() - dependencies.startedAt.getTime()) / 1000),
      ),
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_request, response) => {
    const started = performance.now();
    try {
      await dependencies.databasePing();
      const latencyMs = Math.max(0, Math.round((performance.now() - started) * 100) / 100);
      response.status(200).json({
        status: "ready",
        checks: {
          database: "up",
          databaseLatencyMs: latencyMs,
          databaseLatency: latencyMs >= 1000 ? "slow" : "ok",
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      response.status(503).json({
        status: "not_ready",
        checks: {
          database: "down",
          databaseLatencyMs: null,
          databaseLatency: "unavailable",
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
