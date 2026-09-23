// DART CODE GUIDE | backend/src/modules/loyalty/dart-card-draw.service.ts
// الغرض: اختيار فائز Dart Card شهريا على الخادم: أعلى عدد قطع ثم أعلى Net Spending، مع استبعاد أي Card فعالة.
import { randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

type Candidate = {
  userId: string;
  clientCode: string;
  name: string;
  pieceCount: number;
  netSpendMinor: number;
};

function assertPeriod(period: string): string {
  const normalized = String(period || "").trim();
  const match = normalized.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) throw new AppError(400, "DRAW_PERIOD_INVALID", "Draw period must use YYYY-MM");
  return normalized;
}

function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month!, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2,"0")}`;
}

function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function previousCairoMonth(value = new Date()): string {
  const [year, month] = cairoDateKey(value).split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2,"0")}`;
}

function addOneYear(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year! + 1, month! - 1, day!));
  return next.toISOString().slice(0,10);
}

function parseExpiry(payload: Record<string, unknown>): number | null {
  const raw = String(payload.expDate || payload.expiresAt || "").trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  match = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59, 999);
  return null;
}

function activeCard(payload: Record<string, unknown>, reference = new Date()): boolean {
  if (String(payload.status || "") !== "Active" || payload.isArchived || payload.isDeleted) return false;
  const limit = Math.max(1, Number(payload.itemLimit || payload.purchasedLimit || 10));
  const used = Math.max(0, Number(payload.purchasedItems || 0));
  const reserved = Math.max(0, Number(payload.reservedItems || 0));
  const expiry = parseExpiry(payload);
  return used + reserved < limit && (!expiry || expiry >= reference.getTime());
}

export class DartCardDrawService {
  public constructor(private readonly pool: Pool) {}

