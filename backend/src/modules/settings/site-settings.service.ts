// DART CODE GUIDE | backend/src/modules/settings/site-settings.service.ts
// الغرض: منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";
import { publicSiteSettings, siteSettingsSchema } from "./site-settings.schema.js";
import { isDartCardEnabled, extendedDartCardExpiry } from "./dart-card-switch.js";

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
      const nextSettings: Record<string, unknown> = { ...currentSettings, ...parsedSettings };
      // Older Settings clients do not know about shipping companies.
      // Never drop carrier configuration when saving unrelated settings.
      if (!Object.prototype.hasOwnProperty.call(nextSettings, "shippingCompanies") &&
          Array.isArray(currentSettings.shippingCompanies)) {
        nextSettings.shippingCompanies = currentSettings.shippingCompanies;
      }
      if (!Object.prototype.hasOwnProperty.call(nextSettings, "blockedGovernorates") &&
          Array.isArray(currentSettings.blockedGovernorates)) {
        nextSettings.blockedGovernorates = currentSettings.blockedGovernorates;
      }
      // Older clients must not erase centrally configured storefront merchandising.
      if (!Object.prototype.hasOwnProperty.call(nextSettings, "storefrontProducts") &&
          currentSettings.storefrontProducts && typeof currentSettings.storefrontProducts === "object") {
        nextSettings.storefrontProducts = currentSettings.storefrontProducts;
      }
      const incomingShowcase = parsedSettings.storefrontProducts;
      if (incomingShowcase &&
          JSON.stringify(incomingShowcase.bestModelIds) !==
          JSON.stringify((currentSettings.storefrontProducts as {bestModelIds?: string[]}|undefined)?.bestModelIds || [])) {
        const ids = incomingShowcase.bestModelIds;
        if (ids.length) {
          const matches = await client.query<{ model_id: string }>(
            "SELECT model_id FROM catalog_models WHERE model_id=ANY($1::text[]) AND active AND NOT is_archived AND NOT is_deleted",
            [ids],
          );
          if (matches.rows.length !== ids.length) {
            throw new AppError(422, "BEST_PRODUCTS_INVALID_MODELS", "Choose existing active catalog models for Best Products");
          }
        }
      }
      // Older clients cannot erase configured durations by omitting newer keys.
      for (const key of ["exchangePeriodDays", "refundPeriodDays", "shippingFeePerOrder"] as const) {
        if (!(key in nextSettings) && key in currentSettings) nextSettings[key] = currentSettings[key];
      }

      // The switch is server-controlled; ignore client-supplied timestamps.
      const wasEnabled = isDartCardEnabled(currentSettings);
      const nowEnabled = parsedSettings.dartCardEnabled ?? wasEnabled;
      nextSettings.dartCardEnabled = nowEnabled;
      if (!nowEnabled) {
        nextSettings.dartCardPausedAt = wasEnabled
          ? new Date().toISOString()
          : currentSettings.dartCardPausedAt || new Date().toISOString();
        nextSettings.dartCardResumedAt = currentSettings.dartCardResumedAt || null;
      } else {
        nextSettings.dartCardPausedAt = null;
        nextSettings.dartCardResumedAt = wasEnabled
          ? currentSettings.dartCardResumedAt || null : new Date().toISOString();
        if (!wasEnabled) {
          const pausedAt = Date.parse(String(currentSettings.dartCardPausedAt || ""));
          if (Number.isFinite(pausedAt)) {
            const days = Math.ceil(Math.max(0, Date.now() - pausedAt) / 86_400_000);
            if (days > 0) {
              const cards = await client.query<{record_id: string;payload: Record<string, unknown>}>(
                "SELECT record_id,payload FROM loyalty_cards FOR UPDATE"
              );
              for (const card of cards.rows) {
                if (card.payload.status !== "Active" || card.payload.isDeleted || card.payload.isArchived) continue;
                const originalExpiry = String(card.payload.expDate || "");
                // A card already expired before suspension is not resurrected.
                if (originalExpiry.slice(0, 10) < new Date(pausedAt).toISOString().slice(0, 10)) continue;
                const expiry = extendedDartCardExpiry(originalExpiry, days);
                if (!expiry) continue;
                await client.query(
                  "UPDATE loyalty_cards SET payload=jsonb_set(payload,'{expDate}',to_jsonb($2::text),true) WHERE record_id=$1",
                  [card.record_id, expiry],
                );
              }
              await client.query(
                "UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='cards'",
              );
            }
          }
        }
      }
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
           actor_type, actor_id, action, entity_type, entity_id, request_id, metadata, old_values, new_values
         ) VALUES ('staff',$1,'SITE_SETTINGS_UPDATED','site_settings','main',$2,$3::jsonb,$4::jsonb,$5::jsonb)`,
        [
          actorId,
          requestId,
          JSON.stringify({
            previousVersion: version,
            newVersion: next,
            codRiskPolicyVersion,
            acceptedKeys: Object.keys(parsedSettings).sort(),
            shippingFee: { previous: currentSettings.shippingFeePerOrder ?? 100,
              next: nextSettings.shippingFeePerOrder ?? 100 },
          }),
          JSON.stringify(currentSettings),
          JSON.stringify(nextSettings),
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
