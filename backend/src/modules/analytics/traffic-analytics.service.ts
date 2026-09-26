// DART CODE GUIDE | backend/src/modules/analytics/traffic-analytics.service.ts
// الغرض: تسجيل وتحليل زيارات الموقع ومسار التحويل من PostgreSQL.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export type TrafficEventType = "visit" | "add_to_cart" | "order_completed";
export type TrafficGroup = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export interface TrafficEventInput {
  eventType: TrafficEventType;
  eventId?: string | undefined;
  visitorId: string;
  sessionId: string;
  path?: string | undefined;
  modelId?: string | undefined;
  color?: string | undefined;
  size?: string | undefined;
  quantity?: number | undefined;
  orderCode?: string | undefined;
  reservationId?: string | undefined;
}

interface DailyRow {
  day: string | Date;
  visits: string;
  add_events: string;
  items_added: string;
  orders: string;
}

interface HourlyRow {
  hour_of_day: string | number;
  unique_visitors: string;
  visits: string;
  add_to_cart_visitors: string;
  add_events: string;
  items_added: string;
  orders: string;
}

interface TotalsRow {
  unique_visitors: string;
  visits: string;
  add_to_cart_visitors: string;
  add_events: string;
  items_added: string;
  order_visitors: string;
  orders: string;
}

interface VisitorRow {
  visitor_id: string;
  customer_user_id: string | null;
  full_name: string | null;
  client_code: string | null;
  visits: string;
  add_events: string;
  items_added: string;
  orders: string;
  first_visit: Date | null;
  last_visit: Date | null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 100;
}

function dateOnly(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number): string {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return isoDate(value);
}

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function yearKey(day: string): string {
  return day.slice(0, 4);
}

function formatDay(day: string): string {
  return utcDate(day).toLocaleDateString("en-EG", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function formatMonth(key: string): string {
  return utcDate(`${key}-01`).toLocaleDateString("en-EG", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
}

export function buildTrafficSeries(
  dailyRows: Array<{ day: string; visits: number; addEvents: number; itemsAdded: number; orders: number }>,
  start: string,
  end: string,
  group: TrafficGroup,
): Array<{ key: string; label: string; visits: number; addToCartEvents: number; itemsAdded: number; orders: number }> {
  const byDay = new Map(dailyRows.map((row) => [row.day, row]));
  const buckets = new Map<string, { key: string; label: string; visits: number; addToCartEvents: number; itemsAdded: number; orders: number }>();
  const startTime = utcDate(start).getTime();
  let day = start;
  let guard = 0;
  while (day <= end && guard < 3660) {
    const row = byDay.get(day) || { day, visits: 0, addEvents: 0, itemsAdded: 0, orders: 0 };
    let key = day;
    let label = formatDay(day);
    if (group === "weekly") {
      const offset = Math.floor((utcDate(day).getTime() - startTime) / 86_400_000);
      const index = Math.floor(offset / 7);
      const bucketStart = addDays(start, index * 7);
      const bucketEnd = addDays(bucketStart, 6) > end ? end : addDays(bucketStart, 6);
      key = `week-${index + 1}`;
      label = `${formatDay(bucketStart)} – ${formatDay(bucketEnd)}`;
    } else if (group === "monthly") {
      key = monthKey(day);
      label = formatMonth(key);
    } else if (group === "yearly") {
      key = yearKey(day);
      label = key;
    }
    const current = buckets.get(key) || {
      key,
      label,
      visits: 0,
      addToCartEvents: 0,
      itemsAdded: 0,
      orders: 0,
    };
    current.visits += row.visits;
    current.addToCartEvents += row.addEvents;
    current.itemsAdded += row.itemsAdded;
    current.orders += row.orders;
    buckets.set(key, current);
    day = addDays(day, 1);
    guard += 1;
  }
  return [...buckets.values()];
}

export function buildHourlyTrafficSeries(
  rows: Array<{
    hour: number;
    uniqueVisitors: number;
    visits: number;
    addToCartVisitors: number;
    addEvents: number;
    itemsAdded: number;
    orders: number;
  }>,
): Array<{
  key: string;
  label: string;
  uniqueVisitors: number;
  visits: number;
  addToCartVisitors: number;
  addToCartEvents: number;
  itemsAdded: number;
  orders: number;
}> {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour) || {
      hour,
      uniqueVisitors: 0,
      visits: 0,
      addToCartVisitors: 0,
      addEvents: 0,
      itemsAdded: 0,
      orders: 0,
    };
    const suffix = hour < 12 ? "AM" : "PM";
    const displayHour = hour % 12 || 12;
    return {
      key: `hour-${String(hour).padStart(2, "0")}`,
      label: `${displayHour} ${suffix}`,
      uniqueVisitors: row.uniqueVisitors,
      visits: row.visits,
      addToCartVisitors: row.addToCartVisitors,
      addToCartEvents: row.addEvents,
      itemsAdded: row.itemsAdded,
      orders: row.orders,
    };
  });
}

export class TrafficAnalyticsService {
  public constructor(private readonly pool: Pool) {}

