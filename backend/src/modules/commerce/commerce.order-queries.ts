// Read-only commerce projections; SQL and returned field shapes are preserved.
import type { Pool } from "pg";
import type { AdminOrdersState, AdminOrdersScope, AdminOrderRow } from "./commerce.types.js";

export async function readAdminOrdersVersion(pool: Pool): Promise<number> {
    const result = await pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
    );
    return Number(result.rows[0]?.version || 1);
  }

export async function readAdminOrders(pool: Pool, scope?: AdminOrdersScope): Promise<AdminOrdersState> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const versionResult = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain='orders'",
      );
      const version = Number(versionResult.rows[0]?.version || 1);
      if (scope && version !== scope.expectedVersion) {
        await client.query("COMMIT");
        return { version, orders: [], refreshRequired: true };
      }
      const result = await client.query<AdminOrderRow>(
        `SELECT o.*, c.client_code,
            c.cod_risk_level AS customer_cod_risk_level,
            c.cod_risk_score AS customer_cod_risk_score,
            c.cod_refusals_in_window AS customer_cod_refusals_in_window,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'orderId', history.order_code,
                  'refusedAt', history.refused_at,
                  'reason', history.reason
                )
                ORDER BY history.refused_at DESC
              )
                FROM (
                  SELECT refused.order_code,
                         COALESCE(
                           (
                             SELECT max(event.occurred_at)
                               FROM order_events event
                              WHERE event.order_id=refused.id
                                AND event.to_status='Refused'
                           ),
                           refused.updated_at
                         ) AS refused_at,
                         COALESCE(NULLIF(refused.legacy->>'refusalReason',''),'Other') AS reason
                    FROM orders refused
                   WHERE refused.customer_user_id=o.customer_user_id
                     AND o.customer_user_id IS NOT NULL
                     AND refused.status='Refused'
                     AND NOT refused.is_deleted
                   ORDER BY refused_at DESC
                   LIMIT 10
                ) history
            ), '[]'::jsonb) AS refusal_history,
            r.user_id::text AS representative_user_id,
            r.representative_code,
            r.full_name AS representative_name,
            (
              SELECT p.phone_display
                FROM account_phones p
               WHERE p.user_id=r.user_id
                 AND p.account_type='representative'
               ORDER BY p.is_primary DESC, p.created_at
               LIMIT 1
            ) AS representative_phone,
            rl.latitude AS courier_latitude,
            rl.longitude AS courier_longitude,
            rl.accuracy_meters AS courier_accuracy_meters,
            rl.updated_at AS courier_location_updated_at,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'itemId', oi.inventory_item_id,
                  'itemCode', oi.item_code,
                  'modelCode', oi.model_id,
                  'name', oi.model_name,
                  'color', oi.color,
                  'size', oi.size,
                  'qty', 1,
                  'originalUnitPrice', oi.original_unit_minor / 100.0,
                  'discountPercent', oi.discount_percent,
                  'discountAmount', (oi.original_unit_minor - oi.final_unit_minor) / 100.0,
                  'discountSource', oi.discount_source,
                  'discountReference', oi.discount_reference,
                  'finalUnitPrice', oi.final_unit_minor / 100.0,
                  'costSnapshot', oi.cost_snapshot_minor / 100.0
                )
                ORDER BY oi.created_at
              )
              FROM order_items oi
              WHERE oi.order_id=o.id
            ), '[]'::jsonb) AS item_rows
          FROM orders o
          LEFT JOIN customers c ON c.user_id=o.customer_user_id
          LEFT JOIN representatives r ON r.user_id=o.representative_user_id
          LEFT JOIN representative_locations rl ON rl.representative_user_id=r.user_id
          ${scope ? `WHERE o.id = ANY($1::uuid[])
             OR o.customer_user_id = ANY($2::uuid[])
             OR o.customer_user_id IN (
               SELECT changed.customer_user_id FROM orders changed
                WHERE changed.id = ANY($1::uuid[])
                  AND changed.customer_user_id IS NOT NULL
             )` : ""}
          ORDER BY o.created_at DESC, o.id DESC`,
        scope ? [scope.orderIds, scope.customerIds] : [],
      );
      await client.query("COMMIT");
      return {
        version,
        orders: result.rows.map((row) => {
          const legacy = row.legacy && typeof row.legacy === "object" ? row.legacy : {};
          const contact = row.contact_snapshot || {};
          const address = row.delivery_address || {};
          const snapshots = Array.isArray(row.item_rows) && row.item_rows.length
            ? row.item_rows
            : Array.isArray(legacy.priceSnapshot) ? legacy.priceSnapshot : [];
          return {
            ...legacy,
            id: row.id,
            orderId: row.order_code,
            status: row.status,
            riskLevel: row.cod_risk_level,
            riskScore: Number(row.cod_risk_score || 0),
            riskReasons: Array.isArray(row.cod_risk_reasons) ? row.cod_risk_reasons : [],
            riskPolicyVersion: Number(row.cod_risk_policy_version || 1),
            verificationRequired: Boolean(row.cod_verification_required),
            verificationStatus: row.cod_verification_status,
            verificationReason: row.cod_verification_reason || "",
            verifiedAt: row.cod_verified_at || null,
            customerRiskLevel: row.customer_cod_risk_level || row.cod_risk_level,
            customerRiskScore: Number(row.customer_cod_risk_score ?? row.cod_risk_score ?? 0),
            refusalsInWindow: Number(
              row.customer_cod_refusals_in_window ?? row.cod_refusals_in_window ?? 0,
            ),
            refusalHistory: Array.isArray(row.refusal_history) ? row.refusal_history : [],
            createdAt: row.created_at,
            orderCreatedAt: row.created_at,
            deliveredAt: row.delivered_at || legacy.deliveredAt,
            clientId: row.client_code || legacy.clientId || "",
            clientName: contact.name || legacy.clientName || "",
            phone1: contact.phone1 || legacy.phone1 || "",
            phone2: contact.phone2 || legacy.phone2 || "-",
            email: contact.email || legacy.email || "",
            items: snapshots.length ? snapshots.map((line) => line.itemCode) : legacy.items || [],
            totalProducts: snapshots.length ? snapshots.length : Number(legacy.totalProducts || 0),
            priceSnapshot: snapshots,
            totalPrice: Number(row.subtotal_minor || 0) / 100,
            orderLevelDiscountAmount: Number(row.order_discount_minor || 0) / 100,
            finalAmount: Number(row.final_minor || 0) / 100,
            deliveryCost: Number(row.delivery_cost_minor || 0) / 100,
            paymentMethod: row.payment_method,
            paymentStatus: row.payment_status,
            amountPaid: Number(row.amount_paid_minor || 0) / 100,
            amountRefunded: Number(row.amount_refunded_minor || 0) / 100,
            promotionType: row.promotion?.type || legacy.promotionType || "",
            birthdayRewardId: row.promotion?.type === "Birthday"
              ? String(row.promotion?.rewardId || legacy.birthdayRewardId || "")
              : String(legacy.birthdayRewardId || ""),
            dartCardId: row.promotion?.type === "Dart Card"
              ? String(row.promotion?.cardId || legacy.dartCardId || "")
              : String(legacy.dartCardId || ""),
            discount: Number(row.promotion?.percent || legacy.discount || 0),
            country: address.country || legacy.country || "",
            governorate: address.governorate || legacy.governorate || "",
            area: address.area || legacy.area || "",
            street: address.street || legacy.street || "",
            building: address.building || legacy.building || "",
            floor: address.floor || legacy.floor || "",
            latitude: address.latitude || legacy.latitude || "",
            longitude: address.longitude || legacy.longitude || "",
            fullAddress: address.fullAddress || legacy.fullAddress || "",
            addressSource: address.addressSource || legacy.addressSource || "",
            deliveryNotes: row.delivery_notes || legacy.deliveryNotes || "",
            orderSource: row.order_source || legacy.orderSource || "Website",
            representativeId: row.representative_user_id || "",
            representativeBusinessId: row.representative_code || "",
            representativeName: row.representative_name || "",
            representativePhone: row.representative_phone || "",
            deliveryStartedAt: row.delivery_started_at || legacy.deliveryStartedAt || null,
            courierLocation:
              row.status === "Representative On The Way" &&
              row.courier_latitude !== null &&
              row.courier_longitude !== null
                ? {
                    lat: row.courier_latitude,
                    lng: row.courier_longitude,
                    accuracy: row.courier_accuracy_meters,
                    updatedAt: row.courier_location_updated_at,
                  }
                : null,
            isArchived: row.is_archived,
            isDeleted: row.is_deleted,
            version: Number(row.version || 1),
          };
        }),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
