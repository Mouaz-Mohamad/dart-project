// Experimental adapter only. No imports from the production application.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface OrderSignal { id: string; version: number }
export interface Publisher { publish(signal: OrderSignal): Promise<void> }
interface ClaimedRow { id: string; version: string; attempts: number; lease_id: string }

export class PilotOutbox {
  constructor(private readonly pool: Pool, private readonly publisher: Publisher,
    private readonly now: () => Date = () => new Date()) {}

  async drain(limit = 10) {
    const lease = randomUUID(), at = this.now().toISOString();
    // Single SQL claim; independent workers cannot claim the same live lease.
    const claimed = await this.pool.query<ClaimedRow>(`
      UPDATE realtime_pilot_events e SET state='publishing',attempts=e.attempts+1,
        lease_id=$1,lease_until=$2::timestamptz+interval '10 seconds'
      FROM (SELECT id FROM realtime_pilot_events WHERE attempts<8 AND available_at<=$2
        AND (state IN ('pending','failed') OR (state='publishing' AND lease_until<=$2))
        ORDER BY version FOR UPDATE SKIP LOCKED LIMIT $3) candidate
      WHERE e.id=candidate.id RETURNING e.id::text,e.version::text,e.attempts,e.lease_id::text`,
    [lease, at, Math.max(1, Math.min(100, Math.trunc(limit)))]);
    let published = 0, failed = 0;
    for (const row of claimed.rows) {
      try {
        await this.publisher.publish({ id: row.id, version: Number(row.version) });
        const ack = await this.pool.query(`UPDATE realtime_pilot_events SET state='published',
          published_at=$3,lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2`,
        [row.id, lease, this.now().toISOString()]);
        published += ack.rowCount || 0;
      } catch {
        // Provider response bodies can contain credentials; never persist/log them.
        const retry = Math.min(30_000, 250 * 2 ** Math.min(row.attempts, 7));
        await this.pool.query(`UPDATE realtime_pilot_events SET state='failed',available_at=$3,
          lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2`,
        [row.id, lease, new Date(this.now().getTime() + retry).toISOString()]);
        failed++;
      }
    }
    return { claimed: claimed.rows.length, published, failed };
  }

  async health() {
    const result = await this.pool.query<{ pending: string; exhausted: string; oldest: Date | null }>(`
      SELECT count(*) FILTER(WHERE state<>'published')::text AS pending,
        count(*) FILTER(WHERE state<>'published' AND attempts>=8)::text AS exhausted,
        min(created_at) FILTER(WHERE state<>'published') AS oldest FROM realtime_pilot_events`);
    return result.rows[0]!;
  }
}

// Ready for an explicitly configured sandbox account; not called by the pilot runner.
// REST idempotent publishing: https://ably.com/docs/api/rest-api#publish
export class AblyRestPublisher implements Publisher {
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._-]+:[^\s:]+$/.test(key)) throw new Error("Ably API key is missing or invalid");
  }
  async publish(signal: OrderSignal): Promise<void> {
    const response = await this.fetcher(
      "https://main.realtime.ably.net/channels/dart-pilot%3Aorders/messages", {
        method: "POST", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Basic ${Buffer.from(this.key).toString("base64")}`,
          "Content-Type": "application/json", "X-Ably-Version": "1.2" },
        body: JSON.stringify({ id: signal.id, name: "orders.changed", data: { version: signal.version } }),
      });
    if (!response.ok) throw new Error(`Realtime provider rejected publish (${response.status})`);
  }
}
