// DART CODE GUIDE | backend/src/modules/sets/set-waiting.service.ts
// Whole-Set Waiting. A Set is allocated only when every selected physical piece can be locked together.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import type { SetCartService, SetSelectionInput } from "./set-cart.service.js";

export interface SetWaitingJoinInput {
  setId: string;
  selections: SetSelectionInput[];
}

type WaitingStatus = "waiting" | "reserved" | "confirmed" | "converted" | "expired" | "cancelled";

interface WaitingRow {
  id: string;
  customer_user_id: string;
  set_id: string;
  set_version: string;
  set_name_snapshot: string;
  set_image_snapshot: string;
  selections: SetSelectionInput[];
  piece_count: number;
  status: WaitingStatus;
  reserved_until: Date | null;
  cart_reservation_id: string | null;
  order_id: string | null;
  version: string;
  requested_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  converted_at: Date | null;
}

interface SetComponentRow {
  model_id: string;
  quantity: number;
  size_options: unknown;
  color_options: unknown;
}

function text(value: unknown): string { return String(value || "").trim(); }
function optionActive(options: unknown, value: string): boolean {
  return Array.isArray(options) && options.some((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return text(row.name) === value && row.active !== false;
  });
}
function firstImage(images: unknown): string {
  return Array.isArray(images) ? text(images.find((value) => text(value))) : "";
}

export class SetWaitingService {
  public constructor(
    private readonly pool: Pool,
    private readonly setCart: SetCartService,
  ) {}

