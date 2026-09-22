// DART CODE GUIDE | backend/src/modules/waiting/waiting.service.ts
// الغرض: منطق Waiting / Restock Reservation الخادمي؛ قاعدة البيانات هي مصدر الحقيقة.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

export interface JoinWaitingInput {
  modelId: string;
  size: string;
  color: string;
}

export type WaitingAdminAction =
  | "cancel"
  | "release"
  | "extend"
  | "resend"
  | "edit_request"
  | "offer_alternative"
  | "move_top"
  | "reset_priority"
  | "reassign";

export interface WaitingAdminActionInput {
  action: WaitingAdminAction;
  reason?: string;
  hours?: number;
  color?: string;
  size?: string;
  targetWaitlistId?: string;
  cancelPrevious?: boolean;
}

export interface WaitingAdminFilters {
  search?: string;
  modelId?: string;
  color?: string;
  size?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

interface WaitingSettings {
  enabled: boolean;
  reservationHours: number;
  alternativeColorsEnabled: boolean;
  emailNotificationEnabled: boolean;
  inSiteNotificationEnabled: boolean;
}

interface LockedEntry {
  id: string;
  customer_user_id: string;
  model_id: string;
  size: string;
  desired_color: string;
  allow_alternative_color: boolean;
  status: string;
  priority_override: string;
  requested_at: Date;
  notified_at: Date | null;
  reserved_until: Date | null;
}

interface LockedAllocation {
  id: string;
  waitlist_entry_id: string;
  inventory_item_id: string;
  cart_reservation_id: string | null;
  match_type: "exact" | "alternative_color";
  offered_color: string;
  status: string;
  notification_count: number;
  expires_at: Date;
  notified_at: Date;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function hours(value: unknown, fallback = 4): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(72, Math.max(1, Math.floor(parsed)))
    : fallback;
}

function normalizeSettings(raw: Record<string, unknown>): WaitingSettings {
  const waiting =
    raw.waiting && typeof raw.waiting === "object" && !Array.isArray(raw.waiting)
      ? (raw.waiting as Record<string, unknown>)
      : {};
  return {
    enabled: waiting.enabled !== false,
    reservationHours: hours(waiting.reservationHours, 4),
    alternativeColorsEnabled: waiting.alternativeColorsEnabled !== false,
    emailNotificationEnabled: waiting.emailNotificationEnabled !== false,
    inSiteNotificationEnabled: waiting.inSiteNotificationEnabled !== false,
  };
}

function pgCode(error: unknown): string {
  return text((error as { code?: unknown })?.code);
}

export class WaitingService {
  public constructor(private readonly pool: Pool) {}

  public async mine(
    customerUserId: string,
  ): Promise<{ entries: Array<Record<string, unknown>> }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const entries = await this.queryEntries(
        client,
        "w.customer_user_id=$1",
        [customerUserId],
        200,
        0,
      );
      await client.query("COMMIT");
      return { entries };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async join(
    customerUserId: string,
    input: JoinWaitingInput,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const settings = await this.settings(client);
      if (!settings.enabled) {
        throw new AppError(
          409,
          "WAITING_DISABLED",
          "Waiting is temporarily unavailable",
        );
      }

      const modelId = text(input.modelId);
      const size = text(input.size);
      const color = text(input.color);
      await this.validateVariant(client, modelId, size, color);

      const stock = await client.query<{ available: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM inventory_items
            WHERE model_id=$1
              AND size=$2
              AND color=$3
              AND active
              AND NOT is_archived
              AND NOT is_deleted
              AND lower(status)='in stock'
         ) AS available`,
        [modelId, size, color],
      );
      if (stock.rows[0]?.available) {
        throw new AppError(
          409,
          "STOCK_AVAILABLE",
          "This size and color is available now; add it to the cart instead",
        );
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO waitlist_entries (
           customer_user_id, model_id, size, desired_color, allow_alternative_color
         ) VALUES ($1,$2,$3,$4,$5)
         RETURNING id::text`,
        [
          customerUserId,
          modelId,
          size,
          color,
          settings.alternativeColorsEnabled,
        ],
      );
      const entryId = inserted.rows[0]!.id;

      await this.audit(client, {
        actorType: "customer",
        actorId: customerUserId,
        action: "WAITLIST_JOINED",
        entryId,
        requestId,
        newValues: { modelId, size, color },
        metadata: { fifo: true },
      });
      await this.bumpVersion(client);

      // Covers a stock race between the initial availability check and insert.
      await client.query(
        "SELECT dart_waitlist_try_allocate_entry($1,'customer',$2,'join_waiting',$3)",
        [entryId, customerUserId, requestId],
      );

