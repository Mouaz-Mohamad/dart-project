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
      ],
      startedAt: dependencies.startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_request, response) => {
    try {
      await dependencies.databasePing();
      response.status(200).json({
        status: "ready",
        checks: { database: "up" },
        timestamp: new Date().toISOString(),
      });
    } catch {
      response.status(503).json({
        status: "not_ready",
        checks: { database: "down" },
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
