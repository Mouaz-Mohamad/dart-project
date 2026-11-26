import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { DEFAULT_INFRASTRUCTURE, infrastructureSchema, isQuietTime, estimateCompute } from "./infrastructure-policy.js";
import type { InfrastructureProviders } from "./infrastructure-providers.js";

export class InfrastructureService {
  private metrics = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: Pool, private readonly providers: InfrastructureProviders) {}
  async get() {
    const result = await this.pool.query<{ data: Record<string, unknown> }>("SELECT data FROM site_settings WHERE id='main'");
    const data = result.rows[0]?.data || {};
    const settings = infrastructureSchema.parse(data.infrastructure || DEFAULT_INFRASTRUCTURE);
    return { revision: Number(data.infrastructureRevision || 0), settings,
      schedulerConfigured: this.providers.schedulerConfigured(), estimate: estimateCompute(settings) };
  }
  async save(expectedRevision: number, input: unknown, actorId: string, requestId: string) {
    const settings = infrastructureSchema.parse(input), client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ data: Record<string, unknown> }>("SELECT data FROM site_settings WHERE id='main' FOR UPDATE");
      if (!result.rows[0]) throw new AppError(503, "SETTINGS_NOT_INITIALIZED", "Site settings are not initialized");
      const previous = result.rows[0].data;
      if (Number(previous.infrastructureRevision || 0) !== expectedRevision)
        throw new AppError(409, "INFRASTRUCTURE_CONFLICT", "Settings changed on another device; reload before saving");
      const revision = expectedRevision + 1;
      await client.query("UPDATE site_settings SET data=jsonb_set(jsonb_set(data,'{infrastructure}',$1::jsonb),'{infrastructureRevision}',$2::jsonb),version=version+1,updated_at=now(),updated_by=$3 WHERE id='main'",
        [JSON.stringify(settings), JSON.stringify(revision), actorId]);
      await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,old_values,new_values)
        VALUES('staff',$1,'INFRASTRUCTURE_SETTINGS_UPDATED','site_settings','main',$2,$3::jsonb,$4::jsonb)`,
      [actorId, requestId, JSON.stringify(previous.infrastructure || DEFAULT_INFRASTRUCTURE), JSON.stringify(settings)]);
      // Serialize publication with the row lock. A rejected publish rolls back the database change.
      // The worker's revision is checked before dispatch, so a rare COMMIT failure fails closed.
      await this.providers.publishSchedule(settings.schedule, revision);
      await client.query("COMMIT");
      return { revision, settings, schedulerConfigured: true, estimate: estimateCompute(settings) };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async automaticAllowed(revision: string | undefined, now = new Date()) {
    const current = await this.get();
    if (revision !== String(current.revision)) return { allowed: false, reason: "policy_revision_mismatch" };
    if (!current.settings.schedule.enabled) return { allowed: false, reason: "manual_only" };
    return { allowed: !isQuietTime(current.settings.schedule, now), reason: "quiet_hours" };
  }
  async auditManual(actorId: string, requestId: string) {
    await this.pool.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
      VALUES('staff',$1,'OUTBOX_MANUAL_PROCESS_REQUESTED','outbox','manual',$2,'{}'::jsonb)`, [actorId, requestId]);
  }
  async usage(kind: "database" | "hosting") {
    const cached = this.metrics.get(kind);
    if (cached && cached.expires > Date.now()) return cached.value;
    const running = this.pending.get(kind); if (running) return running;
    const task = (async () => {
      try {
        const value = await (kind === "database" ? this.providers.neon() : this.providers.hosting());
        this.metrics.set(kind, { expires: Date.now() + (kind === "database" ? 15 * 60_000 : 5 * 60_000), value }); return value;
      } catch { return { available: false, reason: "PROVIDER_UNAVAILABLE" }; }
      finally { this.pending.delete(kind); }
    })();
    this.pending.set(kind, task); return task;
  }
}
