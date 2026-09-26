// DART CODE GUIDE | backend/src/modules/analytics/traffic-analytics.service.ts
// الغرض: تسجيل وتحليل زيارات الموقع ومسار التحويل من PostgreSQL.
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

export type TrafficEventType = "visit" | "add_to_cart";
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
  reservationId?: string | undefined;
}

interface GroupedRow {
  bucket_key: string | number;
  unique_visitors: string;
  visits: string;
  add_to_cart_visitors: string;
  add_events: string;
  items_added: string;
  orders: string;
  ordered_pieces: string;
}

interface TotalsRow {
  unique_visitors: string;
  visits: string;
  add_to_cart_visitors: string;
  add_events: string;
  items_added: string;
}

interface OrderTotalsRow {
  order_visitors: string;
  orders: string;
  ordered_pieces: string;
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
  return Math.min(100, Math.round((part / total) * 10_000) / 100);
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

export interface TrafficSeriesPoint {
  key: string;
  label: string;
  uniqueVisitors: number;
  visits: number;
  addToCartVisitors: number;
  addToCartEvents: number;
  itemsAdded: number;
  orders: number;
  orderedPieces: number;
}

function emptySeriesPoint(key: string, label: string): TrafficSeriesPoint {
  return {
    key,
    label,
    uniqueVisitors: 0,
    visits: 0,
    addToCartVisitors: 0,
    addToCartEvents: 0,
    itemsAdded: 0,
    orders: 0,
    orderedPieces: 0,
  };
}

export function buildTrafficSeries(
  rows: Array<Omit<TrafficSeriesPoint, "label">>,
  start: string,
  end: string,
  group: Exclude<TrafficGroup, "hourly">,
): TrafficSeriesPoint[] {
  const buckets = new Map<string, TrafficSeriesPoint>();
  const startTime = utcDate(start).getTime();
  let day = start;
  let guard = 0;
  while (day <= end && guard < 3660) {
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
    if (!buckets.has(key)) buckets.set(key, emptySeriesPoint(key, label));
    day = addDays(day, 1);
    guard += 1;
  }
  rows.forEach((row) => {
    const current = buckets.get(row.key);
    if (!current) return;
    Object.assign(current, row);
  });
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
    orderedPieces: number;
  }>,
): TrafficSeriesPoint[] {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    const suffix = hour < 12 ? "AM" : "PM";
    const displayHour = hour % 12 || 12;
    return {
      key: `hour-${String(hour).padStart(2, "0")}`,
      label: `${displayHour} ${suffix}`,
      uniqueVisitors: row?.uniqueVisitors || 0,
      visits: row?.visits || 0,
      addToCartVisitors: row?.addToCartVisitors || 0,
      addToCartEvents: row?.addEvents || 0,
      itemsAdded: row?.itemsAdded || 0,
      orders: row?.orders || 0,
      orderedPieces: row?.orderedPieces || 0,
    };
  });
}

function bucketExpression(group: Exclude<TrafficGroup, "hourly">, column: string): string {
  const local = `(${column} AT TIME ZONE 'Africa/Cairo')`;
  if (group === "daily") return `to_char(${local}::date, 'YYYY-MM-DD')`;
  if (group === "weekly") {
    return `'week-' || (floor(((${local}::date - $1::date) / 7.0))::int + 1)::text`;
  }
  if (group === "monthly") return `to_char(${local}, 'YYYY-MM')`;
  return `to_char(${local}, 'YYYY')`;
}

export class TrafficAnalyticsService {
  public constructor(private readonly pool: Pool) {}

