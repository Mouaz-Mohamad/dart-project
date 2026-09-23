// DART CODE GUIDE | backend/src/modules/loyalty/dart-card-draw.service.ts
// الغرض: اختيار فائز/فائزين Dart Card شهريا: أعلى قطع ثم أعلى Net Spending، والتعادل الكامل يسمح حتى 3 فائزين.
import { randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";

export type DartCardCandidate = {
  userId: string;
  clientCode: string;
  name: string;
  pieceCount: number;
  netSpendMinor: number;
};

export function selectExactTieWinners(
  candidates: DartCardCandidate[],
  maxWinners = 3,
  pickIndex: (upperExclusive: number) => number = randomInt,
): DartCardCandidate[] {
  const limit = Math.max(1, Math.trunc(maxWinners));
  if (candidates.length <= limit) return [...candidates];
  const pool = [...candidates];
  const winners: DartCardCandidate[] = [];
  while (winners.length < limit && pool.length) {
    const index = pickIndex(pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
      throw new Error("Invalid Dart Card tie-break index");
    }
    winners.push(pool.splice(index, 1)[0]!);
  }
  return winners;
}

function assertPeriod(period: string): string {
  const normalized = String(period || "").trim();
  const match = normalized.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match)
    throw new AppError(
      400,
      "DRAW_PERIOD_INVALID",
      "Draw period must use YYYY-MM",
    );
  return normalized;
}

function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month!, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function cairoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function previousCairoMonth(value = new Date()): string {
  const [year, month] = cairoDateKey(value).split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addOneYear(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year! + 1, month! - 1, day!));
  return next.toISOString().slice(0, 10);
}

function parseExpiry(payload: Record<string, unknown>): number | null {
  const raw = String(payload.expDate || payload.expiresAt || "").trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match)
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      23,
      59,
      59,
      999,
    );
  match = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match)
    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      23,
      59,
      59,
      999,
    );
  return null;
}

function activeCard(
  payload: Record<string, unknown>,
  reference = new Date(),
): boolean {
  if (
    String(payload.status || "") !== "Active" ||
    payload.isArchived ||
    payload.isDeleted
  )
    return false;
  const limit = Math.max(
    1,
    Number(payload.itemLimit || payload.purchasedLimit || 10),
  );
  const used = Math.max(0, Number(payload.purchasedItems || 0));
  const reserved = Math.max(0, Number(payload.reservedItems || 0));
  const expiry = parseExpiry(payload);
  return (
    used + reserved < limit && (!expiry || expiry >= reference.getTime())
  );
}

export class DartCardDrawService {
  public constructor(private readonly pool: Pool) {}