  public async mine(customerUserId: string): Promise<{ entries: Record<string, unknown>[] }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client, customerUserId);
      const waiting = await client.query<{ id: string }>(
        `SELECT id::text FROM set_waiting_entries
          WHERE customer_user_id=$1 AND status='waiting'
          ORDER BY requested_at,id
          FOR UPDATE SKIP LOCKED
          LIMIT 100`,
        [customerUserId],
      );
      for (const row of waiting.rows) {
        const entry = await this.lockEntry(client, row.id);
        await this.tryAllocate(client, entry).catch((error) => {
          if (error instanceof AppError && [404,409,422].includes(error.statusCode)) return;
          throw error;
        });
      }
      const rows = await this.listRows(client, customerUserId);
      await client.query("COMMIT");
      return { entries: rows.map((row) => this.publicEntry(row)) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  public async join(
    customerUserId: string,
    input: SetWaitingJoinInput,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client, customerUserId);
      const setId = text(input.setId);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:set-wait:${customerUserId}:${setId}`]);
      const definition = await this.loadDefinition(client, setId);
      const selections = this.validateSelections(definition.components, input.selections || []);
      const available = await this.pickAll(client, selections, false);
      if (available.length === selections.length) {
        throw new AppError(409, "SET_STOCK_AVAILABLE", "This Set is available now; add it to the cart instead");
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO set_waiting_entries(
           customer_user_id,set_id,set_version,set_name_snapshot,set_image_snapshot,selections,piece_count,status
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'waiting')
         RETURNING id::text`,
        [customerUserId,setId,definition.version,definition.name,definition.image,JSON.stringify(selections),selections.length],
      );
      const entry = await this.lockEntry(client, inserted.rows[0]!.id);
      await this.tryAllocate(client, entry);
      await this.audit(client,"customer",customerUserId,"SET_WAITING_JOINED",entry.id,requestId,{setId,pieceCount:selections.length});
      await this.bumpVersion(client);
      const current = await this.lockEntry(client, entry.id);
      await client.query("COMMIT");
      return this.publicEntry(current);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string })?.code === "23505") {
        throw new AppError(409,"SET_WAITING_ALREADY_EXISTS","You are already waiting for this Set selection");
      }
      throw error;
    } finally { client.release(); }
  }

  public async cancelMine(customerUserId: string, entryId: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const entry = await this.lockEntry(client, entryId);
      if (entry.customer_user_id !== customerUserId) throw new AppError(404,"SET_WAITING_NOT_FOUND","Set Waiting entry not found");
      if (entry.status === "converted") throw new AppError(409,"SET_WAITING_CONVERTED","This Set Waiting entry already became an order");
      if (entry.status === "confirmed") throw new AppError(409,"SET_WAITING_IN_CART","This Set is already in your cart; remove the Set from the cart instead");
      if (entry.status !== "cancelled") {
        await this.releaseReservation(client, entry.cart_reservation_id);
        await client.query(
          `UPDATE set_waiting_entries
              SET status='cancelled',cart_reservation_id=NULL,reserved_until=NULL,cancelled_at=now(),updated_at=now(),version=version+1
            WHERE id=$1`,[entry.id],
        );
        await this.audit(client,"customer",customerUserId,"SET_WAITING_CANCELLED",entry.id,requestId,{});
        await this.bumpVersion(client);
      }
      const current = await this.lockEntry(client, entry.id);
      await client.query("COMMIT");
      return this.publicEntry(current);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined); throw error;
    } finally { client.release(); }
  }

  public async confirmMine(customerUserId: string, entryId: string, requestId: string) {
    // Attach the immutable Set pricing snapshot to the already-held physical pieces first.
    // If the second transaction races with cancellation/expiry it safely fails and the Set group is cascade-cleaned with the reservation.
    const preview = await this.pool.query<WaitingRow>(
      `SELECT id::text,customer_user_id::text,set_id,set_version::text,set_name_snapshot,set_image_snapshot,
              selections,piece_count,status,reserved_until,cart_reservation_id,order_id::text,version::text,
              requested_at,updated_at,cancelled_at,converted_at
         FROM set_waiting_entries WHERE id=$1`,[entryId],
    );
    const before = preview.rows[0];
    if (!before || before.customer_user_id !== customerUserId) throw new AppError(404,"SET_WAITING_NOT_FOUND","Set Waiting entry not found");
    if (before.status === "confirmed") return this.publicEntry(before);
    if (before.status !== "reserved" || !before.cart_reservation_id || !before.reserved_until || before.reserved_until.getTime() <= Date.now()) {
      throw new AppError(409,"SET_WAITING_NOT_RESERVED","There is no active complete Set reservation to confirm");
    }
    await this.setCart.attachGroups(
      before.cart_reservation_id,
      [{ setId: before.set_id, unitIndex: 1, selections: before.selections }],
      customerUserId,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:set-wait-entry:${entryId}`]);
      const entry = await this.lockEntry(client, entryId);
      if (entry.customer_user_id !== customerUserId || entry.status !== "reserved" || !entry.cart_reservation_id) {
        throw new AppError(409,"SET_WAITING_CHANGED","Set Waiting changed while it was being confirmed; refresh and retry");
      }
      const expiry = await client.query<{ expires_at: Date }>("SELECT now()+interval '15 minutes' AS expires_at");
      const expiresAt = expiry.rows[0]!.expires_at;
      await client.query(
        `UPDATE cart_reservations SET source='cart',expires_at=$2,updated_at=now() WHERE id=$1`,
        [entry.cart_reservation_id,expiresAt],
      );
      await client.query(
        `UPDATE inventory_items SET reservation_until=$2,version=version+1,updated_at=now()
          WHERE cart_reservation_id=$1 AND lower(status)='cart reserved'`,
        [entry.cart_reservation_id,expiresAt],
      );
      await client.query(
        `UPDATE set_waiting_entries
            SET status='confirmed',reserved_until=$2,updated_at=now(),version=version+1
          WHERE id=$1`,[entry.id,expiresAt],
      );
      await this.audit(client,"customer",customerUserId,"SET_WAITING_CONFIRMED",entry.id,requestId,{reservationId:entry.cart_reservation_id});
      await this.bumpVersion(client);
      const current = await this.lockEntry(client,entry.id);
      await client.query("COMMIT");
      return this.publicEntry(current);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined); throw error;
    } finally { client.release(); }
  }

  public async reconcile(actorId: string, requestId: string): Promise<{ allocated: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.releaseExpired(client);
      const rows = await client.query<{ id: string }>(
        `SELECT id::text FROM set_waiting_entries WHERE status='waiting'
          ORDER BY requested_at,id FOR UPDATE SKIP LOCKED LIMIT 500`,
      );
      let allocated = 0;
      for (const row of rows.rows) {
        const entry = await this.lockEntry(client,row.id);
        if (await this.tryAllocate(client,entry)) allocated += 1;
      }
      await this.audit(client,"staff",actorId,"SET_WAITING_RECONCILED","system",requestId,{allocated,inspected:rows.rows.length});
      if (allocated) await this.bumpVersion(client);
      await client.query("COMMIT");
      return { allocated };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined); throw error;
    } finally { client.release(); }
  }

  private async loadDefinition(client: PoolClient, setId: string) {
    const setResult = await client.query<{ name: string; version: string; images: unknown }>(
      `SELECT name,version::text,images FROM catalog_sets
        WHERE set_id=$1 AND active AND NOT is_archived AND NOT is_deleted FOR SHARE`,[setId],
    );
    const set = setResult.rows[0];
    if (!set) throw new AppError(404,"SET_NOT_FOUND","Set not found");
    const components = await client.query<SetComponentRow>(
      `SELECT c.model_id,c.quantity,m.size_options,m.color_options
         FROM catalog_set_components c JOIN catalog_models m ON m.model_id=c.model_id
        WHERE c.set_id=$1 AND m.active AND NOT m.is_archived AND NOT m.is_deleted
        ORDER BY c.position,c.id FOR SHARE OF c,m`,[setId],
    );
    if (!components.rows.length) throw new AppError(409,"SET_COMPONENTS_UNAVAILABLE","Set components are unavailable");
    return { name:set.name,version:Number(set.version),image:firstImage(set.images),components:components.rows };
  }

  private validateSelections(components: SetComponentRow[], input: SetSelectionInput[]) {
    const selections = (Array.isArray(input) ? input : []).map((row) => ({modelId:text(row.modelId),color:text(row.color),size:text(row.size)}));
    const required = new Map(components.map((row) => [row.model_id,Number(row.quantity)]));
    const seen = new Map<string,number>();
    for (const row of selections) {
      const component = components.find((item) => item.model_id === row.modelId);
      if (!component) throw new AppError(422,"SET_WAITING_MODEL_INVALID",`${row.modelId} is not part of this Set`);
      if (!optionActive(component.color_options,row.color) || !optionActive(component.size_options,row.size)) {
        throw new AppError(422,"SET_WAITING_VARIANT_INVALID",`Choose a valid color and size for ${row.modelId}`);
      }
      seen.set(row.modelId,(seen.get(row.modelId)||0)+1);
    }
    for (const [modelId,quantity] of required) {
      if ((seen.get(modelId)||0)!==quantity) throw new AppError(422,"SET_WAITING_COUNT_INVALID",`${modelId} requires exactly ${quantity} piece(s)`);
    }
    const expected=[...required.values()].reduce((sum,value)=>sum+value,0);
    if (selections.length!==expected) throw new AppError(422,"SET_WAITING_COUNT_INVALID","Set selections do not match all required pieces");
    return selections;
  }

  private async pickAll(client: PoolClient,selections: SetSelectionInput[],lock: boolean): Promise<string[]> {
    const picked: string[]=[];
    for (const row of selections) {
      const result=await client.query<{id:string}>(
        `SELECT id FROM inventory_items
          WHERE model_id=$1 AND color=$2 AND size=$3
            AND active AND NOT is_archived AND NOT is_deleted AND lower(status)='in stock'
            AND NOT (id=ANY($4::text[]))
          ORDER BY created_at,id
          LIMIT 1 ${lock ? "FOR UPDATE SKIP LOCKED" : ""}`,
        [row.modelId,row.color,row.size,picked],
      );
      if (!result.rows[0]) return [];
      picked.push(result.rows[0].id);
    }
    return picked;
  }

  private async tryAllocate(client: PoolClient,entry: WaitingRow): Promise<boolean> {
    if (entry.status!=="waiting") return false;
    const definition=await this.loadDefinition(client,entry.set_id);
    const selections=this.validateSelections(definition.components,entry.selections);
    const itemIds=await this.pickAll(client,selections,true);
    if (itemIds.length!==selections.length) return false;
    const settings=await client.query<{hours:number}>(
      `SELECT CASE WHEN COALESCE(data->'waiting'->>'reservationHours','') ~ '^\d+$'
              THEN LEAST(72,GREATEST(1,(data->'waiting'->>'reservationHours')::int)) ELSE 4 END AS hours
         FROM site_settings WHERE id='main'`,
    );
    const hours=Math.max(1,Number(settings.rows[0]?.hours||4));
    const expiry=await client.query<{expires_at:Date}>("SELECT now()+($1::text||' hours')::interval AS expires_at",[hours]);
    const expiresAt=expiry.rows[0]!.expires_at;
    const reservationId=`SETWAIT-${randomUUID().replaceAll("-","")}`;
    await client.query(
      `INSERT INTO cart_reservations(id,customer_user_id,expires_at,pricing_snapshot,source)
       VALUES ($1,$2,$3,'[]'::jsonb,'waiting')`,[reservationId,entry.customer_user_id,expiresAt],
    );
    const updated=await client.query(
      `UPDATE inventory_items SET status='Cart Reserved',cart_reservation_id=$2,reservation_until=$3,version=version+1,updated_at=now()
        WHERE id=ANY($1::text[]) AND lower(status)='in stock'`,[itemIds,reservationId,expiresAt],
    );
    if ((updated.rowCount||0)!==itemIds.length) throw new AppError(409,"SET_WAITING_ALLOCATION_RACE","Set stock changed while the complete reservation was being created");
    await client.query(
      `UPDATE set_waiting_entries
          SET status='reserved',cart_reservation_id=$2,reserved_until=$3,set_version=$4,set_name_snapshot=$5,set_image_snapshot=$6,
              updated_at=now(),version=version+1
        WHERE id=$1`,[entry.id,reservationId,expiresAt,definition.version,definition.name,definition.image],
    );
    return true;
  }

  private async releaseExpired(client: PoolClient,customerUserId?: string) {
    const params: unknown[]=[];
    const customerClause=customerUserId ? " AND customer_user_id=$1" : "";
    if (customerUserId) params.push(customerUserId);
    const expired=await client.query<{id:string;cart_reservation_id:string|null}>(
      `SELECT id::text,cart_reservation_id FROM set_waiting_entries
        WHERE status IN ('reserved','confirmed') AND reserved_until<=now()${customerClause}
        FOR UPDATE`,params,
    );
    for (const row of expired.rows) {
      await this.releaseReservation(client,row.cart_reservation_id);
      await client.query(
        `UPDATE set_waiting_entries SET status='waiting',cart_reservation_id=NULL,reserved_until=NULL,updated_at=now(),version=version+1 WHERE id=$1`,[row.id],
      );
    }
    if (expired.rows.length) await this.bumpVersion(client);
  }

  private async releaseReservation(client: PoolClient,reservationId: string|null) {
    if (!reservationId) return;
    await client.query(
      `UPDATE inventory_items SET status='In stock',cart_reservation_id=NULL,reservation_until=NULL,version=version+1,updated_at=now()
        WHERE cart_reservation_id=$1 AND lower(status)='cart reserved'`,[reservationId],
    );
    await client.query("DELETE FROM cart_reservations WHERE id=$1",[reservationId]);
  }

  private async lockEntry(client: PoolClient,id:string): Promise<WaitingRow> {
    const result=await client.query<WaitingRow>(
      `SELECT id::text,customer_user_id::text,set_id,set_version::text,set_name_snapshot,set_image_snapshot,
              selections,piece_count,status,reserved_until,cart_reservation_id,order_id::text,version::text,
              requested_at,updated_at,cancelled_at,converted_at
         FROM set_waiting_entries WHERE id=$1 FOR UPDATE`,[id],
    );
    if (!result.rows[0]) throw new AppError(404,"SET_WAITING_NOT_FOUND","Set Waiting entry not found");
    return result.rows[0];
  }

  private async listRows(client: PoolClient,customerUserId:string) {
    const result=await client.query<WaitingRow>(
      `SELECT id::text,customer_user_id::text,set_id,set_version::text,set_name_snapshot,set_image_snapshot,
              selections,piece_count,status,reserved_until,cart_reservation_id,order_id::text,version::text,
              requested_at,updated_at,cancelled_at,converted_at
         FROM set_waiting_entries WHERE customer_user_id=$1 ORDER BY requested_at DESC,id DESC LIMIT 200`,[customerUserId],
    );
    return result.rows;
  }

  private publicEntry(row:WaitingRow): Record<string,unknown> {
    return {
      id:row.id,type:"Set",setId:row.set_id,setName:row.set_name_snapshot,setImage:row.set_image_snapshot,
      selections:row.selections,pieceCount:Number(row.piece_count),status:row.status,
      reservedUntil:row.reserved_until?.toISOString()||null,cartReservationId:row.cart_reservation_id,
      orderId:row.order_id,requestedAt:row.requested_at.toISOString(),updatedAt:row.updated_at.toISOString(),
      cancelledAt:row.cancelled_at?.toISOString()||null,convertedAt:row.converted_at?.toISOString()||null,
    };
  }

  private async audit(client:PoolClient,actorType:"customer"|"staff",actorId:string,action:string,entityId:string,requestId:string,metadata:Record<string,unknown>) {
    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
       VALUES ($1,$2,$3,'set_waiting',$4,$5,$6::jsonb)`,[actorType,actorId,action,entityId,requestId,JSON.stringify(metadata)],
    );
  }
  private async bumpVersion(client:PoolClient) {
    await client.query(
      `INSERT INTO domain_state_versions(domain,version,updated_at) VALUES ('set_waiting',1,now())
       ON CONFLICT(domain) DO UPDATE SET version=domain_state_versions.version+1,updated_at=now()`,
    );
  }
}
