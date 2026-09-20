import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

export interface CatalogState {
  version: number;
  models: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

interface PublicCatalogModelRow {
  model_id: string;
  name: string;
  category: string;
  description: string;
  selling_minor: string | number;
  discount_percent: string | number;
  low_stock_limit: string | number;
  size_options: unknown[];
  color_options: unknown[];
  size_chart: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdminCatalogModelRow extends PublicCatalogModelRow {
  cost_minor: string | number;
  active: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  legacy: Record<string, unknown>;
  version: string | number;
}

interface AdminInventoryItemRow {
  id: string;
  item_code: string;
  model_id: string;
  color: string;
  size: string;
  status: string;
  active: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  cart_reservation_id: string | null;
  reservation_until: Date | string | null;
  order_id: string | null;
  purchase_date: Date | string | null;
  legacy: Record<string, unknown>;
  version: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

function minor(value: unknown): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

function money(value: unknown): number {
  return Number(value || 0) / 100;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback = ""): string {
  const result = String(value ?? fallback).trim();
  return result || fallback;
}

export class CatalogService {
  constructor(private readonly pool: Pool) {}

  async version(): Promise<number> {
    const result = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM domain_state_versions WHERE domain = 'catalog_inventory'",
    );
    return Number(result.rows[0]?.version || 1);
  }

