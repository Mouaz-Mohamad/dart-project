import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export class SiteSettingsService {
  public constructor(private readonly pool: Pool) {}

  public async get(): Promise<{ version: number; settings: Record<string, unknown> }> {
    const result = await this.pool.query<{ version: string; data: Record<string, unknown> }>(
      "SELECT version::text, data FROM site_settings WHERE id='main'",
    );
    const row = result.rows[0];
    return { version: Number(row?.version || 1), settings: row?.data || {} };
  }

  public async update(
    expectedVersion: number,
    settings: Record<string, unknown>,
    actorId: string,
    requestId: string,
  ): Promise<{ version: number; settings: Record<string, unknown> }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ version: string }>(
        "SELECT version::text FROM site_settings WHERE id='main' FOR UPDATE",
      );
      const version = Number(current.rows[0]?.version || 1);
      if (version !== expectedVersion) {
        throw new AppError(409, "SETTINGS_VERSION_CONFLICT", "Settings changed on another device; reload and retry");
      }
      const next = version + 1;
      await client.query(
        `UPDATE site_settings
            SET data=$1::jsonb, version=$2, updated_by=$3, updated_at=now()
          WHERE id='main'`,
        [JSON.stringify(settings), next, actorId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'SITE_SETTINGS_UPDATED','site_settings','main',$2,$3::jsonb)`,
        [actorId, requestId, JSON.stringify({ previousVersion: version, newVersion: next })],
      );
      await client.query("COMMIT");
      return { version: next, settings };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