      const entry = await this.entryById(client, entryId);
      await client.query("COMMIT");
      return entry;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (pgCode(error) === "23505") {
        throw new AppError(
          409,
          "WAITING_ALREADY_EXISTS",
          "You are already waiting for this design, size and color",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async cancelMine(
    customerUserId: string,
    entryId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const entry = await this.lockEntry(client, entryId);
      if (entry.customer_user_id !== customerUserId) {
        throw new AppError(404, "WAITING_NOT_FOUND", "Waiting entry not found");
      }
      if (entry.status === "converted") {
        throw new AppError(
          409,
          "WAITING_ALREADY_CONVERTED",
          "This Waiting entry already became an order",
        );
      }
      if (entry.status === "confirmed") {
        throw new AppError(
          409,
          "WAITING_ALREADY_CONFIRMED",
          "This item is already in your cart; remove it from the cart instead",
        );
      }
      if (entry.status === "cancelled") {
        const current = await this.entryById(client, entry.id);
        await client.query("COMMIT");
        return current;
      }

      const allocation = await this.liveAllocation(client, entry.id);
      if (allocation) {
        await client.query(
          `UPDATE waitlist_allocations
              SET status='cancelled',
                  released_at=now(),
                  release_reason='customer_cancelled',
                  version=version+1,
                  updated_at=now()
            WHERE id=$1`,
          [allocation.id],
        );
      }

      await client.query(
        `UPDATE waitlist_entries
            SET status='cancelled',
                cancelled_at=now(),
                reserved_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [entry.id],
      );

      if (allocation) {
        await this.releaseAllocatedItem(client, allocation);
      }

      await this.audit(client, {
        actorType: "customer",
        actorId: customerUserId,
        action: "WAITLIST_CANCELLED",
        entryId: entry.id,
        requestId,
        metadata: { hadReservation: Boolean(allocation) },
      });
      await this.bumpVersion(client);

      const current = await this.entryById(client, entry.id);
      await client.query("COMMIT");
      return current;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async confirmMine(
    customerUserId: string,
    entryId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const entry = await this.lockEntry(client, entryId);
      if (entry.customer_user_id !== customerUserId) {
        throw new AppError(404, "WAITING_NOT_FOUND", "Waiting entry not found");
      }
      if (entry.status === "confirmed") {
        const current = await this.entryById(client, entry.id);
        await client.query("COMMIT");
        return current;
      }
      if (entry.status !== "reserved") {
        throw new AppError(
          409,
          "WAITING_NOT_RESERVED",
          "There is no active reservation to confirm",
        );
      }

      const allocation = await this.liveAllocation(client, entry.id);
      if (
        !allocation ||
        allocation.status !== "active" ||
        allocation.expires_at.getTime() <= Date.now()
      ) {
        throw new AppError(
          409,
          "WAITING_RESERVATION_EXPIRED",
          "This Waiting reservation has expired",
        );
      }

      const normalCart = await client.query<{ id: string }>(
        `SELECT id
           FROM cart_reservations
          WHERE customer_user_id=$1
            AND source='cart'
            AND expires_at>now()
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE`,
        [customerUserId],
      );

      const targetCartId =
        normalCart.rows[0]?.id ||
        allocation.cart_reservation_id ||
        `CART-${randomUUID().replaceAll("-", "")}`;

      const expiry = await client.query<{ expires_at: Date }>(
        "SELECT now() + interval '15 minutes' AS expires_at",
      );
      const expiresAt = expiry.rows[0]!.expires_at;

      if (normalCart.rows[0]?.id) {
        await client.query(
          `UPDATE inventory_items
              SET cart_reservation_id=$2,
                  reservation_until=$3,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1
              AND lower(status)='cart reserved'`,
          [allocation.inventory_item_id, targetCartId, expiresAt],
        );
        await client.query(
          `UPDATE inventory_items
              SET reservation_until=$2,
                  version=version+1,
                  updated_at=now()
            WHERE cart_reservation_id=$1
              AND lower(status)='cart reserved'`,
          [targetCartId, expiresAt],
        );
        await client.query(
          `UPDATE cart_reservations
              SET expires_at=$2,
                  source='cart',
                  updated_at=now()
            WHERE id=$1`,
          [targetCartId, expiresAt],
        );
        if (
          allocation.cart_reservation_id &&
          allocation.cart_reservation_id !== targetCartId
        ) {
          await this.cleanupCart(client, allocation.cart_reservation_id);
        }
      } else if (allocation.cart_reservation_id) {
        await client.query(
          `UPDATE cart_reservations
              SET source='cart',
                  expires_at=$2,
                  updated_at=now()
            WHERE id=$1`,
          [allocation.cart_reservation_id, expiresAt],
        );
        await client.query(
          `UPDATE inventory_items
              SET reservation_until=$2,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1
              AND lower(status)='cart reserved'`,
          [allocation.inventory_item_id, expiresAt],
        );
      } else {
        await client.query(
          `INSERT INTO cart_reservations(
             id, customer_user_id, expires_at, pricing_snapshot, source
           ) VALUES ($1,$2,$3,'[]'::jsonb,'cart')`,
          [targetCartId, customerUserId, expiresAt],
        );
        await client.query(
          `UPDATE inventory_items
              SET cart_reservation_id=$2,
                  reservation_until=$3,
                  version=version+1,
                  updated_at=now()
            WHERE id=$1
              AND lower(status)='cart reserved'`,
          [allocation.inventory_item_id, targetCartId, expiresAt],
        );
      }

      await client.query(
        `UPDATE waitlist_allocations
            SET status='cart',
                cart_reservation_id=$2,
                expires_at=$3,
                confirmed_at=now(),
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [allocation.id, targetCartId, expiresAt],
      );
      await client.query(
        `UPDATE waitlist_entries
            SET status='confirmed',
                confirmed_at=now(),
                reserved_until=$2,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [entry.id, expiresAt],
      );

      await this.audit(client, {
        actorType: "customer",
        actorId: customerUserId,
        action: "WAITLIST_CONFIRMED",
        entryId: entry.id,
        requestId,
        newValues: {
          cartReservationId: targetCartId,
          expiresAt: expiresAt.toISOString(),
        },
      });
      await this.bumpVersion(client);

      const current = await this.entryById(client, entry.id);
      await client.query("COMMIT");
      return current;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async declineAlternative(
    customerUserId: string,
    entryId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const entry = await this.lockEntry(client, entryId);
      if (entry.customer_user_id !== customerUserId) {
        throw new AppError(404, "WAITING_NOT_FOUND", "Waiting entry not found");
      }

      const allocation = await this.liveAllocation(client, entry.id);
      if (
        !allocation ||
        allocation.status !== "active" ||
        allocation.match_type !== "alternative_color"
      ) {
        throw new AppError(
          409,
          "ALTERNATIVE_NOT_ACTIVE",
          "There is no active alternative-color offer",
        );
      }

      await client.query(
        `UPDATE waitlist_allocations
            SET status='declined',
                released_at=now(),
                release_reason='customer_declined_alternative',
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [allocation.id],
      );

      await client.query(
        `UPDATE waitlist_entries
            SET status='waiting',
                declined_alternative_colors=
                  CASE
                    WHEN declined_alternative_colors ? $2
                      THEN declined_alternative_colors
                    ELSE declined_alternative_colors || jsonb_build_array($2::text)
                  END,
                eligible_after=now()+interval '2 seconds',
                reserved_until=NULL,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [entry.id, allocation.offered_color],
      );

      await this.releaseAllocatedItem(client, allocation);
      await this.audit(client, {
        actorType: "customer",
        actorId: customerUserId,
        action: "WAITLIST_ALTERNATIVE_DECLINED",
        entryId: entry.id,
        requestId,
        metadata: { offeredColor: allocation.offered_color },
      });
      await this.bumpVersion(client);

      const current = await this.entryById(client, entry.id);
      await client.query("COMMIT");
      return current;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async version(): Promise<number> {
    const result = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='waiting'",
    );
    return Number(result.rows[0]?.version || 1);
  }

  public async adminList(
    filters: WaitingAdminFilters,
  ): Promise<{
    version: number;
    entries: Array<Record<string, unknown>>;
    demand: Array<Record<string, unknown>>;
    pagination: { limit: number; offset: number };
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      const where: string[] = ["1=1"];
      const params: unknown[] = [];
      const add = (condition: string, value: unknown) => {
        params.push(value);
        where.push(condition.replace("?", `$${params.length}`));
      };

      if (text(filters.search)) {
        params.push(`%${text(filters.search)}%`);
        const n = params.length;
        where.push(
          `(c.full_name ILIKE $${n}
            OR c.client_code ILIKE $${n}
            OR w.model_id ILIKE $${n}
            OR m.name ILIKE $${n}
            OR w.desired_color ILIKE $${n}
            OR w.size ILIKE $${n})`,
        );
      }
      if (text(filters.modelId)) add("w.model_id=?", text(filters.modelId));
      if (text(filters.color)) add("w.desired_color=?", text(filters.color));
      if (text(filters.size)) add("w.size=?", text(filters.size));
      if (text(filters.status)) {
        add("w.status=?", text(filters.status).toLowerCase());
      }
      if (text(filters.from)) add("w.requested_at>=?::date", text(filters.from));
      if (text(filters.to)) {
        add("w.requested_at<(?::date + interval '1 day')", text(filters.to));
      }

      const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
      const offset = Math.max(0, Number(filters.offset) || 0);

      const entries = await this.queryEntries(
        client,
        where.join(" AND "),
        params,
        limit,
        offset,
      );

      const demandResult = await client.query<{
        model_id: string;
        model_name: string;
        size: string;
        desired_color: string;
        waiting_count: string;
        reserved_count: string;
        confirmed_count: string;
        converted_count: string;
        expired_count: string;
        cancelled_count: string;
      }>(
        `SELECT w.model_id,
                COALESCE(m.name,w.model_id) AS model_name,
                w.size,
                w.desired_color,
                count(*) FILTER (WHERE w.status='waiting')::text AS waiting_count,
                count(*) FILTER (WHERE w.status='reserved')::text AS reserved_count,
                count(*) FILTER (WHERE w.status='confirmed')::text AS confirmed_count,
                count(*) FILTER (WHERE w.status='converted')::text AS converted_count,
                count(*) FILTER (WHERE w.status='expired')::text AS expired_count,
                count(*) FILTER (WHERE w.status='cancelled')::text AS cancelled_count
           FROM waitlist_entries w
           LEFT JOIN catalog_models m ON m.model_id=w.model_id
          GROUP BY w.model_id,m.name,w.size,w.desired_color
          ORDER BY
            count(*) FILTER (
              WHERE w.status IN ('waiting','reserved','confirmed')
            ) DESC,
            w.model_id,w.size,w.desired_color
          LIMIT 500`,
      );

      const demand = demandResult.rows.map((row) => {
        const converted = Number(row.converted_count || 0);
        const lost =
          Number(row.expired_count || 0) + Number(row.cancelled_count || 0);
        const settled = converted + lost;
        return {
          modelId: row.model_id,
          modelName: row.model_name,
          size: row.size,
          color: row.desired_color,
          waiting: Number(row.waiting_count || 0),
          reserved: Number(row.reserved_count || 0),
          confirmed: Number(row.confirmed_count || 0),
          converted,
          expired: Number(row.expired_count || 0),
          cancelled: Number(row.cancelled_count || 0),
          conversionRate: settled
            ? Math.round((converted / settled) * 1000) / 10
            : 0,
        };
      });

      const version = await this.versionWithClient(client);
      await client.query("COMMIT");
      return {
        version,
        entries,
        demand,
        pagination: { limit, offset },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminAudit(
    entryId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<{
      id: string;
      actor_type: string;
      actor_id: string | null;
      action: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
      metadata: Record<string, unknown>;
      request_id: string | null;
      occurred_at: Date;
    }>(
      `SELECT id::text,
              actor_type,
              actor_id::text,
              action,
              old_values,
              new_values,
              metadata,
              request_id,
              occurred_at
         FROM audit_logs
        WHERE entity_type='waitlist'
          AND entity_id=$1
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [entryId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      oldValues: row.old_values,
      newValues: row.new_values,
      metadata: row.metadata,
      requestId: row.request_id,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  public async reconcile(
    actorId: string,
    requestId: string,
  ): Promise<{ allocated: number; version: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      const items = await client.query<{ id: string }>(
        `SELECT id
           FROM inventory_items
          WHERE active
            AND NOT is_archived
            AND NOT is_deleted
            AND lower(status)='in stock'
          ORDER BY created_at,id
          FOR UPDATE SKIP LOCKED
          LIMIT 500`,
      );

      let allocated = 0;
      for (const item of items.rows) {
        const result = await client.query<{ allocation_id: string | null }>(
          "SELECT dart_waitlist_try_allocate_item($1)::text AS allocation_id",
          [item.id],
        );
        if (result.rows[0]?.allocation_id) allocated += 1;
      }

      await this.audit(client, {
        actorType: "staff",
        actorId,
        action: "WAITLIST_RECONCILED",
        entryId: "system",
        requestId,
        metadata: { allocated, inspected: items.rows.length },
      });

      const version = await this.versionWithClient(client);
      await client.query("COMMIT");
      return { allocated, version };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async adminAction(
    entryId: string,
    input: WaitingAdminActionInput,
    actorId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);

      const entry = await this.lockEntry(client, entryId);
      const reason = text(input.reason);
      if (input.action !== "resend" && reason.length < 3) {
        throw new AppError(
          422,
          "WAITING_REASON_REQUIRED",
          "A clear reason is required for this action",
        );
      }

      if (input.action === "cancel") {
        await this.adminCancel(client, entry, actorId, requestId, reason);
      } else if (input.action === "release") {
        await this.adminRelease(client, entry, actorId, requestId, reason);
      } else if (input.action === "extend") {
        await this.adminExtend(
          client,
          entry,
          actorId,
          requestId,
          reason,
          input.hours,
        );
      } else if (input.action === "resend") {
        await this.adminResend(client, entry, actorId, requestId);
      } else if (input.action === "edit_request") {
        await this.adminEdit(
          client,
          entry,
          actorId,
          requestId,
          reason,
          input,
        );
      } else if (input.action === "offer_alternative") {
        await this.adminOfferAlternative(
          client,
          entry,
          actorId,
          requestId,
          reason,
          input.color,
        );
      } else if (input.action === "move_top") {
        await this.adminPriority(
          client,
          entry,
          actorId,
          requestId,
          reason,
          true,
        );
      } else if (input.action === "reset_priority") {
        await this.adminPriority(
          client,
          entry,
          actorId,
          requestId,
          reason,
          false,
        );
      } else if (input.action === "reassign") {
        await this.adminReassign(
          client,
          entry,
          actorId,
          requestId,
          reason,
          input,
        );
      } else {
        throw new AppError(
          422,
          "WAITING_ACTION_INVALID",
          "Unsupported Waiting action",
        );
      }

      const current = await this.entryById(client, entry.id);
      await client.query("COMMIT");
      return current;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async adminCancel(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
  ): Promise<void> {
    if (["converted", "cancelled", "expired"].includes(entry.status)) {
      throw new AppError(
        409,
        "WAITING_STATUS_INVALID",
        "This Waiting entry can no longer be cancelled",
      );
    }

    const allocation = await this.liveAllocation(client, entry.id);
    if (allocation) {
      await client.query(
        `UPDATE waitlist_allocations
            SET status='cancelled',
                released_at=now(),
                release_reason=$2,
                version=version+1,
                updated_at=now()
          WHERE id=$1`,
        [allocation.id, reason],
      );
    }

    await client.query(
      `UPDATE waitlist_entries
          SET status='cancelled',
              cancelled_at=now(),
              reserved_until=NULL,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id],
    );

    if (allocation) {
      await this.releaseAllocatedItem(client, allocation);
    }

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_ADMIN_CANCELLED",
      entryId: entry.id,
      requestId,
      metadata: { reason },
    });
    await this.bumpVersion(client);
  }

  private async adminRelease(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
  ): Promise<void> {
    const allocation = await this.liveAllocation(client, entry.id);
    if (!allocation) {
      throw new AppError(
        409,
        "WAITING_RESERVATION_MISSING",
        "There is no live reservation to release",
      );
    }

    await client.query(
      `UPDATE waitlist_allocations
          SET status='released',
              released_at=now(),
              release_reason=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [allocation.id, reason],
    );

    await client.query(
      `UPDATE waitlist_entries
          SET status='waiting',
              eligible_after=now()+interval '2 seconds',
              reserved_until=NULL,
              confirmed_at=NULL,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id],
    );

    await this.releaseAllocatedItem(client, allocation);
    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_RESERVATION_RELEASED",
      entryId: entry.id,
      requestId,
      metadata: { reason, allocationId: allocation.id },
    });
    await this.bumpVersion(client);
  }

  private async adminExtend(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
    hoursInput: unknown,
  ): Promise<void> {
    const allocation = await this.liveAllocation(client, entry.id);
    if (!allocation || allocation.status !== "active") {
      throw new AppError(
        409,
        "WAITING_RESERVATION_MISSING",
        "Only an active Waiting reservation can be extended",
      );
    }

    const extension = hours(
      hoursInput,
      (await this.settings(client)).reservationHours,
    );
    const result = await client.query<{ expires_at: Date }>(
      `SELECT GREATEST($1::timestamptz,now())
              + make_interval(hours=>$2::int) AS expires_at`,
      [allocation.expires_at, extension],
    );
    const expiresAt = result.rows[0]!.expires_at;

    await client.query(
      `UPDATE waitlist_allocations
          SET expires_at=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [allocation.id, expiresAt],
    );
    await client.query(
      `UPDATE waitlist_entries
          SET reserved_until=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id, expiresAt],
    );
    await client.query(
      `UPDATE inventory_items
          SET reservation_until=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1
          AND lower(status)='cart reserved'`,
      [allocation.inventory_item_id, expiresAt],
    );
    if (allocation.cart_reservation_id) {
      await client.query(
        `UPDATE cart_reservations
            SET expires_at=GREATEST(expires_at,$2),
                updated_at=now()
          WHERE id=$1`,
        [allocation.cart_reservation_id, expiresAt],
      );
    }

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_RESERVATION_EXTENDED",
      entryId: entry.id,
      requestId,
      newValues: {
        expiresAt: expiresAt.toISOString(),
        extensionHours: extension,
      },
      metadata: { reason },
    });
    await this.bumpVersion(client);
  }

  private async adminResend(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
  ): Promise<void> {
    const allocation = await this.liveAllocation(client, entry.id);
    if (!allocation || allocation.status !== "active") {
      throw new AppError(
        409,
        "WAITING_RESERVATION_MISSING",
        "There is no active Waiting notification to resend",
      );
    }

    if (allocation.notified_at.getTime() > Date.now() - 5 * 60 * 1000) {
      throw new AppError(
        429,
        "WAITING_RESEND_TOO_SOON",
        "Wait at least five minutes before resending",
      );
    }

    const notificationCount =
      Number(allocation.notification_count || 1) + 1;

    await client.query(
      `UPDATE waitlist_allocations
          SET notification_count=$2,
              notified_at=now(),
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [allocation.id, notificationCount],
    );
    await client.query(
      `UPDATE waitlist_entries
          SET notified_at=now(),
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id],
    );

    await this.emitReservationNotification(
      client,
      allocation.id,
      notificationCount,
    );
    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_NOTIFICATION_RESENT",
      entryId: entry.id,
      requestId,
      metadata: {
        allocationId: allocation.id,
        notificationCount,
      },
    });
    await this.bumpVersion(client);
  }

  private async adminEdit(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
    input: WaitingAdminActionInput,
  ): Promise<void> {
    if (entry.status !== "waiting") {
      throw new AppError(
        409,
        "WAITING_STATUS_INVALID",
        "Release the reservation before changing the requested variant",
      );
    }

    const size = text(input.size || entry.size);
    const color = text(input.color || entry.desired_color);
    await this.validateVariant(client, entry.model_id, size, color);

    await client.query(
      `UPDATE waitlist_entries
          SET size=$2,
              desired_color=$3,
              requested_at=now(),
              eligible_after=now(),
              priority_override=0,
              declined_alternative_colors='[]'::jsonb,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id, size, color],
    );

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_REQUEST_EDITED",
      entryId: entry.id,
      requestId,
      oldValues: {
        size: entry.size,
        color: entry.desired_color,
      },
      newValues: { size, color },
      metadata: {
        reason,
        queuePositionReset: true,
      },
    });
    await this.bumpVersion(client);

    await client.query(
      "SELECT dart_waitlist_try_allocate_entry($1,'staff',$2,$3,$4)",
      [entry.id, actorId, reason, requestId],
    );
  }

  private async adminOfferAlternative(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
    colorInput: unknown,
  ): Promise<void> {
    if (entry.status !== "waiting") {
      throw new AppError(
        409,
        "WAITING_STATUS_INVALID",
        "An alternative can only be offered to a Waiting entry",
      );
    }

    const color = text(colorInput);
    if (!color || color === entry.desired_color) {
      throw new AppError(
        422,
        "ALTERNATIVE_COLOR_INVALID",
        "Choose a different available color",
      );
    }

    await this.validateVariant(client, entry.model_id, entry.size, color);

    const item = await client.query<{ id: string }>(
      `SELECT id
         FROM inventory_items
        WHERE model_id=$1
          AND size=$2
          AND color=$3
          AND active
          AND NOT is_archived
          AND NOT is_deleted
          AND lower(status)='in stock'
        ORDER BY created_at,id
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [entry.model_id, entry.size, color],
    );
    const itemId = item.rows[0]?.id;
    if (!itemId) {
      throw new AppError(
        409,
        "ALTERNATIVE_STOCK_UNAVAILABLE",
        "That alternative color is not in stock",
      );
    }

    const result = await client.query<{ allocation_id: string | null }>(
      `SELECT dart_waitlist_assign_item(
         $1,$2,'alternative_color','staff',$3,$4,$5
       )::text AS allocation_id`,
      [itemId, entry.id, actorId, reason, requestId],
    );
    if (!result.rows[0]?.allocation_id) {
      throw new AppError(
        409,
        "WAITING_ALLOCATION_RACE",
        "The item or Waiting entry changed; reload and try again",
      );
    }
  }

  private async adminPriority(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
    moveTop: boolean,
  ): Promise<void> {
    if (entry.status !== "waiting") {
      throw new AppError(
        409,
        "WAITING_STATUS_INVALID",
        "Only Waiting entries can change queue priority",
      );
    }

    const nextValue = moveTop
      ? Number(
          (
            await client.query<{ value: string }>(
              "SELECT nextval('waitlist_priority_seq')::text AS value",
            )
          ).rows[0]!.value,
        )
      : 0;

    await client.query(
      `UPDATE waitlist_entries
          SET priority_override=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [entry.id, nextValue],
    );

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: moveTop
        ? "WAITLIST_PRIORITY_MOVED_TOP"
        : "WAITLIST_PRIORITY_RESET",
      entryId: entry.id,
      requestId,
      oldValues: {
        priorityOverride: Number(entry.priority_override || 0),
      },
      newValues: { priorityOverride: nextValue },
      metadata: {
        reason,
        fifoOverride: moveTop,
      },
    });
    await this.bumpVersion(client);
  }

  private async adminReassign(
    client: PoolClient,
    entry: LockedEntry,
    actorId: string,
    requestId: string,
    reason: string,
    input: WaitingAdminActionInput,
  ): Promise<void> {
    const allocation = await this.liveAllocation(client, entry.id);
    if (!allocation) {
      throw new AppError(
        409,
        "WAITING_RESERVATION_MISSING",
        "There is no reserved piece to reassign",
      );
    }

    const targetId = text(input.targetWaitlistId);
    if (!targetId || targetId === entry.id) {
      throw new AppError(
        422,
        "WAITING_REASSIGN_TARGET_INVALID",
        "Choose another Waiting customer",
      );
    }

    const target = await this.lockEntry(client, targetId);
    if (target.status !== "waiting") {
      throw new AppError(
        409,
        "WAITING_TARGET_NOT_AVAILABLE",
        "The target customer is not currently Waiting",
      );
    }
    if (
      target.model_id !== entry.model_id ||
      target.size !== entry.size
    ) {
      throw new AppError(
        422,
        "WAITING_REASSIGN_VARIANT_INVALID",
        "Reassignment requires the same design and size",
      );
    }

    const itemResult = await client.query<{
      id: string;
      color: string;
      status: string;
    }>(
      `SELECT id,color,status
         FROM inventory_items
        WHERE id=$1
        FOR UPDATE`,
      [allocation.inventory_item_id],
    );
    const item = itemResult.rows[0];
    if (!item || item.status.toLowerCase() !== "cart reserved") {
      throw new AppError(
        409,
        "WAITING_ITEM_CHANGED",
        "The reserved physical item is no longer available",
      );
    }

    const settings = await this.settings(client);
    const matchType =
      target.desired_color === item.color
        ? "exact"
        : "alternative_color";

    if (
      matchType === "alternative_color" &&
      (
        !target.allow_alternative_color ||
        !settings.alternativeColorsEnabled
      )
    ) {
      throw new AppError(
        422,
        "WAITING_TARGET_COLOR_INVALID",
        "The target customer cannot receive an alternative color",
      );
    }

    const expiry = await client.query<{ expires_at: Date }>(
      "SELECT now()+make_interval(hours=>$1::int) AS expires_at",
      [settings.reservationHours],
    );
    const expiresAt = expiry.rows[0]!.expires_at;
    const targetCartId = `WAIT-${randomUUID().replaceAll("-", "")}`;

    await client.query(
      `INSERT INTO cart_reservations(
         id,customer_user_id,expires_at,pricing_snapshot,source
       ) VALUES ($1,$2,$3,'[]'::jsonb,'waitlist')`,
      [targetCartId, target.customer_user_id, expiresAt],
    );

    await client.query(
      `UPDATE waitlist_allocations
          SET status='reassigned',
              released_at=now(),
              release_reason=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [allocation.id, reason],
    );

    await client.query(
      `UPDATE waitlist_entries
          SET status=$2,
              cancelled_at=
                CASE WHEN $2='cancelled' THEN now() ELSE cancelled_at END,
              eligible_after=
                CASE WHEN $2='waiting'
                  THEN now()+interval '2 seconds'
                  ELSE eligible_after
                END,
              reserved_until=NULL,
              confirmed_at=NULL,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [
        entry.id,
        input.cancelPrevious ? "cancelled" : "waiting",
      ],
    );

    await client.query(
      `UPDATE inventory_items
          SET cart_reservation_id=$2,
              reservation_until=$3,
              version=version+1,
              updated_at=now()
        WHERE id=$1
          AND lower(status)='cart reserved'`,
      [allocation.inventory_item_id, targetCartId, expiresAt],
    );

    const newAllocation = await client.query<{ id: string }>(
      `INSERT INTO waitlist_allocations(
         waitlist_entry_id,
         inventory_item_id,
         cart_reservation_id,
         match_type,
         offered_color,
         status,
         expires_at
       ) VALUES ($1,$2,$3,$4,$5,'active',$6)
       RETURNING id::text`,
      [
        target.id,
        allocation.inventory_item_id,
        targetCartId,
        matchType,
        item.color,
        expiresAt,
      ],
    );
    const newAllocationId = newAllocation.rows[0]!.id;

    await client.query(
      `UPDATE waitlist_entries
          SET status='reserved',
              notified_at=now(),
              reserved_until=$2,
              version=version+1,
              updated_at=now()
        WHERE id=$1`,
      [target.id, expiresAt],
    );

    if (allocation.cart_reservation_id) {
      await this.cleanupCart(client, allocation.cart_reservation_id);
    }

    await this.emitReservationNotification(
      client,
      newAllocationId,
      1,
    );

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_RESERVATION_REASSIGNED",
      entryId: entry.id,
      requestId,
      oldValues: {
        allocationId: allocation.id,
        customerUserId: entry.customer_user_id,
      },
      newValues: {
        allocationId: newAllocationId,
        targetWaitlistId: target.id,
        customerUserId: target.customer_user_id,
      },
      metadata: {
        reason,
        cancelPrevious: Boolean(input.cancelPrevious),
        matchType,
      },
    });

