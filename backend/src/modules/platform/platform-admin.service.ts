// DART CODE GUIDE | backend/src/modules/platform/platform-admin.service.ts
// Owner-only reset of the nine requested business areas; unrelated configuration and staff data survive.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export class PlatformAdminService {
  constructor(private readonly pool: Pool) {}

  async resetBusinessData(
    actorId: string,
    requestId: string,
  ): Promise<{ resetAt: string; deleted: Record<string, number> }> {
    // Fail closed while Neon has no fresh verified recovery point.
    // Enable only after a successful backup/restore verification and Owner approval.
    if (process.env.DART_RESET_AFTER_BACKUP_ENABLED !== "true") {
      throw new AppError(
        423,
        "RESET_BACKUP_REQUIRED",
        "A current verified backup is required before permanent deletion",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");

      // Serialize simultaneous reset attempts (the public route also enforces staff MFA + CSRF).
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(764198316) AS acquired",
      );
      if (!lock.rows[0]?.acquired) {
        throw new AppError(409, "RESET_IN_PROGRESS", "Another data reset is already in progress");
      }

      const owner = await client.query<{ is_owner: boolean }>(
        "SELECT is_owner FROM staff_users WHERE user_id=$1 FOR UPDATE",
        [actorId],
      );
      if (!owner.rows[0]?.is_owner) {
        throw new AppError(403, "OWNER_REQUIRED", "Only the protected Dart owner can reset business data");
      }

      const deleted: Record<string, number> = {};
      const remove = async (key: string, sql: string, values: unknown[] = []) => {
        const result = await client.query(sql, values);
        deleted[key] = result.rowCount ?? 0;
      };

      // Cancel queued deliveries for deleted orders, waitlist reservations and customer logins.
      // Keep staff access, invitation and representative messages intact.
      await remove("outboxBusiness", `DELETE FROM outbox_events
         WHERE aggregate_type IN ('order', 'waitlist', 'customer', 'admin_notification')
            OR (aggregate_type='user' AND aggregate_id IN
                (SELECT id::text FROM users WHERE account_type='customer'))`);
      await remove("businessNotifications", `DELETE FROM notification_records
        WHERE related_entity_type IN
          ('items','orders','returns','waiting','finance:expenses','finance:settlements')`);
      await remove("customerMessages", `DELETE FROM message_records
        WHERE domain IN ('birthday_messages','message_queue')`);

      // Delete order-linked traffic before the orders FK clears its order_code.
      await remove("orderTrafficEvents", "DELETE FROM traffic_analytics_events WHERE order_code IS NOT NULL");

      // Expenses and order COD settlements belong to the reset. Preserve budgets, goals,
      // unrelated invoices, marketing records and finance audit trails.
      await remove("financeExpensesAndOrderSettlements", `DELETE FROM finance_records
        WHERE domain IN ('finance_expenses','finance_settlements')`);

      // News is removed before product images (news covers may reference catalog assets).
      await remove("newsArticles", "DELETE FROM news_articles");

      // Rewards and discounts that reference an order or customer must go first.
      await remove("dartCardDrawEvents", "DELETE FROM dart_card_draw_events");
      await remove("dartCardDrawWinners", "DELETE FROM dart_card_draw_winners");
      await remove("dartCardDraws", "DELETE FROM dart_card_draws");
      await remove("dartCards", "DELETE FROM loyalty_cards");
      await remove("birthdayRewards", "DELETE FROM birthday_rewards");
      await remove("birthdayDiscountUsage", "DELETE FROM birthday_discount_usage");
      await remove("promotionUsages", "DELETE FROM promotion_usages");
      await remove("manualCustomerDiscounts", "DELETE FROM customer_manual_discounts");

      // Set-specific order and cart dependencies (FK RESTRICT).
      await remove("setLoyaltyReturnedItems", "DELETE FROM set_loyalty_returned_items");
      await remove("setLoyaltyUsage", "DELETE FROM set_loyalty_usage");
      await remove("setLoyaltyCartReservations", "DELETE FROM set_loyalty_cart_reservations");
      await remove("orderSetComponents", "DELETE FROM order_set_components");
      await remove("orderSetGroups", "DELETE FROM order_set_groups");
      await remove("orderWhatsappReplies", "DELETE FROM order_whatsapp_replies");
      await remove("orderWhatsappConfirmations", "DELETE FROM order_whatsapp_confirmations");
      await remove("codVerificationEvents", "DELETE FROM cod_verification_events");

      // Returns and waiting reservations must be gone before deleting orders/inventory.
      await remove("returnRequests", "DELETE FROM return_requests");
      await remove("damageRecords", "DELETE FROM damage_records");
      await remove("waitlistAllocations", "DELETE FROM waitlist_allocations");
      await remove("waitlistEntries", "DELETE FROM waitlist_entries");
      await remove("setWaitingEntries", "DELETE FROM set_waiting_entries");
      await remove("deliveryRouteStops", "DELETE FROM delivery_route_stops");
      await remove("adminNotifications", "DELETE FROM admin_notifications");
      await client.query("UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='admin_notifications'");
      await remove("customerNotifications", "DELETE FROM customer_notifications");
      await remove("orderEvents", "DELETE FROM order_events");
      await remove("orderItems", "DELETE FROM order_items");
      await remove("orders", "DELETE FROM orders");

      await remove("cartSetComponents", "DELETE FROM cart_set_components");
      await remove("cartSetGroups", "DELETE FROM cart_set_groups");
      await remove("cartReservations", "DELETE FROM cart_reservations");
      await remove("catalogSetComponents", "DELETE FROM catalog_set_components");
      await remove("catalogSets", "DELETE FROM catalog_sets");
      await remove("inventoryItems", "DELETE FROM inventory_items");
      await remove("catalogModels", "DELETE FROM catalog_models");

      // Remove customer identities, sessions and consent; do not touch representative/staff accounts.
      await remove("customerSocialAuthChallenges", "DELETE FROM customer_social_auth_challenges");
      await remove("customerSocialIdentities", "DELETE FROM customer_social_identities");
      await remove("customerWhatsappPreferences", "DELETE FROM customer_whatsapp_preferences");
      await remove("customerPreferences", "DELETE FROM customer_preferences");
      await remove("webPushSubscriptions", "DELETE FROM web_push_subscriptions");
      await remove("customerPasswordResets", `DELETE FROM password_reset_requests
        WHERE account_type='customer'`);
      await remove("customerProfileDetails", "DELETE FROM customer_profile_details");
      await remove("customerContactPhones", "DELETE FROM customer_contact_phones");
      await remove("customerIdentityAliases", "DELETE FROM customer_identity_aliases");
      await remove("customerAddressHistory", "DELETE FROM customer_address_history");
      await remove("customerIdentityConflicts", "DELETE FROM customer_identity_conflicts");
      await remove("customers", "DELETE FROM customers");
      await remove("customerUsers", "DELETE FROM users WHERE account_type='customer'");

      // Remove customer/order-specific analytics and request replay markers, not general visitor analytics.
      await remove("idempotencyKeys", `DELETE FROM idempotency_keys WHERE scope LIKE 'order.%' OR scope LIKE 'return.%' OR scope LIKE 'cart.%' OR scope LIKE 'waitlist.%'`);

      // Reset only the legacy view domains that represent the selected nine areas.
      const viewDomains = [
        "customers", "returns", "damage", "cards", "birthday_rewards",
        "draw_audit", "finance_expenses", "finance_settlements",
        "birthday_messages", "message_queue", "notifications",
      ];
      const viewReset = await client.query(
        `UPDATE dashboard_domain_state
            SET data='[]'::jsonb, version=version+1, updated_by=$1, updated_at=now()
          WHERE domain=ANY($2::text[])`,
        [actorId, viewDomains],
      );
      deleted.dashboardDomainsReset = viewReset.rowCount ?? 0;

      // Keep ALL other site settings and branding (hero/founder images, WhatsApp,
      // Maps, shipping, permissions, etc.). Only old model-card IDs become invalid.
      const settings = await client.query(
        `UPDATE site_settings SET data=data-'modelCards', version=version+1,
          updated_by=$1, updated_at=now()
          WHERE id='main' AND data ? 'modelCards'`,
        [actorId],
      );
      deleted.modelCardSettingsCleared = settings.rowCount ?? 0;

      // Force active clients to refresh the catalog and order caches.
      await client.query(
        `UPDATE domain_state_versions SET version=version+1, updated_at=now()
         WHERE domain IN ('catalog_inventory','orders','waiting','sets','set_waiting')`,
      );

      // Keep stored image assets: some are used by the preserved site's branding.
      // Do not erase existing website analytics, staff, representatives, audit or configuration.
      await client.query("ALTER SEQUENCE dart_customer_code_seq RESTART WITH 1");
      await client.query("ALTER SEQUENCE dart_order_code_seq RESTART WITH 1");
      await client.query("ALTER SEQUENCE dart_return_request_seq RESTART WITH 1");

      const resetAt = new Date().toISOString();
      await client.query(
        `INSERT INTO audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, request_id, metadata
        ) VALUES ('staff',$1,'PLATFORM_BUSINESS_DATA_RESET','platform','dart',$2,$3::jsonb)`,
        [actorId, requestId, JSON.stringify({
          resetAt,
          deleted,
          scope: ["models", "items", "orders", "returns", "expenses", "waiting", "dart_card", "news", "customers"],
          preserved: ["staff", "representatives", "site_settings", "catalog_assets", "permissions", "analytics_visitors", "audit_logs"],
        })],
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