  public async recordEvent(input: TrafficEventInput, customerUserId: string | null, guestOwnerHash: string | null = null): Promise<void> {
    if (
      input.eventType === "add_to_cart" &&
      (!input.eventId || !input.reservationId || !input.modelId || !input.quantity)
    ) {
      throw new AppError(422, "ANALYTICS_ADD_EVENT_INVALID", "Add-to-cart analytics require an event id, reservation, model and quantity");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.eventType === "add_to_cart") {
        const reservation = await client.query<{ reserved_count: string; customer_user_id: string | null; guest_owner_hash: string | null }>(
          `SELECT count(items.id)::text AS reserved_count,
                  reservation.customer_user_id::text,
                  reservation.guest_owner_hash
             FROM cart_reservations reservation
             JOIN inventory_items items
               ON items.cart_reservation_id=reservation.id
              AND lower(items.status)='cart reserved'
            WHERE reservation.id=$1
              AND reservation.expires_at > now()
              AND items.model_id=$2
              AND items.color=$3
              AND items.size=$4
            GROUP BY reservation.id, reservation.customer_user_id, reservation.guest_owner_hash`,
          [input.reservationId, input.modelId, input.color || "", input.size || ""],
        );
        const row = reservation.rows[0];
        if (!row || count(row.reserved_count) < Number(input.quantity || 0)) {
          throw new AppError(409, "ANALYTICS_CART_RESERVATION_INVALID", "The Add to Cart event does not match an active reserved cart variant");
        }
        if (row.customer_user_id) {
          if (!customerUserId || row.customer_user_id !== customerUserId) {
            throw new AppError(403, "ANALYTICS_CART_FORBIDDEN", "This cart reservation does not belong to the signed-in customer");
          }
        } else if (!row.guest_owner_hash || !guestOwnerHash || row.guest_owner_hash !== guestOwnerHash) {
          throw new AppError(403, "ANALYTICS_CART_FORBIDDEN", "This guest cart reservation does not belong to this browser");
        }
      }

      const eventKey = input.eventType === "visit"
        ? `visit:${input.visitorId}:${input.sessionId}`
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
          null,
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
    if (group === "hourly" && spanDays > 31) {
      throw new AppError(422, "ANALYTICS_HOURLY_RANGE_TOO_LARGE", "Hourly analytics are limited to 31 days");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const params = [start, end];
      const eventPeriodWhere = `event.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
        AND event.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`;
      const orderPeriodWhere = `orders.created_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
        AND orders.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`;

      const totalsResult = await client.query<TotalsRow>(
        `SELECT
           count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='visit')::text AS unique_visitors,
           count(*) FILTER (WHERE event.event_type='visit')::text AS visits,
           count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='add_to_cart')::text AS add_to_cart_visitors,
           count(*) FILTER (WHERE event.event_type='add_to_cart')::text AS add_events,
           COALESCE(sum(event.quantity) FILTER (WHERE event.event_type='add_to_cart'),0)::text AS items_added
         FROM traffic_analytics_events event
         WHERE ${eventPeriodWhere}`,
        params,
      );

      const orderTotalsResult = await client.query<OrderTotalsRow>(
        `SELECT
           count(DISTINCT orders.customer_user_id)::text AS order_visitors,
           count(DISTINCT orders.id)::text AS orders,
           count(order_items.id)::text AS ordered_pieces
         FROM orders
         LEFT JOIN order_items ON order_items.order_id=orders.id
         WHERE NOT orders.is_deleted
           AND orders.order_source='Website'
           AND ${orderPeriodWhere}`,
        params,
      );

      let groupedRows: GroupedRow[] = [];
      if (group === "hourly") {
        const groupedResult = await client.query<GroupedRow>(
          `WITH event_stats AS (
             SELECT EXTRACT(HOUR FROM event.occurred_at AT TIME ZONE 'Africa/Cairo')::int::text AS bucket_key,
               count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='visit')::text AS unique_visitors,
               count(*) FILTER (WHERE event.event_type='visit')::text AS visits,
               count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='add_to_cart')::text AS add_to_cart_visitors,
               count(*) FILTER (WHERE event.event_type='add_to_cart')::text AS add_events,
               COALESCE(sum(event.quantity) FILTER (WHERE event.event_type='add_to_cart'),0)::text AS items_added
             FROM traffic_analytics_events event
             WHERE ${eventPeriodWhere}
             GROUP BY 1
           ), order_stats AS (
             SELECT EXTRACT(HOUR FROM orders.created_at AT TIME ZONE 'Africa/Cairo')::int::text AS bucket_key,
               count(DISTINCT orders.id)::text AS orders,
               count(order_items.id)::text AS ordered_pieces
             FROM orders
             LEFT JOIN order_items ON order_items.order_id=orders.id
             WHERE NOT orders.is_deleted
               AND orders.order_source='Website'
               AND ${orderPeriodWhere}
             GROUP BY 1
           )
           SELECT COALESCE(event_stats.bucket_key, order_stats.bucket_key) AS bucket_key,
             COALESCE(event_stats.unique_visitors,'0') AS unique_visitors,
             COALESCE(event_stats.visits,'0') AS visits,
             COALESCE(event_stats.add_to_cart_visitors,'0') AS add_to_cart_visitors,
             COALESCE(event_stats.add_events,'0') AS add_events,
             COALESCE(event_stats.items_added,'0') AS items_added,
             COALESCE(order_stats.orders,'0') AS orders,
             COALESCE(order_stats.ordered_pieces,'0') AS ordered_pieces
           FROM event_stats
           FULL OUTER JOIN order_stats USING (bucket_key)
           ORDER BY COALESCE(event_stats.bucket_key, order_stats.bucket_key)::int`,
          params,
        );
        groupedRows = groupedResult.rows;
      } else {
        const eventBucket = bucketExpression(group, "event.occurred_at");
        const orderBucket = bucketExpression(group, "orders.created_at");
        const groupedResult = await client.query<GroupedRow>(
          `WITH event_stats AS (
             SELECT ${eventBucket} AS bucket_key,
               count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='visit')::text AS unique_visitors,
               count(*) FILTER (WHERE event.event_type='visit')::text AS visits,
               count(DISTINCT COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text)) FILTER (WHERE event.event_type='add_to_cart')::text AS add_to_cart_visitors,
               count(*) FILTER (WHERE event.event_type='add_to_cart')::text AS add_events,
               COALESCE(sum(event.quantity) FILTER (WHERE event.event_type='add_to_cart'),0)::text AS items_added
             FROM traffic_analytics_events event
             WHERE ${eventPeriodWhere}
             GROUP BY 1
           ), order_stats AS (
             SELECT ${orderBucket} AS bucket_key,
               count(DISTINCT orders.id)::text AS orders,
               count(order_items.id)::text AS ordered_pieces
             FROM orders
             LEFT JOIN order_items ON order_items.order_id=orders.id
             WHERE NOT orders.is_deleted
               AND orders.order_source='Website'
               AND ${orderPeriodWhere}
             GROUP BY 1
           )
           SELECT COALESCE(event_stats.bucket_key, order_stats.bucket_key) AS bucket_key,
             COALESCE(event_stats.unique_visitors,'0') AS unique_visitors,
             COALESCE(event_stats.visits,'0') AS visits,
             COALESCE(event_stats.add_to_cart_visitors,'0') AS add_to_cart_visitors,
             COALESCE(event_stats.add_events,'0') AS add_events,
             COALESCE(event_stats.items_added,'0') AS items_added,
             COALESCE(order_stats.orders,'0') AS orders,
             COALESCE(order_stats.ordered_pieces,'0') AS ordered_pieces
           FROM event_stats
           FULL OUTER JOIN order_stats USING (bucket_key)
           ORDER BY COALESCE(event_stats.bucket_key, order_stats.bucket_key)`,
          params,
        );
        groupedRows = groupedResult.rows;
      }

      const visitorsResult = await client.query<VisitorRow>(
        `WITH period_events AS (
           SELECT event.*, COALESCE(event.customer_user_id::text, 'guest:' || event.visitor_id::text) AS identity_key
           FROM traffic_analytics_events event
           WHERE ${eventPeriodWhere}
         ), visitor_stats AS (
           SELECT identity_key,
             min(visitor_id::text) AS visitor_id,
             max(customer_user_id::text) AS customer_user_id,
             count(*) FILTER (WHERE event_type='visit')::text AS visits,
             count(*) FILTER (WHERE event_type='add_to_cart')::text AS add_events,
             COALESCE(sum(quantity) FILTER (WHERE event_type='add_to_cart'),0)::text AS items_added,
             min(occurred_at) FILTER (WHERE event_type='visit') AS first_visit,
             max(occurred_at) FILTER (WHERE event_type='visit') AS last_visit
           FROM period_events
           GROUP BY identity_key
         ), order_stats AS (
           SELECT orders.customer_user_id::text AS customer_user_id, count(*)::text AS orders
           FROM orders
           WHERE orders.customer_user_id IS NOT NULL
             AND NOT orders.is_deleted
             AND orders.order_source='Website'
             AND ${orderPeriodWhere}
           GROUP BY orders.customer_user_id
         )
         SELECT stats.visitor_id, stats.customer_user_id, customers.full_name, customers.client_code,
           stats.visits, stats.add_events, stats.items_added, COALESCE(order_stats.orders,'0') AS orders,
           stats.first_visit, stats.last_visit
         FROM visitor_stats stats
         LEFT JOIN customers ON customers.user_id=stats.customer_user_id::uuid
         LEFT JOIN order_stats ON order_stats.customer_user_id=stats.customer_user_id
         ORDER BY stats.visits::bigint DESC, stats.add_events::bigint DESC, stats.last_visit DESC NULLS LAST
         LIMIT 250`,
        params,
      );

      await client.query("COMMIT");
      const totals = totalsResult.rows[0] || {
        unique_visitors: "0", visits: "0", add_to_cart_visitors: "0", add_events: "0", items_added: "0",
      };
      const orderTotals = orderTotalsResult.rows[0] || { order_visitors: "0", orders: "0", ordered_pieces: "0" };
      const uniqueVisitors = count(totals.unique_visitors);
      const addToCartVisitors = count(totals.add_to_cart_visitors);
      const orderVisitors = count(orderTotals.order_visitors);
      const normalizedRows = groupedRows.map((row) => ({
        key: String(row.bucket_key),
        uniqueVisitors: count(row.unique_visitors),
        visits: count(row.visits),
        addToCartVisitors: count(row.add_to_cart_visitors),
        addToCartEvents: count(row.add_events),
        itemsAdded: count(row.items_added),
        orders: count(row.orders),
        orderedPieces: count(row.ordered_pieces),
      }));
      const series = group === "hourly"
        ? buildHourlyTrafficSeries(normalizedRows.map((row) => ({
          hour: count(row.key),
          uniqueVisitors: row.uniqueVisitors,
          visits: row.visits,
          addToCartVisitors: row.addToCartVisitors,
          addEvents: row.addToCartEvents,
          itemsAdded: row.itemsAdded,
          orders: row.orders,
          orderedPieces: row.orderedPieces,
        })))
        : buildTrafficSeries(normalizedRows, start, end, group);

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
          completedOrders: count(orderTotals.orders),
          ordersPlaced: count(orderTotals.orders),
          orderedPieces: count(orderTotals.ordered_pieces),
          addToCartRate: percent(addToCartVisitors, uniqueVisitors),
          conversionRate: percent(orderVisitors, uniqueVisitors),
        },
        series,
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