  private async candidates(client: PoolClient, period: string): Promise<Candidate[]> {
    const start = `${period}-01`;
    const end = `${nextPeriod(period)}-01`;
    const result = await client.query<{
      user_id: string; client_code: string; full_name: string; piece_count: string; net_spend_minor: string;
    }>(
      `WITH delivered AS (
         SELECT o.id,o.customer_user_id,GREATEST(o.final_minor-o.amount_refunded_minor,0) AS net_minor
           FROM orders o
          WHERE o.status='Delivered' AND NOT o.is_deleted
            AND o.delivered_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Cairo')
            AND o.delivered_at < ($2::date::timestamp AT TIME ZONE 'Africa/Cairo')
       ),
       spending AS (
         SELECT customer_user_id,sum(net_minor)::bigint AS net_spend_minor
           FROM delivered GROUP BY customer_user_id
       ),
       pieces AS (
         SELECT d.customer_user_id,count(*)::bigint AS piece_count
           FROM delivered d
           JOIN order_items oi ON oi.order_id=d.id
          WHERE NOT EXISTS (
            SELECT 1 FROM return_requests rr
             WHERE rr.inventory_item_id=oi.inventory_item_id
               AND NOT rr.is_deleted
               AND lower(rr.status) IN ('completed','returned','closed','done')
          )
          GROUP BY d.customer_user_id
       )
       SELECT c.user_id::text,c.client_code,c.full_name,
              COALESCE(p.piece_count,0)::text AS piece_count,
              COALESCE(s.net_spend_minor,0)::text AS net_spend_minor
         FROM customers c
         JOIN users u ON u.id=c.user_id AND u.status='active' AND u.deleted_at IS NULL
         JOIN spending s ON s.customer_user_id=c.user_id
         JOIN pieces p ON p.customer_user_id=c.user_id
        WHERE c.dart_card_draw_eligible
          AND p.piece_count > 0
        ORDER BY p.piece_count DESC,s.net_spend_minor DESC,c.client_code ASC`,
      [start, end],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      clientCode: row.client_code,
      name: row.full_name,
      pieceCount: Number(row.piece_count || 0),
      netSpendMinor: Number(row.net_spend_minor || 0),
    }));
  }

  private async excludeActiveCards(client: PoolClient, candidates: Candidate[], reference = new Date()): Promise<Candidate[]> {
    if (!candidates.length) return [];
    const cards = await client.query<{ customer_code: string; payload: Record<string, unknown> }>(
      `SELECT customer_code,payload FROM loyalty_cards
        WHERE customer_code = ANY($1::text[]) AND status='Active'`,
      [candidates.map((candidate) => candidate.clientCode)],
    );
    const blocked = new Set(
      cards.rows.filter((row) => activeCard(row.payload, reference)).map((row) => row.customer_code),
    );
    return candidates.filter((candidate) => !blocked.has(candidate.clientCode));
  }

  public async preview(periodInput: string): Promise<Record<string, unknown>> {
    const period = assertPeriod(periodInput);
    const client = await this.pool.connect();
    try {
      const raw = await this.candidates(client, period);
      const eligible = await this.excludeActiveCards(client, raw);
      return {
        period,
        ranking: eligible,
        excludedWithActiveCard: raw.length - eligible.length,
        rule: "Highest purchased piece count; if tied, highest net spending; exact ties are randomly resolved and audited.",
      };
    } finally {
      client.release();
    }
  }

  public async run(periodInput: string, actorId: string | null, requestId: string, actorType: "staff" | "system" = "staff"): Promise<Record<string, unknown>> {
    const period = assertPeriod(periodInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart-card-draw:${period}`]);
      const existing = await client.query<Record<string, unknown>>(
        `SELECT id::text,period_key,status,winner_user_id::text,winner_client_code,
                winning_piece_count,winning_net_spend_minor,eligible_count,exact_tie_count,
                tie_break_method,card_record_id,selection_snapshot,executed_at
           FROM dart_card_draws WHERE period_key=$1`,
        [period],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { idempotent: true, draw: existing.rows[0] };
      }

      const raw = await this.candidates(client, period);
      const eligible = await this.excludeActiveCards(client, raw);
      const drawId = randomUUID();
      const snapshot = eligible.slice(0,500);
      if (!eligible.length) {
        await client.query(
          `INSERT INTO dart_card_draws(id,period_key,status,eligible_count,selection_snapshot,executed_by)
           VALUES ($1,$2,'No Eligible Customers',0,$3::jsonb,$4)`,
          [drawId, period, JSON.stringify(snapshot), actorId],
        );
        await client.query(
          `INSERT INTO dart_card_draw_events(draw_id,event_type,actor_type,actor_id,request_id,metadata)
           VALUES ($1,'DRAW_COMPLETED_WITHOUT_WINNER',$2,$3,$4,$5::jsonb)`,
          [drawId, actorType, actorId, requestId, JSON.stringify({ period, considered: raw.length })],
        );
        await client.query(
          `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
           VALUES ($1,$2,'DART_CARD_MONTHLY_DRAW_NO_WINNER','dart_card_draws',$3,$4,$5::jsonb)`,
          [actorType, actorId, drawId, requestId, JSON.stringify({ period, considered: raw.length })],
        );
        await client.query("COMMIT");
        return { idempotent: false, draw: { id: drawId, period, status: "No Eligible Customers", eligibleCount: 0 } };
      }

      eligible.sort((a,b) => b.pieceCount - a.pieceCount || b.netSpendMinor - a.netSpendMinor || a.clientCode.localeCompare(b.clientCode));
      const topPieces = eligible[0]!.pieceCount;
      const topSpend = eligible[0]!.netSpendMinor;
      const exactTies = eligible.filter((candidate) => candidate.pieceCount === topPieces && candidate.netSpendMinor === topSpend);
      const winner = exactTies.length === 1 ? exactTies[0]! : exactTies[randomInt(exactTies.length)]!;
      const tieBreakMethod = exactTies.length > 1
        ? "pieces_then_net_spend_then_random_exact_tie"
        : "pieces_then_net_spend";
      const issueDate = cairoDateKey();
      const expDate = addOneYear(issueDate);
      const cardRecordId = `CARD-${period.replace("-","")}-${randomUUID()}`;
      const cardPayload = {
        id: cardRecordId,
        cardId: cardRecordId,
        clientId: winner.clientCode,
        customerId: winner.clientCode,
        customerName: winner.name,
        status: "Active",
        discountPercent: 40,
        itemLimit: 10,
        purchasedLimit: 10,
        purchasedItems: 0,
        reservedItems: 0,
        issueDate,
        expDate,
        source: "Monthly Draw",
        drawPeriod: period,
        drawId,
        awardedPieceCount: winner.pieceCount,
        awardedNetSpendMinor: winner.netSpendMinor,
        createdAt: new Date().toISOString(),
      };
      const position = await client.query<{ position: string }>(
        "SELECT (COALESCE(max(position),0)+1)::text AS position FROM loyalty_cards",
      );
      await client.query(
        `INSERT INTO loyalty_cards(record_id,position,payload)
         VALUES ($1,$2,$3::jsonb)`,
        [cardRecordId, Number(position.rows[0]?.position || 1), JSON.stringify(cardPayload)],
      );
      await client.query(
        `INSERT INTO dart_card_draws(
           id,period_key,status,winner_user_id,winner_client_code,winning_piece_count,
           winning_net_spend_minor,eligible_count,exact_tie_count,tie_break_method,
           card_record_id,selection_snapshot,executed_by
         ) VALUES ($1,$2,'Completed',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
        [
          drawId,period,winner.userId,winner.clientCode,winner.pieceCount,winner.netSpendMinor,
          eligible.length,exactTies.length,tieBreakMethod,cardRecordId,JSON.stringify(snapshot),actorId,
        ],
      );
      await client.query("UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='cards'");
      await client.query(
        `INSERT INTO dart_card_draw_events(draw_id,event_type,actor_type,actor_id,request_id,metadata)
         VALUES ($1,'WINNER_AWARDED',$2,$3,$4,$5::jsonb)`,
        [drawId,actorType,actorId,requestId,JSON.stringify({ period,winner,exactTieCount: exactTies.length,tieBreakMethod,cardRecordId })],
      );
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ($1,$2,'DART_CARD_MONTHLY_DRAW_COMPLETED','dart_card_draws',$3,$4,$5::jsonb)`,
        [actorType,actorId,drawId,requestId,JSON.stringify({ period,winner,eligibleCount: eligible.length,exactTieCount: exactTies.length,tieBreakMethod,cardRecordId })],
      );
      await client.query("COMMIT");
      return {
        idempotent: false,
        draw: {
          id: drawId,period,status: "Completed",winner,eligibleCount: eligible.length,
          exactTieCount: exactTies.length,tieBreakMethod,cardRecordId,issueDate,expDate,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async runDue(actorId: string | null, requestId: string, actorType: "staff" | "system" = "system"): Promise<Record<string, unknown>> {
    return this.run(previousCairoMonth(), actorId, requestId, actorType);
  }

  public async history(limit = 24): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id::text,period_key,status,winner_user_id::text,winner_client_code,
              winning_piece_count,winning_net_spend_minor,eligible_count,exact_tie_count,
              tie_break_method,card_record_id,selection_snapshot,executed_by::text,executed_at
         FROM dart_card_draws ORDER BY period_key DESC LIMIT $1`,
      [Math.min(120,Math.max(1,limit))],
    );
    return result.rows;
  }
}
