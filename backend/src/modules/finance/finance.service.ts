import type { Pool } from "pg";

type JsonRow = Record<string, unknown>;

interface DeliveredOrderRow {
  id: string;
  order_code: string;
  customer_user_id: string;
  final_minor: string;
  delivery_cost_minor: string;
  payment_method: string;
  payment_status: string;
  amount_paid_minor: string;
  amount_refunded_minor: string;
  event_at: Date;
  cogs_minor: string;
  sold_units: string;
}

export interface FinanceSummary {
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  grossCogs: number;
  cogsReversal: number;
  netCogs: number;
  operatingExpenses: number;
  codFees: number;
  damageLoss: number;
  damageValue: number;
  returnCourierCosts: number;
  deliveryCosts: number;
  totalOperatingExpenses: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  physicalItemCost: number;
  incrementalDamage: number;
  brandTotalCost: number;
  brandNetProfit: number;
  margin: number;
  grossMargin: number;
  deliveredOrders: number;
  grossSoldUnits: number;
  returnedUnits: number;
  soldUnits: number;
  averageOrderValue: number;
  uniqueCustomers: number;
  returningCustomers: number;
  oneTimeCustomers: number;
  repeatRate: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  paidExpenseCashOut: number;
  refundCashOut: number;
  marketing: {
    spend: number;
    revenue: number;
    roas: number;
    cac: number;
    ctr: number;
    cpc: number;
    conversion: number;
    impressions: number;
    clicks: number;
    orders: number;
  };
}

function money(value: number): number {
  return Math.round(value) / 100;
}