  async publicCatalog(): Promise<{ version: number; models: Record<string, unknown>[]; stock: Record<string, number> }> {
    const client = await this.pool.connect();
    try {
      await this.releaseExpiredReservations(client);
      const versionResult = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain = 'catalog_inventory'",
      );
      const modelResult = await client.query<PublicCatalogModelRow>(
        `SELECT model_id, name, category, description, selling_minor, discount_percent,
                low_stock_limit, size_options, color_options, size_chart, created_at, updated_at
           FROM catalog_models
          WHERE active AND NOT is_archived AND NOT is_deleted
          ORDER BY created_at DESC`,
      );
      const stockResult = await client.query<{ model_id: string; color: string; size: string; quantity: string }>(
        `SELECT model_id, color, size, count(*)::text AS quantity
           FROM inventory_items
          WHERE active AND NOT is_archived AND NOT is_deleted AND lower(status) = 'in stock'
          GROUP BY model_id, color, size`,
      );
      const stock: Record<string, number> = {};
      for (const row of stockResult.rows) {
        stock[JSON.stringify([row.model_id, row.color, row.size])] = Number(row.quantity);
      }
      return {
        version: Number(versionResult.rows[0]?.version || 1),
        models: modelResult.rows.map((row) => ({
          modelId: row.model_id,
          name: row.name,
          category: row.category,
          description: row.description,
          selling: money(row.selling_minor),
          discount: Number(row.discount_percent || 0),
          lowStockLimit: Number(row.low_stock_limit || 5),
          sizeOptions: row.size_options || [],
          colorOptions: row.color_options || [],
          sizeChart: row.size_chart,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        stock,
      };
    } finally {
      client.release();
    }
  }

  async serial(itemCode: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{
      item_code: string;
      model_id: string;
      model_name: string;
      color: string;
      size: string;
      owner_name: string | null;
    }>(
      `SELECT i.item_code, i.model_id, m.name AS model_name, i.color, i.size,
              c.full_name AS owner_name
         FROM inventory_items i
         JOIN catalog_models m ON m.model_id=i.model_id
         LEFT JOIN orders o ON o.order_code=i.order_id
         LEFT JOIN customers c ON c.user_id=o.customer_user_id
        WHERE lower(i.item_code)=lower($1)
          AND lower(i.status)='sold'
          AND i.active
          AND NOT i.is_archived
          AND NOT i.is_deleted
        LIMIT 1`,
      [itemCode.trim()],
    );
    const row = result.rows[0];
    if (!row) return null;
    const ownerName = String(row.owner_name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");
    return {
      itemCode: row.item_code,
      modelId: row.model_id,
      modelName: row.model_name,
      color: row.color,
      size: row.size,
      ownerName: ownerName || "Dart Customer",
    };
  }

  async adminState(): Promise<CatalogState> {
    const client = await this.pool.connect();
    try {
      await this.releaseExpiredReservations(client);
      const versionResult = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain = 'catalog_inventory'",
      );
      const models = await client.query<AdminCatalogModelRow>(
        `SELECT model_id, name, category, description, cost_minor, selling_minor, discount_percent,
                low_stock_limit, size_options, color_options, size_chart, active, is_archived,
                is_deleted, legacy, version, created_at, updated_at
           FROM catalog_models ORDER BY created_at DESC`,
      );
      const items = await client.query<AdminInventoryItemRow>(
        `SELECT id, item_code, model_id, color, size, status, active, is_archived, is_deleted,
                cart_reservation_id, reservation_until, order_id, purchase_date, legacy, version,
                created_at, updated_at
           FROM inventory_items ORDER BY created_at DESC`,
      );
      return {
        version: Number(versionResult.rows[0]?.version || 1),
        models: models.rows.map((row) => ({
          ...row.legacy,
          modelId: row.model_id,
          name: row.name,
          category: row.category,
          description: row.description,
          cost: money(row.cost_minor),
          selling: money(row.selling_minor),
          discount: Number(row.discount_percent || 0),
          lowStockLimit: Number(row.low_stock_limit || 5),
          sizeOptions: row.size_options || [],
          colorOptions: row.color_options || [],
          sizeChart: row.size_chart,
          active: row.active,
          isArchived: row.is_archived,
          isDeleted: row.is_deleted,
          version: Number(row.version),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        items: items.rows.map((row) => ({
          ...row.legacy,
          id: row.id,
          itemCode: row.item_code,
          modelId: row.model_id,
          color: row.color,
          size: row.size,
          status: row.status,
          active: row.active,
          isArchived: row.is_archived,
          isDeleted: row.is_deleted,
          cartReservationId: row.cart_reservation_id || undefined,
          reservationUntil: row.reservation_until || undefined,
          orderId: row.order_id || undefined,
          purchaseDate: row.purchase_date || undefined,
          version: Number(row.version),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      };
    } finally {
      client.release();
    }
  }

  async replaceState(expectedVersion: number, models: Record<string, unknown>[], items: Record<string, unknown>[], actorId: string, requestId: string): Promise<CatalogState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ version: string }>(
        "SELECT version::text FROM domain_state_versions WHERE domain = 'catalog_inventory' FOR UPDATE",
      );
      const currentVersion = Number(locked.rows[0]?.version || 1);
      if (currentVersion !== expectedVersion) {
        throw new AppError(409, "CATALOG_VERSION_CONFLICT", "Catalogue changed on another device; reload and retry");
      }

      const modelIds = new Set<string>();
      for (const raw of models) {
        const modelId = text(raw.modelId);
        if (!modelId) throw new AppError(422, "MODEL_ID_REQUIRED", "Model code is required");
        modelIds.add(modelId);
        await client.query(
          `INSERT INTO catalog_models (
             model_id, name, category, description, cost_minor, selling_minor, discount_percent,
             low_stock_limit, size_options, color_options, size_chart, active, is_archived,
             is_deleted, legacy, version, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb,1,
                     COALESCE($16::timestamptz, now()), now())
           ON CONFLICT (model_id) DO UPDATE SET
             name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description,
             cost_minor=EXCLUDED.cost_minor, selling_minor=EXCLUDED.selling_minor,
             discount_percent=EXCLUDED.discount_percent, low_stock_limit=EXCLUDED.low_stock_limit,
             size_options=EXCLUDED.size_options, color_options=EXCLUDED.color_options,
             size_chart=EXCLUDED.size_chart, active=EXCLUDED.active, is_archived=EXCLUDED.is_archived,
             is_deleted=EXCLUDED.is_deleted, legacy=EXCLUDED.legacy,
             version=catalog_models.version+1, updated_at=now()`,
          [
            modelId, text(raw.name, modelId), text(raw.category), text(raw.description),
            minor(raw.cost), minor(raw.selling), Math.min(100, Math.max(0, Number(raw.discount) || 0)),
            Math.max(0, Number(raw.lowStockLimit) || 5),
            JSON.stringify(Array.isArray(raw.sizeOptions) ? raw.sizeOptions : []),
            JSON.stringify(Array.isArray(raw.colorOptions) ? raw.colorOptions : []),
            JSON.stringify(raw.sizeChart ?? null),
            bool(raw.active, true), bool(raw.isArchived), bool(raw.isDeleted),
            JSON.stringify(raw), raw.createdAt ? String(raw.createdAt) : null,
          ],
        );
      }

      if (modelIds.size) {
        await client.query(
          "UPDATE catalog_models SET is_deleted=true, active=false, version=version+1, updated_at=now() WHERE NOT (model_id = ANY($1::text[]))",
          [[...modelIds]],
        );
      } else {
        await client.query("UPDATE catalog_models SET is_deleted=true, active=false, version=version+1, updated_at=now()");
      }

      const itemIds = new Set<string>();
      for (const raw of items) {
        const id = text(raw.id);
        const itemCode = text(raw.itemCode);
        const modelId = text(raw.modelId);
        if (!id || !itemCode || !modelId) throw new AppError(422, "ITEM_ID_REQUIRED", "Item id, code and model are required");
        if (!modelIds.has(modelId)) throw new AppError(422, "ITEM_MODEL_INVALID", "Every item must reference an existing model");
        itemIds.add(id);
        const requestedStatus = text(raw.status, "In stock");
        const hasReservation =
          requestedStatus.toLowerCase() === "cart reserved" &&
          Boolean(raw.cartReservationId) &&
          Boolean(raw.reservationUntil);
        const status = requestedStatus.toLowerCase() === "cart reserved" && !hasReservation
          ? "In stock"
          : requestedStatus;
        await client.query(
          `INSERT INTO inventory_items (
             id,item_code,model_id,color,size,status,active,is_archived,is_deleted,
             cart_reservation_id,reservation_until,order_id,purchase_date,legacy,version,created_at,updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13,$14::jsonb,1,
                     COALESCE($15::timestamptz, now()),now())
           ON CONFLICT (id) DO UPDATE SET
             item_code=EXCLUDED.item_code, model_id=EXCLUDED.model_id, color=EXCLUDED.color,
             size=EXCLUDED.size, status=EXCLUDED.status, active=EXCLUDED.active,
             is_archived=EXCLUDED.is_archived, is_deleted=EXCLUDED.is_deleted,
             cart_reservation_id=EXCLUDED.cart_reservation_id, reservation_until=EXCLUDED.reservation_until,
             order_id=EXCLUDED.order_id, purchase_date=EXCLUDED.purchase_date, legacy=EXCLUDED.legacy,
             version=inventory_items.version+1, updated_at=now()`,
          [
            id,itemCode,modelId,text(raw.color),text(raw.size),status,
            bool(raw.active,true),bool(raw.isArchived),bool(raw.isDeleted),
            hasReservation ? String(raw.cartReservationId) : null,
            hasReservation ? String(raw.reservationUntil) : null,
            raw.orderId ? String(raw.orderId) : null,
            raw.purchaseDate ? String(raw.purchaseDate) : null,
            JSON.stringify(raw), raw.createdAt ? String(raw.createdAt) : null,
          ],
        );
      }

      if (itemIds.size) {
        await client.query(
          "UPDATE inventory_items SET is_deleted=true, active=false, version=version+1, updated_at=now() WHERE NOT (id = ANY($1::text[]))",
          [[...itemIds]],
        );
      } else {
        await client.query("UPDATE inventory_items SET is_deleted=true, active=false, version=version+1, updated_at=now()");
      }

      const next = currentVersion + 1;
      await client.query(
        "UPDATE domain_state_versions SET version=$2, updated_at=now() WHERE domain=$1",
        ["catalog_inventory", next],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id, metadata)
         VALUES ('staff',$1,'CATALOG_STATE_REPLACED','catalog_inventory','catalog_inventory',$2,$3::jsonb)`,
        [actorId, requestId, JSON.stringify({ previousVersion: currentVersion, newVersion: next, modelCount: models.length, itemCount: items.length })],
      );
      await client.query("COMMIT");
      return this.adminState();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseExpiredReservations(client: PoolClient): Promise<void> {
    const result = await client.query(
      `UPDATE inventory_items
          SET status='In stock', cart_reservation_id=NULL, reservation_until=NULL,
              version=version+1, updated_at=now()
        WHERE lower(status)='cart reserved' AND reservation_until <= now()`,
    );
    if ((result.rowCount ?? 0) > 0) {
      await client.query(
        "UPDATE domain_state_versions SET version=version+1, updated_at=now() WHERE domain='catalog_inventory'",
      );
    }
  }
}
