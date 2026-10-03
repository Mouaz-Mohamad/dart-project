// DART CODE GUIDE | backend/src/modules/sets/set-cart.service.ts
// Associates already-reserved physical cart items with Set groups atomically.
// It never creates stock and never trusts prices from the browser.
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { allocateSetPrices, applyPercentMinor, resolveSetBenefit } from "./set-pricing.js";

export interface SetSelectionInput {
  modelId: string;
  color: string;
  size: string;
}

export interface CartSetGroupInput {
  setId: string;
  unitIndex: number;
  selections: SetSelectionInput[];
}

interface SetDefinitionRow {
  set_id: string;
  name: string;
  base_price_minor: string;
  discount_percent: string;
  images: unknown;
  version: string;
}

interface ComponentRow {
  id: string;
  model_id: string;
  quantity: number;
  position: number;
  name: string;
  selling_minor: string;
  cost_minor: string;
  discount_percent: string;
  size_options: unknown;
  color_options: unknown;
}

interface ReservedItemRow {
  id: string;
  item_code: string;
  model_id: string;
  color: string;
  size: string;
  cost_snapshot_minor: string | null;
}

function normalized(value: unknown): string {
  return String(value || "").trim();
}

function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function birthdayWindow(birthday: unknown): { year: number; startsAt: string; expiresAt: string } | null {
  const match = normalized(birthday).match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [yearText, monthText, dayText] = cairoDateKey().split("-");
  const currentYear = Number(yearText);
  const today = Date.UTC(currentYear, Number(monthText) - 1, Number(dayText));
  const month = Number(match[1]);
  const day = Number(match[2]);
  for (const year of [currentYear, currentYear - 1]) {
    const start = Date.UTC(year, month - 1, day);
    const end = start + 7 * 86_400_000;
    if (today >= start && today < end) {
      return {
        year,
        startsAt: new Date(start).toISOString().slice(0, 10),
        expiresAt: new Date(end).toISOString().slice(0, 10),
      };
    }
  }
  return null;
}

function expiryMs(value: unknown): number | null {
  const text = normalized(value);
  if (!text) return null;
  const parts = text.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [a, b, c] = parts;
  const year = a! > 999 ? a! : c!;
  const month = b!;
  const day = a! > 999 ? c! : a!;
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}

function variantOptionActive(options: unknown, value: string): boolean {
  return Array.isArray(options) && options.some((option) => {
    if (!option || typeof option !== "object") return false;
    const row = option as Record<string, unknown>;
    return String(row.name || "") === value && row.active !== false;
  });
}

function firstImage(images: unknown): string {
  if (!Array.isArray(images)) return "";
  return String(images.find((value) => String(value || "").trim()) || "").trim();
}

export class SetCartService {
  public constructor(private readonly pool: Pool) {}