function metric(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function toMinor(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function active(row: JsonRow): boolean {
  return !row.isDeleted && !row.isArchived;
}

function dateKey(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function inRange(value: unknown, start: string, end: string): boolean {
  const key = dateKey(value);
  return Boolean(key && key >= start && key <= end);
}

function returnEventDate(row: JsonRow): unknown {
  return row.completedAt || row.resolvedAt || row.updatedAt || row.date || row.createdAt;
}

function completedReturn(row: JsonRow): boolean {
  const status = String(row.status || "").toLowerCase();
  return (
    active(row) &&
    row.isPostDeliveryReturn === true &&
    Boolean(row.completedAt || ["completed", "good", "damaged", "bad"].includes(status))
  );
}

function isExchange(row: JsonRow): boolean {
  return String(row.requestType || "").toLowerCase().includes("exchange");
}

function inspection(row: JsonRow): "Good" | "Damaged" | "Pending" {
  const value = String(row.inspectionStatus || row.status || "").toLowerCase();
  if (value === "good") return "Good";
  if (["damaged", "bad"].includes(value)) return "Damaged";
  return "Pending";
}

function uniqueCompletedReturns(
  rows: JsonRow[],
  start: string,
  end: string,
): JsonRow[] {
  const filtered = rows
    .filter(completedReturn)
    .filter((row) => inRange(returnEventDate(row), start, end))
    .sort(
      (left, right) =>
        new Date(String(returnEventDate(left) || 0)).getTime() -
        new Date(String(returnEventDate(right) || 0)).getTime(),
    );
  const unique = new Map<string, JsonRow>();
  for (const row of filtered) {
    unique.set(
      `${String(row.orderId || "")}:${String(row.itemCode || row.id || "")}`,
      row,
    );
  }
  return [...unique.values()];
}

export class FinanceService {
  public constructor(private readonly pool: Pool) {}

  public async summary(start: string, end: string): Promise<FinanceSummary> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const deliveredResult = await client.query<DeliveredOrderRow>(
        `SELECT o.id::text,
                o.order_code,
                o.customer_user_id::text,
                o.final_minor::text,
                o.delivery_cost_minor::text,
                o.payment_method,
                o.payment_status,
                o.amount_paid_minor::text,
                o.amount_refunded_minor::text,
                COALESCE(o.delivered_at, o.updated_at) AS event_at,
                COALESCE(sum(oi.cost_snapshot_minor),0)::text AS cogs_minor,
                count(oi.id)::text AS sold_units
           FROM orders o
           LEFT JOIN order_items oi ON oi.order_id=o.id
          WHERE o.status='Delivered'
            AND NOT o.is_deleted
            AND NOT o.is_archived
            AND COALESCE(o.delivered_at, o.updated_at) >=
                ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
            AND COALESCE(o.delivered_at, o.updated_at) <
                (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
          GROUP BY o.id
          ORDER BY COALESCE(o.delivered_at, o.updated_at), o.order_code`,
        [start, end],
      );

      const acquiredResult = await client.query<{
        item_code: string;
        cost_snapshot_minor: string;
      }>(
        `SELECT item_code, cost_snapshot_minor::text
           FROM inventory_items
          WHERE NOT is_deleted
            AND created_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
            AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`,
        [start, end],
      );

      const itemCostResult = await client.query<{
        item_code: string;
        cost_snapshot_minor: string;
      }>(
        `SELECT item_code, cost_snapshot_minor::text
           FROM inventory_items`,
      );
      const itemCost = new Map(
        itemCostResult.rows.map((row) => [
          row.item_code,
          Number(row.cost_snapshot_minor || 0),
        ]),
      );

      const deliveredCodesResult = await client.query<{ item_code: string }>(
        `SELECT DISTINCT oi.item_code
           FROM order_items oi
           JOIN orders o ON o.id=oi.order_id
          WHERE o.status='Delivered' AND NOT o.is_deleted`,
      );
      const deliveredCodes = new Set(
        deliveredCodesResult.rows.map((row) => row.item_code),
      );

      const stateResult = await client.query<{ domain: string; data: unknown[] }>(
        `SELECT domain, data
           FROM dashboard_domain_state
          WHERE domain IN (
            'returns','damage','finance_expenses',
            'finance_settlements','finance_marketing'
          )`,
      );
      const states = new Map(
        stateResult.rows.map((row) => [
          row.domain,
          Array.isArray(row.data) ? (row.data as JsonRow[]) : [],
        ]),
      );

      const returns = states.get("returns") || [];
      const periodReturns = uniqueCompletedReturns(returns, start, end);
      const refundsRows = periodReturns.filter((row) => !isExchange(row));
      const refundsMinor = refundsRows.reduce(
        (sum, row) => sum + toMinor(row.refundAmount),
        0,
      );

      const cogsReversalMinor = refundsRows
        .filter((row) => inspection(row) === "Good")
        .reduce((sum, row) => {
          const snapshot = row.originalLineSnapshot as JsonRow | undefined;
          const snapshotCost = snapshot?.costSnapshot;
          const costMinor = Number.isFinite(Number(snapshotCost))
            ? toMinor(snapshotCost)
            : itemCost.get(String(row.itemCode || "")) || 0;
          return sum + costMinor;
        }, 0);

      const returnCourierMinor = periodReturns
        .filter(isExchange)
        .reduce((sum, row) => sum + toMinor(row.brandCourierFee), 0);

      const expenses = (states.get("finance_expenses") || []).filter(active);
      const operatingExpenseMinor = expenses
        .filter((row) => String(row.status || "").toLowerCase() !== "void")
        .filter((row) => inRange(row.date, start, end))
        .reduce((sum, row) => sum + toMinor(row.amount), 0);
      const paidExpenseMinor = expenses
        .filter((row) => String(row.status || "").toLowerCase() === "paid")
        .filter((row) => inRange(row.paidAt || row.date, start, end))
        .reduce((sum, row) => sum + toMinor(row.amount), 0);

      const allSettlements = (states.get("finance_settlements") || []).filter(active);
      const settlements = allSettlements
        .filter((row) => inRange(row.settlementDate, start, end));
      const codFeesMinor = settlements.reduce(
        (sum, row) => sum + toMinor(row.fee),
        0,
      );
      const settlementCashInMinor = settlements.reduce(
        (sum, row) => sum + toMinor(row.amountReceived),
        0,
      );
      const settledOrderIds = new Set(
        allSettlements.map((row) => String(row.orderId || "")).filter(Boolean),
      );

      const damageRows = (states.get("damage") || [])
        .filter(active)
        .filter((row) =>
          ["damaged", "destroyed"].includes(
            String(row.status || "").toLowerCase(),
          ),
        )
        .filter((row) =>
          inRange(
            row.destroyedAt ||
              row.inspectedAt ||
              row.updatedAt ||
              row.date ||
              row.createdAt,
            start,
            end,
          ),
        );

      const damageSeen = new Set<string>();
      let damageLossMinor = 0;
      let damageValueMinor = 0;
      for (const row of damageRows) {
        const itemCode = String(row.itemCode || row.id || "");
        if (!itemCode || damageSeen.has(itemCode)) continue;
        damageSeen.add(itemCode);
        const rowCost = Number.isFinite(Number(row.costSnapshot))
          ? toMinor(row.costSnapshot)
          : itemCost.get(itemCode) || 0;
        damageValueMinor += rowCost;
        if (!deliveredCodes.has(itemCode)) damageLossMinor += rowCost;
      }

      const acquiredCodes = new Set(
        acquiredResult.rows.map((row) => row.item_code),
      );
      const incrementalDamageSeen = new Set<string>();
      let incrementalDamageMinor = 0;
      for (const row of damageRows) {
        const itemCode = String(row.itemCode || row.id || "");
        if (
          !itemCode ||
          acquiredCodes.has(itemCode) ||
          incrementalDamageSeen.has(itemCode)
        ) {
          continue;
        }
        incrementalDamageSeen.add(itemCode);
        incrementalDamageMinor += Number.isFinite(Number(row.costSnapshot))
          ? toMinor(row.costSnapshot)
          : itemCost.get(itemCode) || 0;
      }

      const grossRevenueMinor = deliveredResult.rows.reduce(
        (sum, row) => sum + Number(row.final_minor || 0),
        0,
      );
      const grossCogsMinor = deliveredResult.rows.reduce(
        (sum, row) => sum + Number(row.cogs_minor || 0),
        0,
      );
      const deliveryCostMinor = deliveredResult.rows.reduce(
        (sum, row) => sum + Number(row.delivery_cost_minor || 0),
        0,
      );
      const grossSoldUnits = deliveredResult.rows.reduce(
        (sum, row) => sum + Number(row.sold_units || 0),
        0,
      );

      const netRevenueMinor = grossRevenueMinor - refundsMinor;
      const netCogsMinor = Math.max(0, grossCogsMinor - cogsReversalMinor);
      const totalOperatingMinor =
        operatingExpenseMinor +
        codFeesMinor +
        damageLossMinor +
        returnCourierMinor +
        deliveryCostMinor;
      const totalCostMinor = netCogsMinor + totalOperatingMinor;

      const physicalItemCostMinor = acquiredResult.rows.reduce(
        (sum, row) => sum + Number(row.cost_snapshot_minor || 0),
        0,
      );
      const brandTotalCostMinor =
        physicalItemCostMinor +
        operatingExpenseMinor +
        codFeesMinor +
        returnCourierMinor +
        deliveryCostMinor +
        incrementalDamageMinor;

      const grossProfitMinor = netRevenueMinor - netCogsMinor;
      const netProfitMinor = netRevenueMinor - totalCostMinor;
      const brandNetProfitMinor = netRevenueMinor - brandTotalCostMinor;

      const customerOrders = new Map<string, number>();
      for (const order of deliveredResult.rows) {
        if (!order.customer_user_id) continue;
        customerOrders.set(
          order.customer_user_id,
          (customerOrders.get(order.customer_user_id) || 0) + 1,
        );
      }
      const uniqueCustomers = customerOrders.size;
      const returningCustomers = [...customerOrders.values()].filter(
        (count) => count >= 2,
      ).length;
      const oneTimeCustomers = [...customerOrders.values()].filter(
        (count) => count === 1,
      ).length;

      let fallbackCodCashInMinor = 0;
      for (const order of deliveredResult.rows) {
        const method = String(order.payment_method || "").toLowerCase();
        const isCod =
          method === "cod" || method.includes("cash on") || method === "cash";
        const paid = ["paid", "partially refunded", "refunded"].includes(
          String(order.payment_status || "").toLowerCase(),
        );
        if (!isCod || !paid || settledOrderIds.has(order.order_code)) continue;
        const paidMinor =
          Number(order.amount_paid_minor || 0) > 0
            ? Number(order.amount_paid_minor)
            : Number(order.final_minor || 0);
        fallbackCodCashInMinor += Math.max(0, paidMinor);
      }

      const cashInMinor =
        settlementCashInMinor + fallbackCodCashInMinor;
      const cashOutMinor =
        paidExpenseMinor +
        codFeesMinor +
        returnCourierMinor +
        deliveryCostMinor +
        refundsMinor;

      const marketingRows = (states.get("finance_marketing") || [])
        .filter(active)
        .filter((row) => inRange(row.date, start, end));
      const marketingMinor = marketingRows.reduce<{
        spend: number;
        revenue: number;
        impressions: number;
        clicks: number;
        orders: number;
      }>(
        (result, row) => {
          result.spend += toMinor(row.spend);
          result.revenue += toMinor(row.attributedRevenue);
          result.impressions += Math.max(0, Number(row.impressions) || 0);
          result.clicks += Math.max(0, Number(row.clicks) || 0);
          result.orders += Math.max(0, Number(row.orders) || 0);
          return result;
        },
        { spend: 0, revenue: 0, impressions: 0, clicks: 0, orders: 0 },
      );

      const returnedUnits = refundsRows.length;
      const soldUnits = Math.max(0, grossSoldUnits - returnedUnits);
      const marketingSpend = money(marketingMinor.spend);
      const marketingRevenue = money(marketingMinor.revenue);

      const summary: FinanceSummary = {
        grossRevenue: money(grossRevenueMinor),
        refunds: money(refundsMinor),
        netRevenue: money(netRevenueMinor),
        grossCogs: money(grossCogsMinor),
        cogsReversal: money(cogsReversalMinor),
        netCogs: money(netCogsMinor),
        operatingExpenses: money(operatingExpenseMinor),
        codFees: money(codFeesMinor),
        damageLoss: money(damageLossMinor),
        damageValue: money(damageValueMinor),
        returnCourierCosts: money(returnCourierMinor),
        deliveryCosts: money(deliveryCostMinor),
        totalOperatingExpenses: money(totalOperatingMinor),
        totalCost: money(totalCostMinor),
        grossProfit: money(grossProfitMinor),
        netProfit: money(netProfitMinor),
        physicalItemCost: money(physicalItemCostMinor),
        incrementalDamage: money(incrementalDamageMinor),
        brandTotalCost: money(brandTotalCostMinor),
        brandNetProfit: money(brandNetProfitMinor),
        margin: netRevenueMinor !== 0
          ? metric((netProfitMinor / netRevenueMinor) * 100)
          : 0,
        grossMargin: netRevenueMinor !== 0
          ? metric((grossProfitMinor / netRevenueMinor) * 100)
          : 0,
        deliveredOrders: deliveredResult.rows.length,
        grossSoldUnits,
        returnedUnits,
        soldUnits,
        averageOrderValue:
          deliveredResult.rows.length > 0
            ? money(Math.round(netRevenueMinor / deliveredResult.rows.length))
            : 0,
        uniqueCustomers,
        returningCustomers,
        oneTimeCustomers,
        repeatRate: uniqueCustomers > 0
          ? metric((returningCustomers / uniqueCustomers) * 100)
          : 0,
        cashIn: money(cashInMinor),
        cashOut: money(cashOutMinor),
        netCashFlow: money(cashInMinor - cashOutMinor),
        paidExpenseCashOut: money(paidExpenseMinor),
        refundCashOut: money(refundsMinor),
        marketing: {
          spend: marketingSpend,
          revenue: marketingRevenue,
          roas: marketingSpend ? metric(marketingRevenue / marketingSpend) : 0,
          cac:
            marketingMinor.orders > 0
              ? metric(marketingSpend / marketingMinor.orders)
              : 0,
          ctr:
            marketingMinor.impressions > 0
              ? metric((marketingMinor.clicks / marketingMinor.impressions) * 100)
              : 0,
          cpc:
            marketingMinor.clicks > 0
              ? metric(marketingSpend / marketingMinor.clicks)
              : 0,
          conversion:
            marketingMinor.clicks > 0
              ? metric((marketingMinor.orders / marketingMinor.clicks) * 100)
              : 0,
          impressions: marketingMinor.impressions,
          clicks: marketingMinor.clicks,
          orders: marketingMinor.orders,
        },
      };
      await client.query("COMMIT");
      return summary;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