  private async candidates(
    client: PoolClient,
    period: string,
  ): Promise<DartCardCandidate[]> {
    const start = `${period}-01`;
    const end = `${nextPeriod(period)}-01`;
    const result = await client.query<{
      user_id: string;
      client_code: string;
      full_name: string;
      piece_count: string;
      net_spend_minor: string;
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

  private async excludeActiveCards(
    client: PoolClient,
    candidates: DartCardCandidate[],
    reference = new Date(),
  ): Promise<DartCardCandidate[]> {
    if (!candidates.length) return [];
    const cards = await client.query<{
      customer_code: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT customer_code,payload FROM loyalty_cards
        WHERE customer_code = ANY($1::text[]) AND status='Active'`,
      [candidates.map((candidate) => candidate.clientCode)],
    );
    const blocked = new Set(
      cards.rows
        .filter((row) => activeCard(row.payload, reference))
        .map((row) => row.customer_code),
    );
    return candidates.filter(
      (candidate) => !blocked.has(candidate.clientCode),
    );
  }

  private exactTopTies(
    eligible: DartCardCandidate[],
  ): DartCardCandidate[] {
    if (!eligible.length) return [];
    const topPieces = eligible[0]!.pieceCount;
    const topSpend = eligible[0]!.netSpendMinor;
    return eligible.filter(
      (candidate) =>
        candidate.pieceCount === topPieces &&
        candidate.netSpendMinor === topSpend,
    );
  }

  public async preview(
    periodInput: string,
  ): Promise<Record<string, unknown>> {
    const period = assertPeriod(periodInput);
    const client = await this.pool.connect();
    try {
      const raw = await this.candidates(client, period);
      const eligible = await this.excludeActiveCards(client, raw);
      eligible.sort(
        (a, b) =>
          b.pieceCount - a.pieceCount ||
          b.netSpendMinor - a.netSpendMinor ||
          a.clientCode.localeCompare(b.clientCode),
      );
      const exactTies = this.exactTopTies(eligible);
      return {
        period,
        ranking: eligible,
        exactTopTieCount: exactTies.length,
        projectedWinnerCount: Math.min(
          3,
          exactTies.length || (eligible.length ? 1 : 0),
        ),
        excludedWithActiveCard: raw.length - eligible.length,
        rule: "Highest purchased piece count; if tied, highest net spending; exact top ties all win up to 3 customers, while 4+ exact ties are randomly reduced to 3 winners.",
      };
    } finally {
      client.release();
    }
  }

  private async existingDraw(
    client: PoolClient,
    period: string,
  ): Promise<Record<string, unknown> | null> {
    const existing = await client.query<Record<string, unknown>>(
      `SELECT d.id::text,d.period_key,d.status,d.winner_user_id::text,d.winner_client_code,
              d.winning_piece_count,d.winning_net_spend_minor,d.eligible_count,d.exact_tie_count,
              d.tie_break_method,d.card_record_id,d.winner_count,d.selection_snapshot,d.executed_at,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'userId',w.customer_user_id::text,'clientCode',w.client_code,
                  'pieceCount',w.piece_count,'netSpendMinor',w.net_spend_minor,
                  'cardRecordId',w.card_record_id,'position',w.winner_position
                ) ORDER BY w.winner_position)
                  FROM dart_card_draw_winners w WHERE w.draw_id=d.id
              ),'[]'::jsonb) AS winners
         FROM dart_card_draws d WHERE d.period_key=$1`,
      [period],
    );
    return existing.rows[0] || null;
  }

  public async run(
    periodInput: string,
    actorId: string | null,
    requestId: string,
    actorType: "staff" | "system" = "staff",
  ): Promise<Record<string, unknown>> {
    const period = assertPeriod(periodInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `dart-card-draw:${period}`,
      ]);
      const existing = await this.existingDraw(client, period);
      if (existing) {
        await client.query("COMMIT");
        return { idempotent: true, draw: existing };
      }

      const raw = await this.candidates(client, period);
      const eligible = await this.excludeActiveCards(client, raw);
      const drawId = randomUUID();
      const snapshot = eligible.slice(0, 500);
      if (!eligible.length) {
        await client.query(
          `INSERT INTO dart_card_draws(id,period_key,status,eligible_count,winner_count,selection_snapshot,executed_by)
           VALUES ($1,$2,'No Eligible Customers',0,0,$3::jsonb,$4)`,
          [drawId, period, JSON.stringify(snapshot), actorId],
        );
        await client.query(
          `INSERT INTO dart_card_draw_events(draw_id,event_type,actor_type,actor_id,request_id,metadata)
           VALUES ($1,'DRAW_COMPLETED_WITHOUT_WINNER',$2,$3,$4,$5::jsonb)`,
          [
            drawId,
            actorType,
            actorId,
            requestId,
            JSON.stringify({ period, considered: raw.length }),
          ],
        );
        await client.query(
          `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
           VALUES ($1,$2,'DART_CARD_MONTHLY_DRAW_NO_WINNER','dart_card_draws',$3,$4,$5::jsonb)`,
          [
            actorType,
            actorId,
            drawId,
            requestId,
            JSON.stringify({ period, considered: raw.length }),
          ],
        );
        await client.query("COMMIT");
        return {
          idempotent: false,
          draw: {
            id: drawId,
            period,
            status: "No Eligible Customers",
            eligibleCount: 0,
            winnerCount: 0,
            winners: [],
          },
        };
      }

      eligible.sort(
        (a, b) =>
          b.pieceCount - a.pieceCount ||
          b.netSpendMinor - a.netSpendMinor ||
          a.clientCode.localeCompare(b.clientCode),
      );
      const exactTies = this.exactTopTies(eligible);
      const winners = selectExactTieWinners(exactTies, 3);
      const tieBreakMethod =
        exactTies.length <= 1
          ? "pieces_then_net_spend"
          : exactTies.length <= 3
            ? "all_exact_ties_win_up_to_three"
            : "random_three_of_exact_ties";
      const issueDate = cairoDateKey();
      const expDate = addOneYear(issueDate);
      const basePosition = await client.query<{ position: string }>(
        "SELECT COALESCE(max(position),0)::text AS position FROM loyalty_cards",
      );
      const firstPosition = Number(basePosition.rows[0]?.position || 0) + 1;
      const awarded = [] as Array<
        DartCardCandidate & { cardRecordId: string; position: number }
      >;

      for (const [index, winner] of winners.entries()) {
        const cardRecordId = `CARD-${period.replace("-", "")}-${randomUUID()}`;
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
          drawWinnerPosition: index + 1,
          awardedPieceCount: winner.pieceCount,
          awardedNetSpendMinor: winner.netSpendMinor,
          createdAt: new Date().toISOString(),
        };
        await client.query(
          `INSERT INTO loyalty_cards(record_id,position,payload)
           VALUES ($1,$2,$3::jsonb)`,
          [
            cardRecordId,
            firstPosition + index,
            JSON.stringify(cardPayload),
          ],
        );
        awarded.push({
          ...winner,
          cardRecordId,
          position: index + 1,
        });
      }

      const primary = awarded[0]!;
      await client.query(
        `INSERT INTO dart_card_draws(
           id,period_key,status,winner_user_id,winner_client_code,winning_piece_count,
           winning_net_spend_minor,eligible_count,exact_tie_count,tie_break_method,
           card_record_id,winner_count,selection_snapshot,executed_by
         ) VALUES ($1,$2,'Completed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [
          drawId,
          period,
          primary.userId,
          primary.clientCode,
          primary.pieceCount,
          primary.netSpendMinor,
          eligible.length,
          exactTies.length,
          tieBreakMethod,
          primary.cardRecordId,
          awarded.length,
          JSON.stringify(snapshot),
          actorId,
        ],
      );

      for (const winner of awarded) {
        await client.query(
          `INSERT INTO dart_card_draw_winners(
             draw_id,customer_user_id,client_code,piece_count,net_spend_minor,
             card_record_id,winner_position,selection_method
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            drawId,
            winner.userId,
            winner.clientCode,
            winner.pieceCount,
            winner.netSpendMinor,
            winner.cardRecordId,
            winner.position,
            tieBreakMethod,
          ],
        );
      }

      await client.query(
        "UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='cards'",
      );
      await client.query(
        `INSERT INTO dart_card_draw_events(draw_id,event_type,actor_type,actor_id,request_id,metadata)
         VALUES ($1,'WINNERS_AWARDED',$2,$3,$4,$5::jsonb)`,
        [
          drawId,
          actorType,
          actorId,
          requestId,
          JSON.stringify({
            period,
            winners: awarded,
            exactTieCount: exactTies.length,
            tieBreakMethod,
            winnerCount: awarded.length,
          }),
        ],
      );
      await client.query(
        `INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
         VALUES ($1,$2,'DART_CARD_MONTHLY_DRAW_COMPLETED','dart_card_draws',$3,$4,$5::jsonb)`,
        [
          actorType,
          actorId,
          drawId,
          requestId,
          JSON.stringify({
            period,
            winners: awarded,
            eligibleCount: eligible.length,
            exactTieCount: exactTies.length,
            tieBreakMethod,
            winnerCount: awarded.length,
          }),
        ],
      );
      await client.query("COMMIT");
      return {
        idempotent: false,
        draw: {
          id: drawId,
          period,
          status: "Completed",
          winner: primary,
          winners: awarded,
          winnerCount: awarded.length,
          eligibleCount: eligible.length,
          exactTieCount: exactTies.length,
          tieBreakMethod,
          issueDate,
          expDate,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async runDue(
    actorId: string | null,
    requestId: string,
    actorType: "staff" | "system" = "system",
  ): Promise<Record<string, unknown>> {
    return this.run(previousCairoMonth(), actorId, requestId, actorType);
  }

  public async history(limit = 24): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT d.id::text,d.period_key,d.status,d.winner_user_id::text,d.winner_client_code,
              d.winning_piece_count,d.winning_net_spend_minor,d.eligible_count,d.exact_tie_count,
              d.tie_break_method,d.card_record_id,d.winner_count,d.selection_snapshot,d.executed_by::text,d.executed_at,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'userId',w.customer_user_id::text,'clientCode',w.client_code,
                  'pieceCount',w.piece_count,'netSpendMinor',w.net_spend_minor,
                  'cardRecordId',w.card_record_id,'position',w.winner_position
                ) ORDER BY w.winner_position)
                  FROM dart_card_draw_winners w WHERE w.draw_id=d.id
              ),'[]'::jsonb) AS winners
         FROM dart_card_draws d ORDER BY d.period_key DESC LIMIT $1`,
      [Math.min(120, Math.max(1, limit))],
    );
    return result.rows;
  }
}