    await this.audit(client, {
      actorType: "staff",
      actorId,
      action: "WAITLIST_RESERVATION_RECEIVED_MANUALLY",
      entryId: target.id,
      requestId,
      newValues: {
        allocationId: newAllocationId,
        itemId: allocation.inventory_item_id,
        expiresAt: expiresAt.toISOString(),
      },
      metadata: {
        reason,
        fromWaitlistId: entry.id,
        matchType,
      },
    });

    await this.bumpVersion(client);
  }

  private async emitReservationNotification(
    client: PoolClient,
    allocationId: string,
    notificationCount: number,
  ): Promise<void> {
    const result = await client.query<{
      waitlist_entry_id: string;
      match_type: "exact" | "alternative_color";
      offered_color: string;
      expires_at: Date;
      customer_user_id: string;
      model_id: string;
      size: string;
      desired_color: string;
      full_name: string;
      client_code: string;
      email: string;
      model_name: string;
    }>(
      `SELECT wa.waitlist_entry_id::text,
              wa.match_type,
              wa.offered_color,
              wa.expires_at,
              w.customer_user_id::text,
              w.model_id,
              w.size,
              w.desired_color,
              c.full_name,
              c.client_code,
              u.email,
              m.name AS model_name
         FROM waitlist_allocations wa
         JOIN waitlist_entries w
           ON w.id=wa.waitlist_entry_id
         JOIN customers c
           ON c.user_id=w.customer_user_id
         JOIN users u
           ON u.id=w.customer_user_id
         JOIN catalog_models m
           ON m.model_id=w.model_id
        WHERE wa.id=$1`,
      [allocationId],
    );
    const row = result.rows[0];
    if (!row) return;

    const settings = await this.settings(client);
    const eventType =
      row.match_type === "exact"
        ? "WAITLIST_STOCK_RESERVED"
        : "WAITLIST_ALTERNATIVE_RESERVED";

    if (settings.inSiteNotificationEnabled) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO notification_records(
           record_id,position,payload
         ) VALUES ($1,0,$2::jsonb)`,
        [
          id,
          JSON.stringify({
            id,
            type: eventType,
            title:
              row.match_type === "exact"
                ? "Your item is ready"
                : "Alternative color available",
            message:
              row.match_type === "exact"
                ? "قطعتك متاحة الآن وتم حجزها لك مؤقتًا."
                : "اللون المطلوب لسه غير متاح، لكن حجزنا لك لون بديل مؤقتًا.",
            timestamp: new Date().toISOString(),
            customerUserId: row.customer_user_id,
            clientId: row.client_code,
            relatedEntityType: "waiting",
            relatedEntityId: row.waitlist_entry_id,
            modelId: row.model_id,
            modelName: row.model_name,
            size: row.size,
            requestedColor: row.desired_color,
            availableColor: row.offered_color,
            expiresAt: row.expires_at.toISOString(),
            read: false,
            resolved: false,
          }),
        ],
      );
    }

    if (settings.emailNotificationEnabled && row.email) {
      await client.query(
        `INSERT INTO outbox_events(
           aggregate_type,
           aggregate_id,
           event_type,
           payload,
           deduplication_key
         ) VALUES ('waitlist',$1,$2,$3::jsonb,$4)
         ON CONFLICT(deduplication_key)
           WHERE deduplication_key IS NOT NULL
           DO NOTHING`,
        [
          row.waitlist_entry_id,
          eventType,
          JSON.stringify({
            channel: "email",
            to: row.email,
            expiresAt: row.expires_at.toISOString(),
            parameters: {
              customerName: row.full_name,
              modelId: row.model_id,
              modelName: row.model_name,
              size: row.size,
              requestedColor: row.desired_color,
              availableColor: row.offered_color,
              reservationHours: settings.reservationHours,
            },
          }),
          `waitlist.reserved:${allocationId}:${notificationCount}`,
        ],
      );
    }
  }

  private async releaseExpired(client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE inventory_items i
          SET status='In stock',
              cart_reservation_id=NULL,
              reservation_until=NULL,
              version=i.version+1,
              updated_at=now()
        WHERE lower(i.status)='cart reserved'
          AND i.reservation_until<=now()
          AND EXISTS (
            SELECT 1
              FROM waitlist_allocations wa
             WHERE wa.inventory_item_id=i.id
               AND wa.status IN ('active','confirmed','cart')
               AND wa.expires_at<=now()
          )`,
    );