  private async reservationOwner(
    client: PoolClient,
    reservationId: string,
    customerUserId?: string,
    guestOwnerHash?: string,
  ) {
    const result = await client.query<{
      customer_user_id: string | null;
      guest_owner_hash: string | null;
      expires_at: Date;
    }>(
      `SELECT customer_user_id::text,guest_owner_hash,expires_at
         FROM cart_reservations
        WHERE id=$1 AND source='cart'
        FOR UPDATE`,
      [reservationId],
    );
    const row = result.rows[0];
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AppError(409, "CART_RESERVATION_EXPIRED", "The cart reservation expired. Add the Set again");
    }
    if (customerUserId) {
      if (row.customer_user_id && row.customer_user_id !== customerUserId) {
        throw new AppError(403, "RESERVATION_OWNERSHIP_INVALID", "This cart reservation belongs to another account");
      }
      if (!row.customer_user_id && guestOwnerHash && row.guest_owner_hash !== guestOwnerHash) {
        throw new AppError(403, "RESERVATION_OWNERSHIP_INVALID", "This guest cart belongs to another browser");
      }
      return row;
    }
    if (!guestOwnerHash || row.customer_user_id || row.guest_owner_hash !== guestOwnerHash) {
      throw new AppError(403, "RESERVATION_OWNERSHIP_INVALID", "This cart reservation belongs to another session");
    }
    return row;
  }

  private async loadSet(client: PoolClient, setId: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:set:${setId}`]);
    const setResult = await client.query<SetDefinitionRow>(
      `SELECT set_id,name,base_price_minor::text,discount_percent::text,images,version::text
         FROM catalog_sets
        WHERE set_id=$1 AND active AND NOT is_archived AND NOT is_deleted
        FOR SHARE`,
      [setId],
    );
    const set = setResult.rows[0];
    if (!set) throw new AppError(409, "SET_UNAVAILABLE", `Set ${setId} is no longer available`);
    const components = await client.query<ComponentRow>(
      `SELECT c.id::text,c.model_id,c.quantity,c.position,m.name,
              m.selling_minor::text,m.cost_minor::text,m.discount_percent::text,
              m.size_options,m.color_options
         FROM catalog_set_components c
         JOIN catalog_models m ON m.model_id=c.model_id
        WHERE c.set_id=$1
          AND m.active AND NOT m.is_archived AND NOT m.is_deleted
        ORDER BY c.position,c.id
        FOR SHARE OF c,m`,
      [setId],
    );
    if (!components.rows.length) {
      throw new AppError(409, "SET_COMPONENTS_UNAVAILABLE", "This Set has no available component models");
    }
    return { set, components: components.rows };
  }

  private validateSelections(components: ComponentRow[], selections: SetSelectionInput[]) {
    const required = new Map(components.map((row) => [row.model_id, Number(row.quantity)]));
    const seen = new Map<string, number>();
    for (const raw of selections) {
      const modelId = normalized(raw.modelId);
      const component = components.find((row) => row.model_id === modelId);
      if (!component) {
        throw new AppError(422, "SET_SELECTION_MODEL_INVALID", `${modelId} is not a component of this Set`);
      }
      const color = normalized(raw.color);
      const size = normalized(raw.size);
      if (!variantOptionActive(component.color_options, color) || !variantOptionActive(component.size_options, size)) {
        throw new AppError(409, "SET_VARIANT_UNAVAILABLE", `${modelId} / ${color} / ${size} is no longer available`);
      }
      seen.set(modelId, (seen.get(modelId) || 0) + 1);
    }
    for (const [modelId, quantity] of required) {
      if ((seen.get(modelId) || 0) !== quantity) {
        throw new AppError(422, "SET_SELECTION_COUNT_INVALID", `Set ${modelId} requires exactly ${quantity} selection(s)`);
      }
    }
    if ([...seen.values()].reduce((sum, value) => sum + value, 0) !== selections.length) {
      throw new AppError(422, "SET_SELECTION_COUNT_INVALID", "Set selections do not match its components");
    }
  }

  private async customerBenefitContext(client: PoolClient, customerUserId?: string) {
    const settingsResult = await client.query<{
      birthday_percent: string;
      dart_card_percent: string;
    }>(
      "SELECT birthday_percent::text,dart_card_percent::text FROM set_discount_settings WHERE id='main' FOR SHARE",
    );
    const settings = settingsResult.rows[0];
    const base = {
      birthdayEligible: false,
      birthdayPercent: Number(settings?.birthday_percent || 10),
      birthdayReference: "",
      birthdayMetadata: {} as Record<string, unknown>,
      dartCardEligible: false,
      dartCardPercent: Number(settings?.dart_card_percent || 10),
      dartCardRemainingPieces: 0,
      dartCardReference: "",
    };
    if (!customerUserId) return base;

    const customerResult = await client.query<{
      client_code: string;
      birthday: string | null;
    }>(
      "SELECT client_code,birthday::text FROM customers WHERE user_id=$1 FOR SHARE",
      [customerUserId],
    );
    const customer = customerResult.rows[0];
    if (!customer) return base;

    const window = birthdayWindow(customer.birthday);
    if (window) {
      const usage = await client.query<{ status: string; order_id: string | null }>(
        `SELECT status,order_id::text
           FROM birthday_discount_usage
          WHERE customer_user_id=$1 AND reward_year=$2
          FOR SHARE`,
        [customerUserId, window.year],
      );
      const locked = usage.rows.some((row) => ["Reserved", "Used"].includes(row.status));
      if (!locked) {
        const reward = await client.query<{ record_id: string; payload: Record<string, unknown> }>(
          `SELECT record_id,payload
             FROM birthday_rewards
            WHERE customer_code=$1
              AND lower(status)='active'
            ORDER BY updated_at DESC
            LIMIT 1`,
          [customer.client_code],
        );
        base.birthdayEligible = true;
        base.birthdayReference = reward.rows[0]?.record_id || `BIRTHDAY-${customer.client_code}-${window.year}`;
        base.birthdayMetadata = {
          rewardYear: window.year,
          rewardId: reward.rows[0]?.record_id || "",
          startsAt: window.startsAt,
          expiresAt: window.expiresAt,
        };
      }
    }

    const cards = await client.query<{
      record_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT record_id,payload
         FROM loyalty_cards
        WHERE customer_code=$1 AND lower(status)='active'
        ORDER BY updated_at DESC
        FOR SHARE`,
      [customer.client_code],
    );
    const now = Date.now();
    for (const card of cards.rows) {
      const payload = card.payload || {};
      const limit = Math.max(1, Number(payload.itemLimit || payload.purchasedLimit || 10));
      const used = Math.max(0, Number(payload.purchasedItems || 0));
      const reserved = Math.max(0, Number(payload.reservedItems || 0));
      const expiry = expiryMs(payload.expDate || payload.expiresAt);
      const remaining = Math.max(0, limit - used - reserved);
      if (remaining > 0 && (!expiry || expiry >= now)) {
        base.dartCardEligible = true;
        base.dartCardRemainingPieces = remaining;
        base.dartCardReference = String(payload.cardId || payload.id || card.record_id);
        break;
      }
    }
    return base;
  }

  public async attachGroups(
    reservationIdInput: string,
    groupsInput: CartSetGroupInput[],
    customerUserId?: string,
    guestOwnerHash?: string,
  ) {
    const reservationId = normalized(reservationIdInput);
    const groups = Array.isArray(groupsInput) ? groupsInput : [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:cart:${reservationId}`]);
      await this.reservationOwner(client, reservationId, customerUserId, guestOwnerHash);

      const reservedResult = await client.query<ReservedItemRow>(
        `SELECT i.id,i.item_code,i.model_id,i.color,i.size,
                COALESCE(NULLIF(i.legacy->>'costSnapshotMinor','')::bigint,m.cost_minor)::text AS cost_snapshot_minor
           FROM inventory_items i
           JOIN catalog_models m ON m.model_id=i.model_id
          WHERE i.cart_reservation_id=$1
            AND lower(i.status)='cart reserved'
          ORDER BY i.created_at,i.id
          FOR UPDATE OF i`,
        [reservationId],
      );
      const reserved = reservedResult.rows;
      const usedInventoryIds = new Set<string>();

      await client.query("DELETE FROM cart_set_groups WHERE reservation_id=$1", [reservationId]);
      if (!groups.length) {
        await client.query("COMMIT");
        return { reservationId, groups: [] };
      }

      const benefit = await this.customerBenefitContext(client, customerUserId);
      let cardRemaining = benefit.dartCardRemainingPieces;
      const output: Array<Record<string, unknown>> = [];

      for (const rawGroup of groups) {
        const setId = normalized(rawGroup.setId);
        const unitIndex = Math.max(1, Math.trunc(Number(rawGroup.unitIndex) || 1));
        const selections = (Array.isArray(rawGroup.selections) ? rawGroup.selections : []).map((row) => ({
          modelId: normalized(row.modelId),
          color: normalized(row.color),
          size: normalized(row.size),
        }));
        const { set, components } = await this.loadSet(client, setId);
        this.validateSelections(components, selections);
        const pieceCount = selections.length;

        const resolved = resolveSetBenefit({
          setDiscountPercent: Number(set.discount_percent || 0),
          birthdayEligible: benefit.birthdayEligible,
          birthdayPercent: benefit.birthdayPercent,
          dartCardEligible: benefit.dartCardEligible,
          dartCardPercent: benefit.dartCardPercent,
          dartCardRemainingPieces: cardRemaining,
          setPieceCount: pieceCount,
        });
        if (resolved.source === "Dart Card") cardRemaining -= resolved.consumesDartCardPieces;

        const basePriceMinor = Math.max(0, Number(set.base_price_minor || 0));
        const setFinalMinor = applyPercentMinor(basePriceMinor, resolved.percent);
        const allocations = allocateSetPrices(
          components.map((row) => ({
            modelSellingMinor: Number(row.selling_minor || 0),
            quantity: Number(row.quantity),
          })),
          basePriceMinor,
          setFinalMinor,
        );
        const componentByModel = new Map(components.map((row, index) => [row.model_id, { row, index }]));
        const allocationByKey = new Map(
          allocations.map((row) => [`${row.componentIndex}:${row.unitIndex}`, row]),
        );
        const modelSeen = new Map<string, number>();
        const assigned: Array<{
          selection: SetSelectionInput;
          component: ComponentRow;
          item: ReservedItemRow;
          unitIndex: number;
          baseAllocatedMinor: number;
          finalAllocatedMinor: number;
        }> = [];

        for (const selection of selections) {
          const componentData = componentByModel.get(selection.modelId)!;
          const unit = (modelSeen.get(selection.modelId) || 0) + 1;
          modelSeen.set(selection.modelId, unit);
          const item = reserved.find((candidate) =>
            !usedInventoryIds.has(candidate.id) &&
            candidate.model_id === selection.modelId &&
            candidate.color === selection.color &&
            candidate.size === selection.size,
          );
          if (!item) {
            throw new AppError(
              409,
              "SET_RESERVED_ITEMS_MISMATCH",
              `The reserved cart no longer contains every piece required by ${set.name}`,
            );
          }
          usedInventoryIds.add(item.id);
          const allocation = allocationByKey.get(`${componentData.index}:${unit}`);
          if (!allocation) throw new AppError(409, "SET_ALLOCATION_INVALID", "Set price allocation could not be completed");
          assigned.push({
            selection,
            component: componentData.row,
            item,
            unitIndex: unit,
            baseAllocatedMinor: allocation.baseAllocatedMinor,
            finalAllocatedMinor: allocation.finalAllocatedMinor,
          });
        }

        const naturalTotalMinor = components.reduce(
          (sum, row) => sum + Number(row.selling_minor || 0) * Number(row.quantity),
          0,
        );
        const discountReference = resolved.source === "Birthday"
          ? benefit.birthdayReference
          : resolved.source === "Dart Card"
            ? benefit.dartCardReference
            : resolved.source === "Set"
              ? setId
              : "";
        const benefitMetadata = resolved.source === "Birthday"
          ? benefit.birthdayMetadata
          : resolved.source === "Dart Card"
            ? { cardId: benefit.dartCardReference, reservedPieces: pieceCount }
            : {};

        const groupResult = await client.query<{ id: string }>(
          `INSERT INTO cart_set_groups(
             reservation_id,set_id,set_version,unit_index,set_name_snapshot,set_image_snapshot,
             components_total_minor,set_base_price_minor,discount_source,discount_percent,
             discount_reference,benefit_metadata,final_minor,piece_count
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
           RETURNING id::text`,
          [
            reservationId,setId,Number(set.version),unitIndex,set.name,firstImage(set.images),
            naturalTotalMinor,basePriceMinor,resolved.source,resolved.percent,
            discountReference,JSON.stringify(benefitMetadata),setFinalMinor,pieceCount,
          ],
        );
        const groupId = groupResult.rows[0]!.id;

        for (const row of assigned) {
          await client.query(
            `INSERT INTO cart_set_components(
               group_id,component_id,inventory_item_id,model_id,model_name_snapshot,color,size,
               component_unit_index,original_model_selling_minor,original_model_discount_percent,
               cost_snapshot_minor,allocated_base_minor,allocated_final_minor
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              groupId,row.component.id,row.item.id,row.component.model_id,row.component.name,
              row.selection.color,row.selection.size,row.unitIndex,Number(row.component.selling_minor || 0),
              Number(row.component.discount_percent || 0),Number(row.item.cost_snapshot_minor || row.component.cost_minor || 0),
              row.baseAllocatedMinor,row.finalAllocatedMinor,
            ],
          );
        }

        output.push({
          id: groupId,
          setId,
          unitIndex,
          setName: set.name,
          image: firstImage(set.images),
          pieceCount,
          componentsTotalMinor: naturalTotalMinor,
          basePriceMinor,
          discountSource: resolved.source,
          discountPercent: resolved.percent,
          discountReference,
          finalMinor: setFinalMinor,
          selections: assigned.map((row) => ({
            modelId: row.component.model_id,
            modelName: row.component.name,
            color: row.selection.color,
            size: row.selection.size,
            itemCode: row.item.item_code,
            allocatedBaseMinor: row.baseAllocatedMinor,
            allocatedFinalMinor: row.finalAllocatedMinor,
          })),
        });
      }

      await client.query("COMMIT");
      return { reservationId, groups: output };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async groupsForReservation(
    reservationIdInput: string,
    customerUserId?: string,
    guestOwnerHash?: string,
  ) {
    const reservationId = normalized(reservationIdInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.reservationOwner(client, reservationId, customerUserId, guestOwnerHash);
      const rows = await client.query<{
        id: string;
        set_id: string;
        unit_index: number;
        set_name_snapshot: string;
        set_image_snapshot: string;
        piece_count: number;
        components_total_minor: string;
        set_base_price_minor: string;
        discount_source: string;
        discount_percent: string;
        discount_reference: string;
        final_minor: string;
        components: unknown;
      }>(
        `SELECT g.id::text,g.set_id,g.unit_index,g.set_name_snapshot,g.set_image_snapshot,
                g.piece_count,g.components_total_minor::text,g.set_base_price_minor::text,
                g.discount_source,g.discount_percent::text,g.discount_reference,g.final_minor::text,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'modelId',c.model_id,'modelName',c.model_name_snapshot,'color',c.color,'size',c.size,
                  'itemCode',i.item_code,'allocatedBaseMinor',c.allocated_base_minor,
                  'allocatedFinalMinor',c.allocated_final_minor
                ) ORDER BY c.created_at,c.id) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) AS components
           FROM cart_set_groups g
           LEFT JOIN cart_set_components c ON c.group_id=g.id
           LEFT JOIN inventory_items i ON i.id=c.inventory_item_id
          WHERE g.reservation_id=$1
          GROUP BY g.id
          ORDER BY g.created_at,g.unit_index`,
        [reservationId],
      );
      await client.query("COMMIT");
      return {
        reservationId,
        groups: rows.rows.map((row) => ({
          id: row.id,setId: row.set_id,unitIndex: row.unit_index,setName: row.set_name_snapshot,
          image: row.set_image_snapshot,pieceCount: row.piece_count,
          componentsTotalMinor: Number(row.components_total_minor),basePriceMinor: Number(row.set_base_price_minor),
          discountSource: row.discount_source,discountPercent: Number(row.discount_percent),
          discountReference: row.discount_reference,finalMinor: Number(row.final_minor),
          components: Array.isArray(row.components) ? row.components : [],
        })),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
