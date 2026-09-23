// DART CODE GUIDE | backend/src/modules/settings/site-settings.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { publicSiteSettings, siteSettingsSchema } from "./site-settings.schema.js";

export class SiteSettingsService {
  public constructor(private readonly pool: Pool) {}

  public async get(
    includePrivate = false,
  ): Promise<{ version: number; settings: Record<string, unknown> }> {
    const result = await this.pool.query<{ version: string; data: Record<string, unknown> }>(
      "SELECT version::text, data FROM site_settings WHERE id='main'",
    );
    const row = result.rows[0];
    const settings = row?.data || {};
    return {
      version: Number(row?.version || 1),
      settings: includePrivate ? settings : publicSiteSettings(settings),
    };
  }

  public async update(
    expectedVersion: number,
    settingsInput: Record<string, unknown>,
    actorId: string,
    requestId: string,
  ): Promise<{ version: number; settings: Record<string, unknown> }> {
    const parsedSettings = siteSettingsSchema.parse(settingsInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        version: string;
        data: Record<string, unknown>;
      }>(
        "SELECT version::text, data FROM site_settings WHERE id='main' FOR UPDATE",
      );
      const version = Number(current.rows[0]?.version || 1);
      if (version !== expectedVersion) {
        throw new AppError(409, "SETTINGS_VERSION_CONFLICT", "Settings changed on another device; reload and retry");
      }
      const currentSettings = current.rows[0]?.data || {};
      const currentCodRisk =
        currentSettings.codRisk &&
        typeof currentSettings.codRisk === "object" &&
        !Array.isArray(currentSettings.codRisk)
          ? currentSettings.codRisk as Record<string, unknown>
          : null;
      const incomingCodRisk =
        parsedSettings.codRisk &&
        typeof parsedSettings.codRisk === "object" &&
        !Array.isArray(parsedSettings.codRisk)
          ? parsedSettings.codRisk as Record<string, unknown>
          : null;
      const nextSettings: Record<string, unknown> = { ...parsedSettings };
      let codRiskPolicyVersion = Number(currentCodRisk?.version || 1);

      if (currentCodRisk && !incomingCodRisk) {
        // Keep the private COD policy when an older Settings UI sends only public keys.
        nextSettings.codRisk = currentCodRisk;
      } else if (incomingCodRisk) {
        const previousComparable = { ...(currentCodRisk || {}) };
        const incomingComparable = { ...incomingCodRisk };
        delete previousComparable.version;
        delete incomingComparable.version;
        const policyChanged = JSON.stringify(previousComparable) !== JSON.stringify(incomingComparable);
        codRiskPolicyVersion = currentCodRisk && policyChanged
          ? Number(currentCodRisk.version || 1) + 1
          : Number(currentCodRisk?.version || incomingCodRisk.version || 1);
        nextSettings.codRisk = {
          ...incomingCodRisk,
          version: Math.max(1, Math.round(codRiskPolicyVersion)),
        };
      }

      const next = version + 1;
      await client.query(
        `UPDATE site_settings
            SET data=$1::jsonb, version=$2, updated_by=$3, updated_at=now()
          WHERE id='main'`,
        [JSON.stringify(nextSettings), next, actorId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
         ) VALUES ('staff',$1,'SITE_SETTINGS_UPDATED','site_settings','main',$2,$3::jsonb)`,
        [
          actorId,
          requestId,
          JSON.stringify({
            previousVersion: version,
            newVersion: next,
            codRiskPolicyVersion,
            acceptedKeys: Object.keys(parsedSettings).sort(),
          }),
        ],
      );
      await client.query("COMMIT");
      return { version: next, settings: nextSettings };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
