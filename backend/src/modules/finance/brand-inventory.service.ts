// Read-only Brand drilldowns. Prices, units and demand are derived on the server.
import type { Pool } from "pg";
import { readRelationalDashboardDomain } from "../dashboard/relational-domain.store.js";

export const BRAND_METRICS = ["sales", "profit", "cost", "damage", "stockSelling", "stockCost", "models", "colors", "sizes", "lowStock", "deadStock", "overview"] as const;
export type BrandMetric = (typeof BRAND_METRICS)[number];
type Row = Record<string, unknown>;
export interface BrandInventoryInput {
  models: Row[];
  items: Row[];
  lines: Row[];
  returns: Row[];
  waiting: Row[];
}
interface Group {
  key: string; name: string; total: number; stock: number; waiting: number | null;
  sold: number; returned: number; damaged: number; share: number;
  sellingMinor: number; costMinor?: number;
  unitSellingMinor?: number; unitCostMinor?: number; lastSale: string | null;
  idleDays: number | null;
}
function timestamp(value: unknown): number {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}
function day(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function within(value: unknown, start: string, end: string): boolean {
  const key = day(value);
  return Boolean(key && key >= start && key <= end);
}
function text(value: unknown): string { return String(value || "—"); }

export function calculateBrandInventory(input: BrandInventoryInput, start: string, end: string,
  visibility: { costs: boolean; waiting: boolean; sales?: boolean }, now = new Date()) {
  const models = new Map(input.models.map((row) => [text(row.model_id), row]));
  const items = new Map(input.items.map((row) => [text(row.item_code), row]));
  const modelGroups = new Map<string, Group>(), colorGroups = new Map<string, Group>(), sizeGroups = new Map<string, Group>();
  const ensure = (map: Map<string, Group>, key: string, name = key): Group => {
    if (!map.has(key)) map.set(key, { key, name, total: 0, stock: 0, waiting: visibility.waiting ? 0 : null,
      sold: 0, returned: 0, damaged: 0, share: 0, sellingMinor: 0,
      ...(visibility.costs ? { costMinor: 0 } : {}), lastSale: null, idleDays: null });
    return map.get(key)!;
  };
  const groupsFor = (row: Row) => [ensure(modelGroups, text(row.model_id), text(models.get(text(row.model_id))?.name || row.model_name || row.model_id)),
    ensure(colorGroups, text(row.color)), ensure(sizeGroups, text(row.size))];
  // Include unsold variants in the rankings, including variants configured before stocking.
  for (const model of input.models) {
    const group = ensure(modelGroups, text(model.model_id), text(model.name));
    group.unitSellingMinor = Math.max(0, Math.round(Number(model.selling_minor || 0) * (100 - Number(model.discount_percent || 0)) / 100));
    if (visibility.costs) group.unitCostMinor = Number(model.cost_minor || 0);
    for (const color of Array.isArray(model.color_options) ? model.color_options : []) {
      const name = typeof color === "object" && color ? (color as Row).name || (color as Row).color : color;
      if (name) ensure(colorGroups, text(name));
    }
    for (const size of Array.isArray(model.size_options) ? model.size_options : []) if (size) ensure(sizeGroups, text(size));
  }
  const stockStart = new Map<string, number>();
  for (const item of input.items) {
    const groups = groupsFor(item);
    groups.forEach((group) => group.total++);
    const status = String(item.status || "").toLowerCase();
    if (["damaged", "destroyed"].includes(status)) groups.forEach((group) => group.damaged++);
    // A cart hold does not move a physical piece out of the warehouse and never adds Waiting demand.
    if (item.active === false || item.is_archived || !["in stock", "cart reserved"].includes(status)) continue;
    const model = models.get(text(item.model_id));
    const selling = Math.max(0, Math.round(Number(model?.selling_minor || 0) * (100 - Number(model?.discount_percent || 0)) / 100));
    const cost = Number(item.cost_snapshot_minor ?? model?.cost_minor ?? 0);
    groups.forEach((group) => { group.stock++; group.sellingMinor += selling; if (visibility.costs) group.costMinor! += cost; });
    const created = timestamp(item.created_at);
    if (created) stockStart.set(text(item.model_id), Math.min(stockStart.get(text(item.model_id)) || created, created));
  }
  // A returned piece may be resold: the identity is order + piece, never piece alone.
  const lineByOrderItem = new Map<string, Row>();
  for (const line of input.lines) {
    lineByOrderItem.set(`${text(line.order_code)}:${text(line.item_code)}`, line);
    lineByOrderItem.set(`${text(line.order_id)}:${text(line.item_code)}`, line);
    const groups = groupsFor(line);
    if (within(line.event_at, start, end)) groups.forEach((group) => group.sold++);
    const event = timestamp(line.event_at);
    if (event && event <= now.getTime()) groups.forEach((group) => {
      if (!group.lastSale || event > timestamp(group.lastSale)) group.lastSale = new Date(event).toISOString();
    });
  }
  const uniqueReturns = new Map<string, Row>();
  const eventDate = (row: Row) => row.completedAt || row.resolvedAt || row.updatedAt || row.date || row.createdAt;
  for (const row of [...input.returns].sort((a, b) => timestamp(eventDate(a)) - timestamp(eventDate(b)))) {
    const status = String(row.status || "").toLowerCase();
    if (row.isPostDeliveryReturn !== true || !(row.completedAt || ["completed", "good", "damaged", "bad"].includes(status)) || !within(eventDate(row), start, end)) continue;
    uniqueReturns.set(`${text(row.orderId)}:${text(row.itemCode || row.id)}`, row);
  }
  for (const row of uniqueReturns.values()) {
    if (String(row.requestType || "").toLowerCase().includes("exchange")) continue;
    const original = row.originalLineSnapshot as Row | undefined;
    const line = lineByOrderItem.get(`${text(row.orderId)}:${text(row.itemCode)}`);
    const item = items.get(text(row.itemCode));
    const variant = line || { model_id: original?.modelCode || original?.modelId || item?.model_id,
      color: original?.color || item?.color, size: original?.size || item?.size };
    groupsFor(variant).forEach((group) => { group.sold--; group.returned++; });
  }
  if (visibility.waiting) for (const row of input.waiting) groupsFor(row).forEach((group) => { group.waiting! += Number(row.quantity || 1); });
  const netUnits = [...modelGroups.values()].reduce((sum, row) => sum + row.sold, 0);
  const rank = (map: Map<string, Group>) => [...map.values()].map((row) => ({ ...row,
    share: netUnits > 0 ? Math.round(row.sold / netUnits * 10000) / 100 : 0,
  })).sort((a, b) => b.sold - a.sold || a.key.localeCompare(b.key));
  const modelRows = rank(modelGroups);
  for (const row of modelRows) {
    // A new model gets its first 15 days from its earliest remaining stock entry.
    const baseline = row.lastSale ? timestamp(row.lastSale) : stockStart.get(row.key) || 0;
    row.idleDays = baseline ? Math.max(0, Math.floor((now.getTime() - baseline) / 86400000)) : null;
  }
  const stockRows = modelRows.filter((row) => row.stock > 0);
  const low = [...stockRows].filter((row) => row.stock <= 5).sort((a, b) => a.stock - b.stock || a.key.localeCompare(b.key));
  const dead = [...stockRows].filter((row) => row.idleDays !== null && row.idleDays >= 15).sort((a, b) => a.stock - b.stock || (b.idleDays || 0) - (a.idleDays || 0) || a.key.localeCompare(b.key));
  const totals = { pieces: stockRows.reduce((sum, row) => sum + row.stock, 0), models: stockRows.length,
    sellingMinor: stockRows.reduce((sum, row) => sum + row.sellingMinor, 0),
    ...(visibility.costs ? { costMinor: stockRows.reduce((sum, row) => sum + (row.costMinor || 0), 0) } : {}),
    netUnits, lowStock: low.length, deadStock: dead.length };
  return { models: modelRows, colors: rank(colorGroups), sizes: rank(sizeGroups), stock: stockRows, low, dead, totals };
}

export async function readBrandInventory(pool: Pool, metric: BrandMetric, start: string, end: string,
  page: number, limit: number, visibility: { costs: boolean; waiting: boolean; sales: boolean }) {
  const client = await pool.connect();
  let input: BrandInventoryInput;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const models = await client.query<Row>("SELECT model_id,name,selling_minor::text,cost_minor::text,discount_percent,color_options,size_options FROM catalog_models WHERE NOT is_deleted");
    const items = await client.query<Row>("SELECT item_code,model_id,color,size,status,active,is_archived,cost_snapshot_minor::text,created_at FROM inventory_items WHERE NOT is_deleted");
    const lines = await client.query<Row>(`SELECT oi.item_code,oi.model_id,oi.model_name,oi.color,oi.size,o.id::text AS order_id,o.order_code,
      COALESCE(o.delivered_at,o.updated_at) AS event_at FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='Delivered'`);
    const returns = await readRelationalDashboardDomain(client, "returns") as Row[];
    let waiting: Row[] = [];
    if (visibility.waiting) {
      const result = await client.query<Row>(`SELECT model_id,desired_color AS color,size,count(*)::int AS quantity FROM waitlist_entries
        WHERE status='waiting' GROUP BY model_id,desired_color,size
        UNION ALL
        SELECT selection->>'modelId' AS model_id,selection->>'color' AS color,selection->>'size' AS size,
          sum(COALESCE(NULLIF(selection->>'quantity','')::int,1))::int AS quantity
        FROM set_waiting_entries CROSS JOIN LATERAL jsonb_array_elements(selections) selection
        WHERE status='waiting' GROUP BY selection->>'modelId',selection->>'color',selection->>'size'`);
      waiting = result.rows;
    }
    input = { models: models.rows, items: items.rows, lines: lines.rows, returns, waiting };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const result = calculateBrandInventory(input, start, end, visibility);
  if (!visibility.sales) {
    // Counts needed for valuation remain available; sales history requires its own grant.
    for (const rows of [result.models, result.colors, result.sizes, result.stock, result.low, result.dead]) {
      for (const row of rows) { row.sold = 0; row.returned = 0; row.share = 0; row.lastSale = null; }
    }
    result.totals.netUnits = 0;
  }
  if (metric === "overview") return { metric, currency: "EGP", start, end, totals: result.totals,
    salesVisible: visibility.sales,
    top: visibility.sales ? { models: result.models[0] || null, colors: result.colors[0] || null, sizes: result.sizes[0] || null } : null };
  const rows = metric === "models" ? result.models : metric === "colors" ? result.colors : metric === "sizes" ? result.sizes
    : metric === "lowStock" ? result.low : metric === "deadStock" ? result.dead : result.stock;
  return { metric, currency: "EGP", start, end, page, limit, total: rows.length, totals: result.totals,
    waitingVisible: visibility.waiting, salesVisible: visibility.sales, rows: rows.slice((page - 1) * limit, page * limit) };
}