    await client.query(
      `DELETE FROM cart_reservations cr
        WHERE cr.source='waitlist'
          AND cr.expires_at<=now()
          AND NOT EXISTS (
            SELECT 1
              FROM inventory_items i
             WHERE i.cart_reservation_id=cr.id
               AND lower(i.status)='cart reserved'
          )`,
    );
  }

  private async releaseAllocatedItem(
    client: PoolClient,
    allocation: LockedAllocation,
  ): Promise<void> {
    await client.query(
      `UPDATE inventory_items
          SET status='In stock',
              cart_reservation_id=NULL,
              reservation_until=NULL,
              version=version+1,
              updated_at=now()
        WHERE id=$1
          AND lower(status)='cart reserved'`,
      [allocation.inventory_item_id],
    );

    if (allocation.cart_reservation_id) {
      await this.cleanupCart(client, allocation.cart_reservation_id);
    }
  }

  private async cleanupCart(
    client: PoolClient,
    cartId: string,
  ): Promise<void> {
    const result = await client.query<{ expires_at: Date | null }>(
      `SELECT max(reservation_until) AS expires_at
         FROM inventory_items
        WHERE cart_reservation_id=$1
          AND lower(status)='cart reserved'`,
      [cartId],
    );
    const expiresAt = result.rows[0]?.expires_at || null;

    if (!expiresAt) {
      await client.query(
        "DELETE FROM cart_reservations WHERE id=$1",
        [cartId],
      );
      return;
    }

    await client.query(
      `UPDATE cart_reservations
          SET expires_at=$2,
              updated_at=now()
        WHERE id=$1`,
      [cartId, expiresAt],
    );
  }

  private async settings(
    client: PoolClient,
  ): Promise<WaitingSettings> {
    const result = await client.query<{
      data: Record<string, unknown>;
    }>(
      "SELECT data FROM site_settings WHERE id='main'",
    );
    return normalizeSettings(result.rows[0]?.data || {});
  }

  private async validateVariant(
    client: PoolClient,
    modelId: string,
    size: string,
    color: string,
  ): Promise<void> {
    const result = await client.query<{
      size_options:
        | Array<{ name?: string; active?: boolean }>
        | null;
      color_options:
        | Array<{ name?: string; active?: boolean }>
        | null;
    }>(
      `SELECT size_options,color_options
         FROM catalog_models
        WHERE model_id=$1
          AND active
          AND NOT is_archived
          AND NOT is_deleted
        FOR SHARE`,
      [modelId],
    );
    const model = result.rows[0];
    if (!model) {
      throw new AppError(
        404,
        "MODEL_NOT_FOUND",
        "Design not found",
      );
    }

    const sizeOk = (model.size_options || []).some(
      (option) =>
        text(option?.name) === size &&
        option?.active !== false,
    );
    const colorOk = (model.color_options || []).some(
      (option) =>
        text(option?.name) === color &&
        option?.active !== false,
    );

    if (!sizeOk || !colorOk) {
      throw new AppError(
        422,
        "WAITING_VARIANT_INVALID",
        "Choose a size and color that belong to this design",
      );
    }
  }

  private async lockEntry(
    client: PoolClient,
    entryId: string,
  ): Promise<LockedEntry> {
    const result = await client.query<LockedEntry>(
      `SELECT id::text,
              customer_user_id::text,
              model_id,
              size,
              desired_color,
              allow_alternative_color,
              status,
              priority_override::text,
              requested_at,
              notified_at,
              reserved_until
         FROM waitlist_entries
        WHERE id=$1
        FOR UPDATE`,
      [entryId],
    );

    if (!result.rows[0]) {
      throw new AppError(
        404,
        "WAITING_NOT_FOUND",
        "Waiting entry not found",
      );
    }
    return result.rows[0];
  }

  private async liveAllocation(
    client: PoolClient,
    entryId: string,
  ): Promise<LockedAllocation | null> {
    const result = await client.query<LockedAllocation>(
      `SELECT id::text,
              waitlist_entry_id::text,
              inventory_item_id,
              cart_reservation_id,
              match_type,
              offered_color,
              status,
              notification_count,
              expires_at,
              notified_at
         FROM waitlist_allocations
        WHERE waitlist_entry_id=$1
          AND status='active'
        ORDER BY allocated_at DESC
        LIMIT 1
        FOR UPDATE`,
      [entryId],
    );
    return result.rows[0] || null;
  }

  private async entryById(
    client: PoolClient,
    entryId: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.queryEntries(
      client,
      "w.id=$1",
      [entryId],
      1,
      0,
    );
    if (!rows[0]) {
      throw new AppError(
        404,
        "WAITING_NOT_FOUND",
        "Waiting entry not found",
      );
    }
    return rows[0];
  }

  private async queryEntries(
    client: PoolClient,
    whereSql: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await client.query<{
      id: string;
      customer_user_id: string;
      client_code: string;
      customer_name: string;
      model_id: string;
      model_name: string;
      size: string;
      desired_color: string;
      status: string;
      priority_override: string;
      requested_at: Date;
      notified_at: Date | null;
      reserved_until: Date | null;
      confirmed_at: Date | null;
      converted_at: Date | null;
      converted_order_code: string | null;
      cancelled_at: Date | null;
      queue_position: string | null;
      allocation_id: string | null;
      item_code: string | null;
      match_type: string | null;
      offered_color: string | null;
      allocation_status: string | null;
      allocation_expires_at: Date | null;
    }>(
      `SELECT w.id::text,
              w.customer_user_id::text,
              c.client_code,
              c.full_name AS customer_name,
              w.model_id,
              COALESCE(m.name,w.model_id) AS model_name,
              w.size,
              w.desired_color,
              w.status,
              w.priority_override::text,
              w.requested_at,
              w.notified_at,
              w.reserved_until,
              w.confirmed_at,
              w.converted_at,
              w.converted_order_code,
              w.cancelled_at,
              CASE WHEN w.status='waiting' THEN (
                SELECT (count(*)+1)::text
                  FROM waitlist_entries q
                 WHERE q.status='waiting'
                   AND q.eligible_after<=now()
                   AND q.model_id=w.model_id
                   AND q.size=w.size
                   AND q.desired_color=w.desired_color
                   AND (
                     q.priority_override>w.priority_override
                     OR (
                       q.priority_override=w.priority_override
                       AND (
                         q.requested_at<w.requested_at
                         OR (
                           q.requested_at=w.requested_at
                           AND q.id<w.id
                         )
                       )
                     )
                   )
              ) ELSE NULL END AS queue_position,
              a.id::text AS allocation_id,
              i.item_code,
              a.match_type,
              a.offered_color,
              a.status AS allocation_status,
              a.expires_at AS allocation_expires_at
         FROM waitlist_entries w
         JOIN customers c
           ON c.user_id=w.customer_user_id
         LEFT JOIN catalog_models m
           ON m.model_id=w.model_id
         LEFT JOIN LATERAL (
           SELECT wa.*
             FROM waitlist_allocations wa
            WHERE wa.waitlist_entry_id=w.id
            ORDER BY wa.allocated_at DESC
            LIMIT 1
         ) a ON true
         LEFT JOIN inventory_items i
           ON i.id=a.inventory_item_id
        WHERE ${whereSql}
        ORDER BY
          CASE
            WHEN w.status IN ('reserved','confirmed') THEN 0
            WHEN w.status='waiting' THEN 1
            ELSE 2
          END,
          w.priority_override DESC,
          w.requested_at,
          w.id
        LIMIT ${Math.min(200, Math.max(1, limit))}
        OFFSET ${Math.max(0, offset)}`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id,
      customerUserId: row.customer_user_id,
      clientCode: row.client_code,
      customerName: row.customer_name,
      modelId: row.model_id,
      modelName: row.model_name,
      size: row.size,
      color: row.desired_color,
      status: row.status,
      priorityOverride: Number(row.priority_override || 0),
      queuePosition:
        row.queue_position === null
          ? null
          : Number(row.queue_position),
      requestedAt: row.requested_at.toISOString(),
      notifiedAt: row.notified_at?.toISOString() || null,
      reservationExpiry:
        row.allocation_expires_at?.toISOString() ||
        row.reserved_until?.toISOString() ||
        null,
      confirmedAt: row.confirmed_at?.toISOString() || null,
      convertedAt: row.converted_at?.toISOString() || null,
      orderCode: row.converted_order_code,
      cancelledAt: row.cancelled_at?.toISOString() || null,
      allocation: row.allocation_id
        ? {
            id: row.allocation_id,
            itemCode: row.item_code,
            matchType: row.match_type,
            offeredColor: row.offered_color,
            status: row.allocation_status,
            expiresAt:
              row.allocation_expires_at?.toISOString() || null,
          }
        : null,
    }));
  }

  private async audit(
    client: PoolClient,
    input: {
      actorType:
        | "system"
        | "customer"
        | "staff"
        | "representative"
        | "api_client";
      actorId?: string | null;
      action: string;
      entryId: string;
      requestId?: string | null;
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs(
         actor_type,
         actor_id,
         action,
         entity_type,
         entity_id,
         request_id,
         old_values,
         new_values,
         metadata
       ) VALUES (
         $1,$2,$3,'waitlist',$4,$5,$6::jsonb,$7::jsonb,$8::jsonb
       )`,
      [
        input.actorType,
        input.actorId || null,
        input.action,
        input.entryId,
        input.requestId || null,
        input.oldValues
          ? JSON.stringify(input.oldValues)
          : null,
        input.newValues
          ? JSON.stringify(input.newValues)
          : null,
        JSON.stringify(input.metadata || {}),
      ],
    );
  }

  private async bumpVersion(
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `UPDATE domain_state_versions
          SET version=version+1,
              updated_at=now()
        WHERE domain='waiting'`,
    );
  }

  private async versionWithClient(
    client: PoolClient,
  ): Promise<number> {
    const result = await client.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain='waiting'",
    );
    return Number(result.rows[0]?.version || 1);
  }
}