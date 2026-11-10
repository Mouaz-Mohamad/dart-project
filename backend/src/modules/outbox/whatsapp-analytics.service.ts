// DART CODE GUIDE | backend/src/modules/outbox/whatsapp-analytics.service.ts
// الغرض: إحصائيات رسائل واتساب من Neon فقط، وفق حالات Meta الفعلية مع إخفاء بيانات العملاء.
import type { Pool } from "pg";

export const WHATSAPP_ANALYTICS_TYPES = [
  "ORDER_WHATSAPP_CONFIRMATION",
  "ORDER_WHATSAPP_ACK",
  "ORDER_WHATSAPP_DISPATCHED",
  "CUSTOMER_POST_DELIVERY_REVIEW",
  "CUSTOMER_BIRTHDAY_MESSAGE",
  "WAITLIST_WHATSAPP_RESTOCK",
] as const;
export type WhatsAppAnalyticsPeriod = "today" | "month" | "all";
export type WhatsAppAnalyticsStatus = "all" | "delivered" | "read" | "pending" | "sent" | "failed" | "attention" | "suppressed";
export type WhatsAppAnalyticsType = typeof WHATSAPP_ANALYTICS_TYPES[number] | "all";

export interface WhatsAppAnalyticsQuery {
  period: WhatsAppAnalyticsPeriod;
  type?: WhatsAppAnalyticsType;
  status?: WhatsAppAnalyticsStatus;
  limit?: number;
  offset?: number;
}

interface StatsRow {
  event_type: string;
  total: string;
  delivered: string;
  read: string;
  pending: string;
  sent: string;
  failed: string;
  attention: string;
  suppressed: string;
}
interface DetailRow {
  id: string;
  event_type: string;
  delivery_state: string;
  provider_state: string | null;
  delivery_error_code: string | null;
  last_error: string | null;
  attempts: number;
  recipient: string;
  order_code: string | null;
  order_source: string | null;
  created_at: Date;
  available_at: Date;
  published_at: Date | null;
}

const metrics = ["total", "delivered", "read", "pending", "sent", "failed", "attention", "suppressed"] as const;
type Metric = typeof metrics[number];
export type WhatsAppMetrics = Record<Metric, number>;
const zeros = (): WhatsAppMetrics => ({total:0,delivered:0,read:0,pending:0,sent:0,failed:0,attention:0,suppressed:0});

const source = `
  WITH messages AS (
    SELECT e.id,e.aggregate_type,e.aggregate_id,e.event_type,e.created_at,e.available_at,e.published_at,
      e.attempts,e.status,e.last_error,e.payload->>'to' AS recipient,
      a.state AS provider_state,a.delivery_status,a.delivery_error_code,a.last_error AS attempt_error,
      CASE
        WHEN a.delivery_status='read' THEN 'read'
        WHEN a.delivery_status='delivered' THEN 'delivered'
        WHEN a.delivery_status='failed' THEN 'failed'
        WHEN a.state='suppressed' THEN 'suppressed'
        WHEN a.state='terminal' OR (e.attempts>=12 AND e.status<>'published') THEN 'failed'
        WHEN a.state='unknown' OR (a.state='executing' AND a.updated_at < now()-interval '5 minutes') THEN 'attention'
        WHEN e.status='published' OR a.state='accepted' THEN 'sent'
        ELSE 'pending'
      END AS delivery_state
    FROM outbox_events e
    LEFT JOIN LATERAL (
      SELECT state,delivery_status,delivery_error_code,last_error,updated_at
        FROM outbox_delivery_attempts
       WHERE event_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1
    ) a ON TRUE
    WHERE e.payload->>'channel'='whatsapp'
      AND ($1::text='all' OR e.created_at >= CASE
        WHEN $1::text='today' THEN date_trunc('day',now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
        ELSE date_trunc('month',now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
      END)
  )
`;

function maskPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? `***${digits.slice(-4)}` : "***";
}
function safeError(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]")
    .replace(/\b\d{8,15}\b/g,"[phone]").slice(0,180);
}

/** Totals include every matching message, not just the latest 50 receipts. */
export async function whatsappAnalytics(pool: Pick<Pool,"query">, query: WhatsAppAnalyticsQuery) {
  const summarySql = source + `
    SELECT event_type,
      count(*)::text AS total,
      count(*) FILTER (WHERE delivery_state IN ('delivered','read'))::text AS delivered,
      count(*) FILTER (WHERE delivery_state='read')::text AS read,
      count(*) FILTER (WHERE delivery_state IN ('pending','sent'))::text AS pending,
      count(*) FILTER (WHERE delivery_state='sent')::text AS sent,
      count(*) FILTER (WHERE delivery_state='failed')::text AS failed,
      count(*) FILTER (WHERE delivery_state='attention')::text AS attention,
      count(*) FILTER (WHERE delivery_state='suppressed')::text AS suppressed
    FROM messages GROUP BY event_type ORDER BY event_type`;
  const result = await pool.query<StatsRow>(summarySql,[query.period]);
  const templates = result.rows.map((row) => ({
    eventType:row.event_type,
    ...Object.fromEntries(metrics.map(metric => [metric,Number(row[metric] || 0)])) as WhatsAppMetrics,
  }));
  const totals = zeros();
  for(const row of templates)for(const metric of metrics)totals[metric]+=row[metric];

  const limit = Math.min(50,Math.max(1,query.limit ?? 40));
  const offset = Math.min(5000,Math.max(0,query.offset ?? 0));
  const type = query.type || "all";
  const status = query.status || "all";
  if (!query.type) return {period:query.period,asOf:new Date().toISOString(),totals,templates};

  const rows = await pool.query<DetailRow>(source + `
    SELECT m.id::text,m.event_type,m.delivery_state,m.provider_state,m.delivery_error_code,
      COALESCE(m.attempt_error,m.last_error) AS last_error,
      m.attempts,COALESCE(m.recipient,'') AS recipient,o.order_code,o.order_source,
      m.created_at,m.available_at,m.published_at
    FROM messages m LEFT JOIN orders o ON m.aggregate_type='order' AND o.id::text=m.aggregate_id
    WHERE ($2::text='all' OR m.event_type=$2)
      AND ($3::text='all'
        OR ($3::text='delivered' AND m.delivery_state IN ('delivered','read'))
        OR ($3::text='pending' AND m.delivery_state IN ('pending','sent'))
        OR ($3::text NOT IN ('delivered','pending') AND m.delivery_state=$3))
    ORDER BY m.created_at DESC,m.id DESC LIMIT $4 OFFSET $5`,
    [query.period,type,status,limit+1,offset]);
  const hasMore=rows.rows.length>limit;
  return {
    period:query.period,asOf:new Date().toISOString(),totals,templates,
    hasMore,offset,items:rows.rows.slice(0,limit).map(row=>({
      id:row.id,eventType:row.event_type,status:row.delivery_state,
      recipient:maskPhone(row.recipient),orderCode:row.order_code||null,
      orderSource:row.order_source||null,attempts:row.attempts,
      providerStatus:row.provider_state||null,
      errorCode:row.delivery_error_code||null,
      error:safeError(row.last_error),
      createdAt:row.created_at.toISOString(),availableAt:row.available_at.toISOString(),
      publishedAt:row.published_at?.toISOString()||null,
    })),
  };
}
