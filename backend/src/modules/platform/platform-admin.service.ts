import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export class PlatformAdminService {
  constructor(private readonly pool: Pool) {}

  async resetBusinessData(
    actorId: string,
    requestId: string,
  ): Promise<{ resetAt: string; deleted: Record<string, number> }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ownerResult = await client.query<{ is_owner: boolean }>(
        "SELECT is_owner FROM staff_users WHERE user_id=$1 FOR UPDATE",
        [actorId],
      );
      if (!ownerResult.rows[0]?.is_owner) {
        throw new AppError(
          403,
          "OWNER_REQUIRED",
          "Only the protected Dart owner account can reset platform data",
        );
      }

      const deleted: Record<string, number> = {};
      const remove = async (key: string, sql: string, values: unknown[] = []) => {
        const result = await client.query(sql, values);
        deleted[key] = result.rowCount ?? 0;
      };

      // Commerce/inventory first so account foreign keys remain valid until the end.
      await remove("orderEvents", "DELETE FROM order_events");
      await remove("orderItems", "DELETE FROM order_items");
      await remove("orders", "DELETE FROM orders");
      await remove("cartReservations", "DELETE FROM cart_reservations");
      await remove("inventoryItems", "DELETE FROM inventory_items");
      await remove("catalogModels", "DELETE FROM catalog_models");
      await remove("catalogAssets", "DELETE FROM catalog_assets");

      // Customer/representative operational data.
      await remove("customerPreferences", "DELETE FROM customer_preferences");
      await remove("representativeLocations", "DELETE FROM representative_locations");
      await remove("representativeDocuments", "DELETE FROM representative_documents");
      await remove(
        "passwordResetRequests",
        "DELETE FROM password_reset_requests WHERE account_type IN ('customer','representative')",
      );

      // Remove customer/representative identities while preserving Owner/Staff access.
      await remove("customers", "DELETE FROM customers");
      await remove("representatives", "DELETE FROM representatives");
      await remove(
        "customerRepresentativeUsers",
        "DELETE FROM users WHERE account_type IN ('customer','representative')",
      );

      // Integration/transient business state must not replay deleted data.
      await remove("outboxEvents", "DELETE FROM outbox_events");
      await remove("idempotencyKeys", "DELETE FROM idempotency_keys");

      // Reset JSON-backed dashboard domains but keep their rows/version history alive.
      const domainReset = await client.query(
        `UPDATE dashboard_domain_state
            SET data='[]'::jsonb,
                version=version+1,
                updated_by=$1,
                updated_at=now()`,
        [actorId],
      );
      deleted.dashboardDomainsReset = domainReset.rowCount ?? 0;

      const settingsReset = await client.query(
        `UPDATE site_settings
            SET data='{}'::jsonb,
                version=version+1,
                updated_by=$1,
                updated_at=now()
          WHERE id='main'`,
        [actorId],
      );
      deleted.siteSettingsReset = settingsReset.rowCount ?? 0;

      // Bump authoritative versions so every open browser invalidates stale caches.
      await client.query(
        `UPDATE domain_state_versions
            SET version=version+1,
                updated_at=now()
          WHERE domain IN ('catalog_inventory','orders')`,
      );

      // Business codes may safely restart because all matching business rows are gone.
      await client.query("ALTER SEQUENCE dart_customer_code_seq RESTART WITH 1");
      await client.query("ALTER SEQUENCE dart_representative_code_seq RESTART WITH 1");
      await client.query("ALTER SEQUENCE dart_order_code_seq RESTART WITH 1");
      await client.query("ALTER SEQUENCE dart_return_request_seq RESTART WITH 1");

      const resetAt = new Date().toISOString();
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_id, action, entity_type, entity_id,
           request_id, metadata
         ) VALUES ('staff',$1,'PLATFORM_BUSINESS_DATA_RESET','platform','dart',$2,$3::jsonb)`,
        [
          actorId,
          requestId,
          JSON.stringify({
            resetAt,
            deleted,
            preserved: [
              "staff_accounts",
              "owner_account",
              "roles",
              "permissions",
              "staff_sessions",
              "audit_logs",
              "schema_migrations",
            ],
          }),
        ],
      );

      await client.query("COMMIT");
      return { resetAt, deleted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