  public async recordEvent(input: TrafficEventInput, customerUserId: string | null): Promise<void> {
    if (
      input.eventType === "add_to_cart" &&
      (!input.eventId || !input.reservationId || !input.modelId || !input.quantity)
    ) {
      throw new AppError(422, "ANALYTICS_ADD_EVENT_INVALID", "Add-to-cart analytics require an event id, reservation, model and quantity");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let orderCode: string | null = null;
      if (input.eventType === "add_to_cart") {
        const reservation = await client.query<{ reserved_count: string; customer_user_id: string | null }>(
          `SELECT count(items.id)::text AS reserved_count,
                  reservation.customer_user_id::text
             FROM cart_reservations reservation
             JOIN inventory_items items
               ON items.cart_reservation_id=reservation.id
              AND lower(items.status)='cart reserved'
            WHERE reservation.id=$1
              AND reservation.expires_at > now()
              AND items.model_id=$2
              AND items.color=$3
              AND items.size=$4
            GROUP BY reservation.id, reservation.customer_user_id`,
          [input.reservationId, input.modelId, input.color || "", input.size || ""],
        );
        const row = reservation.rows[0];
        if (!row || count(row.reserved_count) < Number(input.quantity || 0)) {
          throw new AppError(409, "ANALYTICS_CART_RESERVATION_INVALID", "The Add to Cart event does not match an active reserved cart variant");
        }
        if (customerUserId && row.customer_user_id && row.customer_user_id !== customerUserId) {
          throw new AppError(403, "ANALYTICS_CART_FORBIDDEN", "This cart reservation does not belong to the signed-in customer");
        }
      }
      if (input.eventType === "order_completed") {
        orderCode = String(input.orderCode || "").trim();
        if (!orderCode || !customerUserId) {
          throw new AppError(401, "ANALYTICS_ORDER_AUTH_REQUIRED", "Sign in before recording an order conversion");
        }
        const order = await client.query<{ customer_user_id: string | null }>(
          `SELECT customer_user_id::text
             FROM orders
            WHERE order_code=$1 AND NOT is_deleted
            LIMIT 1`,
          [orderCode],
        );
        const row = order.rows[0];
        if (!row) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
        if (row.customer_user_id && row.customer_user_id !== customerUserId) {
          throw new AppError(403, "ANALYTICS_ORDER_FORBIDDEN", "This order does not belong to the signed-in customer");
        }
      }

      const eventKey =
        input.eventType === "visit"
          ? `visit:${input.visitorId}:${input.sessionId}`
          : input.eventType === "order_completed"
            ? `order:${orderCode}`
            : `add:${input.eventId}`;

      await client.query(
        `INSERT INTO traffic_analytics_events (
           event_key, event_type, visitor_id, session_id, customer_user_id,
           order_code, reservation_id, path, model_id, color, size, quantity
         ) VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (event_key) DO NOTHING`,
        [
          eventKey,
          input.eventType,
          input.visitorId,
          input.sessionId,
          customerUserId,
          orderCode,
          input.reservationId || null,
          input.path || null,
          input.modelId || null,
          input.color || null,
          input.size || null,
          input.quantity || null,
        ],
      );

      if (customerUserId) {
        await client.query(
          `UPDATE traffic_analytics_events
              SET customer_user_id=$2::uuid
            WHERE visitor_id=$1::uuid
              AND customer_user_id IS NULL`,
          [input.visitorId, customerUserId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async report(start: string, end: string, group: TrafficGroup) {
    if (start > end) throw new AppError(422, "INVALID_ANALYTICS_RANGE", "start must be on or before end");
    const startDate = utcDate(start);
    const endDate = utcDate(end);
    const spanDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (!Number.isFinite(spanDays) || spanDays < 1 || spanDays > 3660) {
      throw new AppError(422, "ANALYTICS_RANGE_TOO_LARGE", "Analytics range must be 10 years or less");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const params = [start, end];
      const periodWhere = `occurred_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
        AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`;

      const totalsResult = await client.query<TotalsRow>(
        `SELECT
           count(DISTINCT COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)) FILTER (WHERE event_type='visit')::text AS unique_visitors,
           count(*) FILTER (WHERE event_type='visit')::text AS visits,
           count(DISTINCT COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)) FILTER (WHERE event_type='add_to_cart')::text AS add_to_cart_visitors,
           count(*) FILTER (WHERE event_type='add_to_cart')::text AS add_events,
           COALESCE(sum(quantity) FILTER (WHERE event_type='add_to_cart'),0)::text AS items_added,
           count(DISTINCT COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)) FILTER (WHERE event_type='order_completed')::text AS order_visitors,
           count(*) FILTER (WHERE event_type='order_completed')::text AS orders
         FROM traffic_analytics_events
         WHERE ${periodWhere}`,
        params,
      );

      const dailyResult = group === "hourly"
        ? { rows: [] as DailyRow[] }
        : await client.query<DailyRow>(
          `SELECT (occurred_at AT TIME ZONE 'Africa/Cairo')::date AS day,
             count(*) FILTER (WHERE event_type='visit')::text AS visits,
             count(*) FILTER (WHERE event_type='add_to_cart')::text AS add_events,
             COALESCE(sum(quantity) FILTER (WHERE event_type='add_to_cart'),0)::text AS items_added,
             count(*) FILTER (WHERE event_type='order_completed')::text AS orders
           FROM traffic_analytics_events
           WHERE ${periodWhere}
           GROUP BY 1
           ORDER BY 1`,
          params,
        );

      const hourlyResult = group === "hourly"
        ? await client.query<HourlyRow>(
          `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Africa/Cairo')::int AS hour_of_day,
             count(DISTINCT COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)) FILTER (WHERE event_type='visit')::text AS unique_visitors,
             count(*) FILTER (WHERE event_type='visit')::text AS visits,
             count(DISTINCT COALESCE(customer_user_id::text, 'guest:' || visitor_id::text)) FILTER (WHERE event_type='add_to_cart')::text AS add_to_cart_visitors,
             count(*) FILTER (WHERE event_type='add_to_cart')::text AS add_events,
             COALESCE(sum(quantity) FILTER (WHERE event_type='add_to_cart'),0)::text AS items_added,
             count(*) FILTER (WHERE event_type='order_completed')::text AS orders
           FROM traffic_analytics_events
           WHERE ${periodWhere}
           GROUP BY 1
           ORDER BY 1`,
          params,
        )
        : { rows: [] as HourlyRow[] };

      const visitorsResult = await client.query<VisitorRow>(
        `WITH period_events AS (
           SELECT *, COALESCE(customer_user_id::text, 'guest:' || visitor_id::text) AS identity_key
           FROM traffic_analytics_events
           WHERE ${periodWhere}
         ), visitor_stats AS (
           SELECT identity_key,
             min(visitor_id::text) AS visitor_id,
             max(customer_user_id::text) AS customer_user_id,
             count(*) FILTER (WHERE event_type='visit')::text AS visits,
             count(*) FILTER (WHERE event_type='add_to_cart')::text AS add_events,
             COALESCE(sum(quantity) FILTER (WHERE event_type='add_to_cart'),0)::text AS items_added,
             count(*) FILTER (WHERE event_type='order_completed')::text AS orders,
             min(occurred_at) FILTER (WHERE event_type='visit') AS first_visit,
             max(occurred_at) FILTER (WHERE event_type='visit') AS last_visit
           FROM period_events
           GROUP BY identity_key
         )
         SELECT stats.visitor_id,
           stats.customer_user_id,
           customers.full_name,
           customers.client_code,
           stats.visits, stats.add_events, stats.items_added, stats.orders,
           stats.first_visit, stats.last_visit
         FROM visitor_stats stats
         LEFT JOIN customers ON customers.user_id=stats.customer_user_id::uuid
         ORDER BY stats.visits::bigint DESC, stats.add_events::bigint DESC, stats.last_visit DESC NULLS LAST
         LIMIT 250`,
        params,
      );

      await client.query("COMMIT");
      const totals = totalsResult.rows[0] || {
        unique_visitors: "0", visits: "0", add_to_cart_visitors: "0",
        add_events: "0", items_added: "0", order_visitors: "0", orders: "0",
      };
      const uniqueVisitors = count(totals.unique_visitors);
      const addToCartVisitors = count(totals.add_to_cart_visitors);
      const orderVisitors = count(totals.order_visitors);
      const daily = dailyResult.rows.map((row) => ({
        day: dateOnly(row.day),
        visits: count(row.visits),
        addEvents: count(row.add_events),
        itemsAdded: count(row.items_added),
        orders: count(row.orders),
      }));
      const hourly = hourlyResult.rows.map((row) => ({
        hour: count(row.hour_of_day),
        uniqueVisitors: count(row.unique_visitors),
        visits: count(row.visits),
        addToCartVisitors: count(row.add_to_cart_visitors),
        addEvents: count(row.add_events),
        itemsAdded: count(row.items_added),
        orders: count(row.orders),
      }));
      return {
        start,
        end,
        group,
        summary: {
          uniqueVisitors,
          visits: count(totals.visits),
          addToCartVisitors,
          addToCartEvents: count(totals.add_events),
          itemsAdded: count(totals.items_added),
          completedOrders: count(totals.orders),
          addToCartRate: percent(addToCartVisitors, uniqueVisitors),
          conversionRate: percent(orderVisitors, uniqueVisitors),
        },
        series: group === "hourly"
          ? buildHourlyTrafficSeries(hourly)
          : buildTrafficSeries(daily, start, end, group),
        visitors: visitorsResult.rows.map((row) => ({
          visitorId: row.visitor_id,
          customerUserId: row.customer_user_id,
          name: row.full_name || `Guest ${row.visitor_id.slice(0, 8)}`,
          clientCode: row.client_code,
          type: row.customer_user_id ? "Customer" : "Guest",
          visits: count(row.visits),
          addToCartEvents: count(row.add_events),
          itemsAdded: count(row.items_added),
          completedOrders: count(row.orders),
          firstVisit: row.first_visit?.toISOString() || null,
          lastVisit: row.last_visit?.toISOString() || null,
        })),
        detailsLimit: 250,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
